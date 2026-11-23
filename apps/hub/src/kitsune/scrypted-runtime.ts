/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type {
  AppAction,
  AppCatalogEntry,
  AppInfo,
  AppInstallProgressUpdate,
  AppManifest,
} from '@haus/apps';
import { defaultMediaRuntime } from '@haus/media/pipeline';
import {
  executeScryptedCommand,
  PluginProcess,
  type DeviceRecord,
  type InstalledPlugin,
  type Json,
  type KitsuneCommandPayload,
  type KitsuneCompatibilityEngine,
  type KitsuneEvent,
} from '@haus/kitsune';
import type { InstalledAppEntry, StandaloneRuntimeBridge } from '../home/app-driver.js';
import { isSecretConfigKey, type NativeConfigFieldMeta } from '../home/apps/config.js';
import { AppLogBuffer } from '../home/apps/log-buffer.js';
import type { StandaloneHomeService } from '../home/home.service.js';
import { parseScryptedSettingsSchema, resolveInstalledScryptedPlugin } from './scrypted-helpers.js';

const MAX_LOG_LINES = 300;
const SCRYPTED_OWNER_ID = 'hub-scrypted';
const SCRYPTED_MEMORY_MB = 256;
const RESTART_BACKOFF_MS = [3_000, 6_000, 12_000, 24_000, 60_000] as const;
const HEALTHY_RESET_MS = 60_000;

interface ActiveScryptedRecord {
  readonly runtime: PluginProcess;
  readonly plugin: InstalledPlugin;
  readonly epoch: number;
  schema?: Record<string, NativeConfigFieldMeta>;
  healthyTimer?: NodeJS.Timeout;
}

export class ScryptedAppSupervisor implements StandaloneRuntimeBridge {
  private readonly logger = new Logger('Scrypted');
  private dataDirectory = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  private readonly runtimes = new Map<string, ActiveScryptedRecord>();
  private readonly logBuffer = new AppLogBuffer(MAX_LOG_LINES);
  private readonly startInFlight = new Map<string, Promise<void>>();
  private readonly desiredRunning = new Set<string>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly restartAttempts = new Map<string, number>();
  private closed = false;

  constructor(
    private readonly engine: KitsuneCompatibilityEngine,
    private readonly homeService?: StandaloneHomeService,
    private readonly onDevicesSync?: () => void,
  ) {}

  supports(
    manifest: Pick<AppManifest, 'id'> & Partial<Pick<AppManifest, 'image' | 'env'>>,
    catalogEntry?: AppCatalogEntry,
  ): boolean {
    const runtimeEnv =
      manifest.env && typeof manifest.env === 'object' && 'HAUS_PLUGIN_RUNTIME' in manifest.env
        ? manifest.env.HAUS_PLUGIN_RUNTIME
        : undefined;
    return (
      catalogEntry?.runtimeType === 'scrypted' ||
      runtimeEnv === 'scrypted' ||
      manifest.id.startsWith('scrypted-')
    );
  }

  isRunning(appId: string): boolean {
    return Boolean(this.runtimes.get(appId)?.runtime.isRunning);
  }

  async ensureRunning(appId: string): Promise<boolean> {
    if (this.closed) return false;
    if (this.isRunning(appId)) return true;
    const inflight = this.startInFlight.get(appId);
    if (inflight) {
      await inflight.catch(() => undefined);
      return this.isRunning(appId);
    }
    const entry = this.homeService?.appManager.getInstalledApp(appId);
    if (!entry || !this.supports(entry.manifest)) return false;
    if (this.homeService && !this.homeService.appManager.canExecuteAppLocally(appId)) {
      return false;
    }
    if (entry.state !== 'running' && !this.desiredRunning.has(appId)) {
      return false;
    }
    try {
      await this.startPlugin(appId, entry.manifest, entry.config);
      return this.isRunning(appId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto-recovery start failed for ${appId}: ${reason}`);
      this.appendLog(appId, `Auto-recovery start failed: ${reason}`);
      this.scheduleAutoRestart(appId);
      return false;
    }
  }

  async configure(options: { dataDirectory: string }): Promise<void> {
    this.dataDirectory = options.dataDirectory;
  }

  async restore(entries: readonly InstalledAppEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!this.supports(entry.manifest)) continue;
      const appId = entry.manifest.id;
      if (entry.state !== 'running' || this.isRunning(appId)) continue;
      this.desiredRunning.add(appId);
      try {
        await this.startPlugin(appId, entry.manifest, entry.config);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Restore failed for ${appId}: ${reason}`);
        this.appendLog(appId, `Restore failed: ${reason}`);
        this.scheduleAutoRestart(appId);
      }
    }
  }

  async install(
    entry: { manifest: AppManifest; config: Record<string, unknown> },
    onProgress?: (update: AppInstallProgressUpdate) => void,
  ): Promise<{ logs?: readonly string[] }> {
    const appId = entry.manifest.id;
    onProgress?.({ stage: 'pulling' });
    onProgress?.({ stage: 'creating' });
    onProgress?.({ stage: 'starting' });
    await this.startPlugin(appId, entry.manifest, entry.config);
    return { logs: this.getLogs(appId) };
  }

  async execute(entry: InstalledAppEntry, action: AppAction): Promise<void> {
    const appId = entry.manifest.id;
    if (action === 'start') {
      await this.startPlugin(appId, entry.manifest, entry.config);
      return;
    }
    if (action === 'stop') {
      await this.stopPlugin(appId, true);
      return;
    }
    if (action === 'restart') {
      await this.stopPlugin(appId, false);
      await this.startPlugin(appId, entry.manifest, entry.config);
    }
  }

  async inspect(entry: InstalledAppEntry): Promise<Partial<AppInfo> | undefined> {
    const active = this.runtimes.get(entry.manifest.id);
    if (active?.runtime.isRunning) {
      entry.state = 'running';
    } else if (entry.state === 'running') {
      entry.state = 'stopped';
    }
    return {
      description: `${entry.manifest.description ?? entry.manifest.name} — Scrypted runtime (${active?.plugin.name ?? entry.manifest.id}@${active?.plugin.version ?? entry.manifest.version})`,
    };
  }

  async configureApp(entry: InstalledAppEntry, config: Record<string, unknown>): Promise<void> {
    const appId = entry.manifest.id;
    this.registerConfigSecrets(appId, config);
    const active = this.runtimes.get(appId);
    if (active?.runtime.isRunning) {
      await this.applyConfigToRuntime(appId, active, config);
      await this.syncPluginDevices(appId, active);
      this.onDevicesSync?.();
      return;
    }
    if (entry.state === 'running' || this.desiredRunning.has(appId)) {
      await this.stopPlugin(appId, false);
      await this.startPlugin(appId, entry.manifest, config);
    }
  }

  async updateApp(
    entry: InstalledAppEntry,
    targetManifest: AppManifest,
  ): Promise<{ logs?: readonly string[] }> {
    const appId = entry.manifest.id;
    const wasRunning =
      entry.state === 'running' || this.runtimes.has(appId) || this.desiredRunning.has(appId);
    const hasOverridePath =
      typeof entry.config.pluginPath === 'string' && entry.config.pluginPath.trim().length > 0;
    await this.stopPlugin(appId, false);
    await resolveInstalledScryptedPlugin({
      appId,
      manifest: targetManifest,
      config: entry.config,
      dataDirectory: this.dataDirectory,
      catalogEntry: this.homeService?.getAppCatalogEntry(appId),
      forceInstall: !hasOverridePath,
    });
    if (wasRunning) {
      await this.startPlugin(appId, targetManifest, entry.config);
    }
    return { logs: this.getLogs(appId) };
  }

  async removeApp(entry: InstalledAppEntry): Promise<void> {
    const appId = entry.manifest.id;
    await this.stopPlugin(appId, true);
    this.logBuffer.delete(appId);
  }

  getLogs(appId: string): readonly string[] | undefined {
    return this.logBuffer.get(appId);
  }

  subscribeLogs(appId: string, onLine: (line: string) => void): () => void {
    return this.logBuffer.subscribe(appId, onLine);
  }

  getNativeConfigSchema(appId: string): Record<string, NativeConfigFieldMeta> | undefined {
    return this.runtimes.get(appId)?.schema;
  }

  async executeDeviceCommand(appId: string, payload: KitsuneCommandPayload): Promise<void> {
    await this.ensureRunning(appId);
    const active = this.runtimes.get(appId);
    if (!active?.runtime.isRunning) {
      throw new Error(`kitsune_plugin_offline:${appId}`);
    }
    const prefix = `kitsune:${appId}:`;
    const nativeDeviceId = payload.deviceId.startsWith(prefix)
      ? payload.deviceId.slice(prefix.length)
      : payload.deviceId;
    await executeScryptedCommand(
      active.runtime,
      nativeDeviceId,
      payload.capability,
      payload.value ?? payload.parameters?.value,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    this.desiredRunning.clear();
    const activeIds = Array.from(this.runtimes.keys());
    await Promise.allSettled(activeIds.map((appId) => this.stopPlugin(appId, true)));
  }

  private registerConfigSecrets(appId: string, config: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && isSecretConfigKey(key) && value.length > 0) {
        this.engine.secrets.setSecret('scrypted', appId, key, value);
      }
    }
  }

  private acquireOrRestartSession(appId: string) {
    const current = this.engine.getSession('scrypted', appId);
    if (current && current.status === 'active') {
      if (current.ownerId === SCRYPTED_OWNER_ID) {
        return this.engine.restartSession('scrypted', appId, SCRYPTED_OWNER_ID);
      }
      this.engine.releaseSession('scrypted', appId, current.ownerId);
    }
    return this.engine.acquireSession('scrypted', appId, SCRYPTED_OWNER_ID);
  }

  private handlePluginEvent(appId: string, ownerId: string, epoch: number, event: KitsuneEvent) {
    if (
      (event.type === 'kitsune:device:discovered' || event.type === 'kitsune:device:state') &&
      event.device &&
      event.device.id !== 'root'
    ) {
      try {
        this.engine.registerScryptedDevice(appId, ownerId, epoch, event.device);
        this.onDevicesSync?.();
      } catch {
        // Ignore stale epoch events.
      }
    }
  }

  private async applyConfigToRuntime(
    appId: string,
    active: ActiveScryptedRecord,
    config: Record<string, unknown>,
  ): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      if (['pluginPath', 'packageName'].includes(key) || value === undefined) continue;
      if (typeof value === 'string' && value === '<unchanged>') continue;
      try {
        await active.runtime.call('putSetting', [key, value as Json]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.appendLog(appId, `Could not apply setting "${key}": ${msg}`);
      }
    }
    const rawSettings = await active.runtime.call<unknown>('getSettings').catch(() => undefined);
    const schema = parseScryptedSettingsSchema(rawSettings);
    if (schema) active.schema = schema;
  }

  private async syncPluginDevices(appId: string, active: ActiveScryptedRecord): Promise<void> {
    const records = await active.runtime.call<DeviceRecord[]>('records').catch(() => []);
    if (!Array.isArray(records)) return;
    for (const rec of records) {
      if (rec && typeof rec.id === 'string' && rec.id !== 'root' && rec.nativeId) {
        try {
          this.engine.registerScryptedDevice(appId, SCRYPTED_OWNER_ID, active.epoch, rec);
        } catch {
          // Ignore invalid or root placeholder record.
        }
      }
    }
  }

  private async startPlugin(
    appId: string,
    manifest: AppManifest,
    config: Record<string, unknown>,
  ): Promise<void> {
    const existing = this.startInFlight.get(appId);
    if (existing) return existing;

    this.clearRestartTimer(appId);
    this.desiredRunning.add(appId);

    const task = (async () => {
      await this.stopPlugin(appId, false);
      this.registerConfigSecrets(appId, config);

      const plugin = await resolveInstalledScryptedPlugin({
        appId,
        manifest,
        config,
        dataDirectory: this.dataDirectory,
        catalogEntry: this.homeService?.getAppCatalogEntry(appId),
        forceInstall: false,
      });
      const lease = this.acquireOrRestartSession(appId);
      const endpointBase =
        process.env.HAUS_KITSUNE_ENDPOINT ?? 'http://127.0.0.1:8790/api/kitsune/hooks';

      const runtime = new PluginProcess(plugin, {
        dataDirectory: this.dataDirectory,
        endpointBase,
        publicEndpointBase: process.env.HAUS_KITSUNE_PUBLIC_ENDPOINT,
        mediaRuntime: defaultMediaRuntime,
        memoryMb: SCRYPTED_MEMORY_MB,
        emit: (event) => this.handlePluginEvent(appId, lease.ownerId, lease.epoch, event),
        diagnostic: (diag) => this.appendLog(appId, `[${diag.event}] ${diag.message}`),
      });

      const record: ActiveScryptedRecord = {
        runtime,
        plugin,
        epoch: lease.epoch,
      };
      this.runtimes.set(appId, record);

      runtime.on('stdout', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) this.appendLog(appId, line);
        }
      });
      runtime.on('stderr', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) this.appendLog(appId, `[stderr] ${line}`);
        }
      });
      runtime.once('stopped', () => {
        const current = this.runtimes.get(appId);
        if (current?.runtime === runtime) {
          if (current.healthyTimer) clearTimeout(current.healthyTimer);
          this.runtimes.delete(appId);
          this.appendLog(appId, 'Scrypted plugin process stopped');
          if (!this.closed && this.desiredRunning.has(appId)) {
            this.scheduleAutoRestart(appId);
          }
        }
      });

      await runtime.start();
      await this.applyConfigToRuntime(appId, record, config);
      await this.syncPluginDevices(appId, record);

      record.healthyTimer = setTimeout(() => {
        if (this.runtimes.get(appId)?.runtime === runtime) {
          this.restartAttempts.delete(appId);
        }
      }, HEALTHY_RESET_MS);
      record.healthyTimer.unref();

      this.logger.log(`Started Scrypted plugin ${plugin.name}@${plugin.version} (${appId})`);
      this.appendLog(appId, `Started Scrypted plugin ${plugin.name}@${plugin.version}`);
      this.onDevicesSync?.();
    })();

    this.startInFlight.set(appId, task);
    try {
      await task;
    } finally {
      this.startInFlight.delete(appId);
    }
  }

  private async stopPlugin(appId: string, releaseSession: boolean): Promise<void> {
    if (releaseSession) {
      this.desiredRunning.delete(appId);
      this.clearRestartTimer(appId);
      this.restartAttempts.delete(appId);
    }
    const active = this.runtimes.get(appId);
    if (active) {
      if (active.healthyTimer) clearTimeout(active.healthyTimer);
      this.runtimes.delete(appId);
      await active.runtime.stop();
    }
    if (releaseSession) {
      const existing = this.engine.getSession('scrypted', appId);
      if (existing && existing.status === 'active') {
        try {
          this.engine.releaseSession('scrypted', appId, existing.ownerId);
        } catch {
          // Ignore ownership mismatch when cleaning stale state.
        }
      }
      this.onDevicesSync?.();
    }
  }

  private clearRestartTimer(appId: string): void {
    const timer = this.restartTimers.get(appId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(appId);
    }
  }

  private scheduleAutoRestart(appId: string): void {
    if (this.closed || !this.desiredRunning.has(appId) || this.restartTimers.has(appId)) return;
    const attempt = this.restartAttempts.get(appId) ?? 0;
    const delayMs = RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)] ?? 60_000;
    this.restartAttempts.set(appId, attempt + 1);
    this.appendLog(appId, `Scheduling restart #${attempt + 1} in ${Math.round(delayMs / 1000)}s`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(appId);
      if (this.closed || !this.desiredRunning.has(appId) || this.isRunning(appId)) return;
      const entry = this.homeService?.appManager.getInstalledApp(appId);
      if (!entry) return;
      if (this.homeService && !this.homeService.appManager.canExecuteAppLocally(appId)) return;
      void this.startPlugin(appId, entry.manifest, entry.config).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.appendLog(appId, `Auto-restart failed: ${reason}`);
        this.scheduleAutoRestart(appId);
      });
    }, delayMs);
    timer.unref();
    this.restartTimers.set(appId, timer);
  }

  private appendLog(appId: string, rawLine: string): void {
    this.logBuffer.append(
      appId,
      `[${new Date().toISOString()}] ${this.engine.secrets.redactText(rawLine)}`,
    );
  }
}
