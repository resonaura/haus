/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type {
  AppAction,
  AppCatalogEntry,
  AppInfo,
  AppInstallProgressUpdate,
  AppManifest,
} from '@haus/apps';
import {
  HomebridgeChildBridge,
  resolveHomebridgeBleEnvironment,
  type GoveeOutletCatalog,
  type HomebridgePluginConfig,
  type KitsuneCompatibilityEngine,
} from '@haus/kitsune';
import type { InstalledAppEntry, StandaloneRuntimeBridge } from '../home/app-driver.js';
import {
  buildHomebridgeChildConfig,
  readHomebridgeConfigSchema,
  type NativeConfigFieldMeta,
} from '../home/apps/config.js';
import { AppLogBuffer } from '../home/apps/log-buffer.js';
import type { StandaloneHomeService } from '../home/home.service.js';
import {
  HYBRID_GOVEE_APP_ID,
  isDockerGovee2MqttManifest,
  isGovee2MqttDevice,
  isHomebridgeGoveeAppId,
  pruneSupersededMqttGoveeOutlets,
} from '../mqtt/govee-hybrid.js';
import { resolveHomebridgePluginRuntime } from './homebridge-sync.js';

export { normalizeKitsuneDeviceForHome, syncKitsuneDevicesToHome } from './homebridge-sync.js';

const MAX_LOG_LINES = 300;
const BRIDGE_OWNER_ID = 'hub-homebridge';
const BRIDGE_MEMORY_MB = 256;
const RESTART_BACKOFF_MS = [3_000, 6_000, 12_000, 24_000, 60_000] as const;
const HEALTHY_RESET_MS = 60_000;

interface ActiveBridgeRecord {
  readonly bridge: HomebridgeChildBridge;
  readonly epoch: number;
  readonly pluginDirectory: string;
  readonly bleMode: string;
  readonly catalog?: GoveeOutletCatalog;
  healthyTimer?: NodeJS.Timeout;
}

export class HomebridgeAppSupervisor implements StandaloneRuntimeBridge {
  private readonly logger = new Logger('Homebridge');
  private dataDirectory = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  private readonly bridges = new Map<string, ActiveBridgeRecord>();
  private readonly logBuffer = new AppLogBuffer(MAX_LOG_LINES);
  private readonly startInFlight = new Map<string, Promise<void>>();
  private readonly desiredRunning = new Set<string>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly restartAttempts = new Map<string, number>();
  private closed = false;
  private lastGovee2MqttCount = 0;
  private unsubscribeHomeDevices?: () => void;

  constructor(
    private readonly engine: KitsuneCompatibilityEngine,
    private readonly homeService?: StandaloneHomeService,
    private readonly onDevicesSync?: () => void,
  ) {
    if (this.homeService && typeof this.homeService.devices?.subscribe === 'function') {
      this.unsubscribeHomeDevices = this.homeService.devices.subscribe((event) => {
        if (event.type !== 'device_registered' && event.type !== 'device_removed') return;
        const count = this.homeService!.devices.listDevices().filter((d) =>
          isGovee2MqttDevice(d),
        ).length;
        if (count !== this.lastGovee2MqttCount) {
          this.lastGovee2MqttCount = count;
          if (this.bridges.size > 0) this.onDevicesSync?.();
        }
      });
    }
  }

  supports(
    manifest: Pick<AppManifest, 'id'> & Partial<Pick<AppManifest, 'image' | 'env'>>,
    catalogEntry?: AppCatalogEntry,
  ): boolean {
    if (isDockerGovee2MqttManifest(manifest)) return false;
    const runtimeEnv =
      manifest.env && typeof manifest.env === 'object' && 'HAUS_PLUGIN_RUNTIME' in manifest.env
        ? manifest.env.HAUS_PLUGIN_RUNTIME
        : undefined;
    return (
      catalogEntry?.runtimeType === 'homebridge' ||
      runtimeEnv === 'homebridge' ||
      manifest.id.startsWith('homebridge-') ||
      manifest.id.startsWith('hb-') ||
      isHomebridgeGoveeAppId(manifest.id)
    );
  }

  isRunning(appId: string): boolean {
    return Boolean(this.bridges.get(appId)?.bridge.isRunning);
  }
  async configure(options: { dataDirectory: string }): Promise<void> {
    this.dataDirectory = options.dataDirectory;
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
    if (this.homeService && !this.homeService.appManager.canExecuteAppLocally(appId)) return false;
    if (entry.state !== 'running' && !this.desiredRunning.has(appId)) return false;
    try {
      await this.startBridge(appId, entry.manifest, entry.config);
      return this.isRunning(appId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto-recovery start failed for ${appId}: ${reason}`);
      this.appendLog(appId, `Auto-recovery start failed: ${reason}`);
      this.scheduleAutoRestart(appId);
      return false;
    }
  }

  async restore(entries: readonly InstalledAppEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!this.supports(entry.manifest)) continue;
      const appId = entry.manifest.id;
      if (isHomebridgeGoveeAppId(appId) && entry.state !== 'stopped' && this.homeService) {
        pruneSupersededMqttGoveeOutlets(this.homeService);
      }
      if (entry.state !== 'running' || this.isRunning(appId)) continue;
      this.desiredRunning.add(appId);
      try {
        await this.startBridge(appId, entry.manifest, entry.config);
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
    onProgress?.({
      stage: 'pulling',
      detail: `Preparing Homebridge plugin ${appId}…`,
      logLine: `Resolving Homebridge package for ${entry.manifest.name}`,
    });
    onProgress?.({
      stage: 'creating',
      detail: 'Allocating isolated Homebridge bridge workspace…',
      logLine: `Created isolated bridge configuration for ${appId}`,
    });
    onProgress?.({
      stage: 'starting',
      detail: 'Starting Homebridge child runner…',
      logLine: `Launching Homebridge runner for ${entry.manifest.name}…`,
    });
    await this.startBridge(appId, entry.manifest, entry.config);
    const logs = this.getLogs(appId);
    if (logs && logs.length > 0) {
      onProgress?.({ stage: 'starting', logs: logs.slice(-20) });
    }
    return { logs };
  }

  async execute(entry: InstalledAppEntry, action: AppAction): Promise<void> {
    const appId = entry.manifest.id;
    if (action === 'start') return this.startBridge(appId, entry.manifest, entry.config);
    if (action === 'stop') return this.stopBridge(appId, true);
    if (action === 'restart') {
      await this.stopBridge(appId, false);
      await this.startBridge(appId, entry.manifest, entry.config);
    }
  }

  async inspect(entry: InstalledAppEntry): Promise<Partial<AppInfo> | undefined> {
    const active = this.bridges.get(entry.manifest.id);
    if (active?.bridge.isRunning) {
      entry.state = 'running';
    } else if (entry.state === 'running') {
      entry.state = 'stopped';
    }
    if (!active?.catalog) return undefined;
    const modeLabel =
      entry.manifest.id === HYBRID_GOVEE_APP_ID
        ? `Hybrid Govee (${active.catalog.allModels.size} Homebridge outlet models, BLE: ${active.bleMode})`
        : `Homebridge runtime (${active.catalog.allModels.size} outlet models, BLE: ${active.bleMode})`;
    return {
      description: `${entry.manifest.description ?? entry.manifest.name} — ${modeLabel}`,
    };
  }

  async configureApp(entry: InstalledAppEntry, config: Record<string, unknown>): Promise<void> {
    const appId = entry.manifest.id;
    if (isHomebridgeGoveeAppId(appId) && this.homeService && config.hybridSplit !== false) {
      pruneSupersededMqttGoveeOutlets(this.homeService);
    }
    if (entry.state === 'running' || this.bridges.has(appId) || this.desiredRunning.has(appId)) {
      await this.stopBridge(appId, false);
      await this.startBridge(appId, entry.manifest, config);
    } else {
      this.onDevicesSync?.();
    }
  }

  async updateApp(
    entry: InstalledAppEntry,
    targetManifest: AppManifest,
  ): Promise<{ logs?: readonly string[] }> {
    const appId = entry.manifest.id;
    const wasRunning =
      entry.state === 'running' || this.bridges.has(appId) || this.desiredRunning.has(appId);
    const hasOverridePath =
      typeof entry.config.pluginPath === 'string' && entry.config.pluginPath.trim().length > 0;
    await this.stopBridge(appId, false);
    await this.resolvePluginRuntime(appId, targetManifest, entry.config, !hasOverridePath);
    if (wasRunning) {
      await this.startBridge(appId, targetManifest, entry.config);
    }
    return { logs: this.getLogs(appId) };
  }

  async removeApp(entry: InstalledAppEntry): Promise<void> {
    const appId = entry.manifest.id;
    await this.stopBridge(appId, true);
    this.logBuffer.delete(appId);
  }

  getLogs(appId: string): readonly string[] | undefined {
    return this.logBuffer.get(appId);
  }
  subscribeLogs(appId: string, onLine: (line: string) => void): () => void {
    return this.logBuffer.subscribe(appId, onLine);
  }
  getNativeConfigSchema(appId: string): Record<string, NativeConfigFieldMeta> | undefined {
    return readHomebridgeConfigSchema(this.bridges.get(appId)?.pluginDirectory);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsubscribeHomeDevices?.();
    this.unsubscribeHomeDevices = undefined;
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    this.desiredRunning.clear();
    const activeIds = Array.from(this.bridges.keys());
    await Promise.allSettled(activeIds.map((appId) => this.stopBridge(appId, true)));
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
    this.logger.warn(
      `Scheduling automatic restart #${attempt + 1} for ${appId} in ${Math.round(delayMs / 1000)}s`,
    );
    this.appendLog(appId, `Scheduling restart #${attempt + 1} in ${Math.round(delayMs / 1000)}s`);
    const timer = setTimeout(() => {
      this.restartTimers.delete(appId);
      if (this.closed || !this.desiredRunning.has(appId) || this.isRunning(appId)) return;
      const entry = this.homeService?.appManager.getInstalledApp(appId);
      if (!entry) return;
      if (this.homeService && !this.homeService.appManager.canExecuteAppLocally(appId)) {
        return;
      }
      void this.startBridge(appId, entry.manifest, entry.config).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Auto-restart failed for ${appId}: ${reason}`);
        this.appendLog(appId, `Auto-restart failed: ${reason}`);
        this.scheduleAutoRestart(appId);
      });
    }, delayMs);
    timer.unref();
    this.restartTimers.set(appId, timer);
  }

  private resolvePluginRuntime(
    appId: string,
    manifest: Pick<AppManifest, 'version' | 'env'>,
    config: Record<string, unknown>,
    forceInstall = false,
  ): Promise<{ pluginDirectory: string; catalog?: GoveeOutletCatalog }> {
    const catalogEntry = this.homeService?.getAppCatalogEntry(appId);
    return resolveHomebridgePluginRuntime({
      appId,
      manifest,
      catalogEntry,
      config,
      dataDirectory: this.dataDirectory,
      forceInstall,
      onLog: (line) => this.appendLog(appId, line),
    });
  }

  private registerConfigSecrets(appId: string, config: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(config)) {
      if (
        typeof value === 'string' &&
        /password|secret|token|key|code/i.test(key) &&
        value.length > 0
      ) {
        this.engine.secrets.setSecret('homebridge', appId, key, value);
      }
    }
  }

  private buildChildConfig(
    appId: string,
    manifest: AppManifest,
    rawConfig: Record<string, unknown>,
  ): HomebridgePluginConfig {
    return buildHomebridgeChildConfig({
      isGovee: isHomebridgeGoveeAppId(appId),
      manifestName: manifest.name,
      rawConfig,
    }) as HomebridgePluginConfig;
  }

  private acquireOrRestartBridgeSession(appId: string) {
    const currentLease = this.engine.getSession('homebridge', appId);
    if (currentLease && currentLease.status === 'active') {
      if (currentLease.ownerId === BRIDGE_OWNER_ID) {
        return this.engine.restartSession('homebridge', appId, BRIDGE_OWNER_ID);
      }
      // Reclaim orphaned session leased under a non-bridge owner (prevents permanent session conflict).
      this.logger.warn(
        `Reclaiming orphaned Homebridge session for ${appId} (previous owner: ${currentLease.ownerId})`,
      );
      this.engine.releaseSession('homebridge', appId, currentLease.ownerId);
    }
    return this.engine.acquireSession('homebridge', appId, BRIDGE_OWNER_ID);
  }

  private async startBridge(
    appId: string,
    manifest: AppManifest,
    config: Record<string, unknown>,
  ): Promise<void> {
    const existingStart = this.startInFlight.get(appId);
    if (existingStart) return existingStart;

    this.clearRestartTimer(appId);
    this.desiredRunning.add(appId);

    const task = (async () => {
      await this.stopBridge(appId, false);
      this.registerConfigSecrets(appId, config);

      const { pluginDirectory, catalog } = await this.resolvePluginRuntime(
        appId,
        manifest,
        config,
        false,
      );
      const bleEnv = resolveHomebridgeBleEnvironment();
      this.appendLog(appId, `BLE transport mode: ${bleEnv.mode} (${bleEnv.reason})`);

      const safeAppSegment = appId.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const storagePath = join(this.dataDirectory, 'kitsune', 'homebridge', safeAppSegment);
      await mkdir(storagePath, { recursive: true });

      const bridgeConfig = this.buildChildConfig(appId, manifest, config);
      const bridge = new HomebridgeChildBridge({
        pluginName: appId,
        config: bridgeConfig,
        memoryMb: BRIDGE_MEMORY_MB,
        pluginPath: pluginDirectory,
        storagePath,
        dataDirectory: this.dataDirectory,
      });

      const lease = this.acquireOrRestartBridgeSession(appId);
      this.engine.attachHomebridgeBridge(appId, lease.ownerId, lease.epoch, bridge);

      const record: ActiveBridgeRecord = {
        bridge,
        epoch: lease.epoch,
        pluginDirectory,
        bleMode: bleEnv.mode,
        catalog,
      };
      this.bridges.set(appId, record);

      bridge.on('stdout', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) this.appendLog(appId, line);
        }
      });
      bridge.on('stderr', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line.trim()) this.appendLog(appId, `[stderr] ${line}`);
        }
      });
      bridge.on('error', (err: Error) => {
        this.logger.warn(`Bridge process error for ${appId}: ${err.message}`);
        this.appendLog(appId, `Bridge process error: ${err.message}`);
      });
      bridge.on('exit', (info: { code: number | null; signal: string | null }) => {
        const current = this.bridges.get(appId);
        if (current?.bridge === bridge) {
          if (current.healthyTimer) clearTimeout(current.healthyTimer);
          this.bridges.delete(appId);
          const msg = `Bridge exited (code=${String(info.code)}, signal=${String(info.signal)})`;
          this.logger.warn(`${appId}: ${msg}`);
          this.appendLog(appId, msg);
          if (!this.closed && this.desiredRunning.has(appId)) {
            this.scheduleAutoRestart(appId);
          }
        }
      });

      if (isHomebridgeGoveeAppId(appId) && this.homeService && config.hybridSplit !== false) {
        const pruned = pruneSupersededMqttGoveeOutlets(this.homeService);
        if (pruned > 0) {
          this.appendLog(
            appId,
            `Handed over ${pruned} Govee smart outlet(s) from govee2mqtt to Homebridge Govee`,
          );
        }
      }

      await bridge.start();
      record.healthyTimer = setTimeout(() => {
        if (this.bridges.get(appId)?.bridge === bridge) {
          this.restartAttempts.delete(appId);
        }
      }, HEALTHY_RESET_MS);
      record.healthyTimer.unref();
      this.logger.log(`Started Homebridge child bridge for ${appId} (BLE: ${bleEnv.mode})`);
      this.onDevicesSync?.();
    })();

    this.startInFlight.set(appId, task);
    try {
      await task;
    } finally {
      this.startInFlight.delete(appId);
    }
  }

  private async stopBridge(appId: string, releaseSession: boolean): Promise<void> {
    if (releaseSession) {
      this.desiredRunning.delete(appId);
      this.clearRestartTimer(appId);
      this.restartAttempts.delete(appId);
    }
    const active = this.bridges.get(appId);
    if (active) {
      if (active.healthyTimer) clearTimeout(active.healthyTimer);
      this.bridges.delete(appId);
      await active.bridge.stop();
    }
    if (releaseSession) {
      const existing = this.engine.getSession('homebridge', appId);
      if (existing && existing.status === 'active') {
        try {
          this.engine.releaseSession('homebridge', appId, existing.ownerId);
        } catch {
          // Ignore session ownership mismatch when releasing stale state.
        }
      }
      this.onDevicesSync?.();
    }
  }

  private appendLog(appId: string, rawLine: string): void {
    this.logBuffer.append(
      appId,
      `[${new Date().toISOString()}] ${this.engine.secrets.redactText(rawLine)}`,
    );
  }
}
