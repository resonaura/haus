/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  AppAction,
  AppCatalogEntry,
  AppInfo,
  AppInstallProgressUpdate,
  AppManifest,
} from '@haus/apps';
import type { HausDevice } from '@haus/core/device';
import {
  HOMEBRIDGE_GOVEE_PACKAGE,
  HomebridgeChildBridge,
  PluginInstaller,
  loadHomebridgeGoveeOutletCatalog,
  resolveHomebridgeBleEnvironment,
  resolveHomebridgeGoveePluginDirectory,
  setActiveGoveeOutletCatalog,
  type GoveeOutletCatalog,
  type HomebridgePluginConfig,
  type KitsuneCompatibilityEngine,
} from '@haus/kitsune';
import type { InstalledAppEntry, StandaloneRuntimeBridge } from '../home/app-driver.js';
import type { StandaloneHomeService } from '../home/home.service.js';
import {
  HYBRID_GOVEE_APP_ID,
  isDockerGovee2MqttManifest,
  isGovee2MqttDevice,
  isHomebridgeGoveeAppId,
  isHomebridgeGoveeInstanceId,
  isHomebridgeGoveeOutletsOnlyActive,
  pruneSupersededMqttGoveeOutlets,
  reconcileHomebridgeGoveeDevice,
  shouldAdmitHomebridgeGoveeDevice,
} from '../mqtt/govee-hybrid.js';

const MAX_LOG_LINES = 300;
const BRIDGE_OWNER_ID = 'hub-homebridge';

interface ActiveBridgeRecord {
  readonly bridge: HomebridgeChildBridge;
  readonly epoch: number;
  readonly pluginDirectory: string;
  readonly bleMode: string;
  readonly catalog?: GoveeOutletCatalog;
}

export function normalizeKitsuneDeviceForHome(device: HausDevice): HausDevice {
  const prefix = `${device.id}:`;
  return {
    ...device,
    endpoints: device.endpoints.map((ep) => ({
      ...ep,
      id: ep.id.startsWith(prefix) ? ep.id : `${prefix}${ep.id}`,
    })),
  };
}

export function syncKitsuneDevicesToHome(params: {
  readonly homeService?: StandaloneHomeService;
  readonly syncedDeviceIds: Set<string>;
  readonly pendingAliases: Set<Promise<void>>;
  readonly devices: readonly HausDevice[];
}): void {
  const { homeService, syncedDeviceIds, pendingAliases, devices } = params;
  if (!homeService) return;

  const nextSynced = new Set<string>();
  for (const dev of devices) {
    let normalized = normalizeKitsuneDeviceForHome(dev);

    if (isHomebridgeGoveeInstanceId(dev.source.instanceId)) {
      const pluginId = dev.source.instanceId.slice('homebridge:'.length);
      const outletsOnly = isHomebridgeGoveeOutletsOnlyActive(homeService, pluginId);
      if (!shouldAdmitHomebridgeGoveeDevice(normalized, outletsOnly)) {
        continue;
      }
    }

    const existing = homeService.getDevice(normalized.id);
    if (
      existing?.roomId &&
      (normalized.roomId === 'default' || normalized.roomId === 'unassigned') &&
      existing.roomId !== 'default' &&
      existing.roomId !== 'unassigned'
    ) {
      normalized = {
        ...normalized,
        roomId: existing.roomId,
        areaId: existing.areaId,
      };
    }

    if (isHomebridgeGoveeInstanceId(dev.source.instanceId)) {
      const reconciled = reconcileHomebridgeGoveeDevice(homeService, normalized);
      normalized = reconciled.device;
      for (const promise of reconciled.aliasPromises) {
        pendingAliases.add(promise);
        void promise.finally(() => {
          pendingAliases.delete(promise);
        });
      }
    }

    nextSynced.add(normalized.id);
    homeService.registerDevice(normalized);
  }

  for (const previousId of syncedDeviceIds) {
    if (!nextSynced.has(previousId)) {
      homeService.removeDevice(previousId);
    }
  }

  syncedDeviceIds.clear();
  for (const id of nextSynced) {
    syncedDeviceIds.add(id);
  }
}

export class HomebridgeAppSupervisor implements StandaloneRuntimeBridge {
  private dataDirectory = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  private readonly bridges = new Map<string, ActiveBridgeRecord>();
  private readonly logsByApp = new Map<string, string[]>();
  private readonly startInFlight = new Map<string, Promise<void>>();
  private lastGovee2MqttCount = 0;
  private unsubscribeHomeDevices?: () => void;

  constructor(
    private readonly engine: KitsuneCompatibilityEngine,
    private readonly homeService?: StandaloneHomeService,
    private readonly onDevicesSync?: () => void,
  ) {
    if (this.homeService && typeof this.homeService.subscribeDevices === 'function') {
      this.unsubscribeHomeDevices = this.homeService.subscribeDevices(() => {
        const count = this.homeService!.listDevices().filter((d) => isGovee2MqttDevice(d)).length;
        if (count !== this.lastGovee2MqttCount) {
          this.lastGovee2MqttCount = count;
          if (this.bridges.size > 0) this.onDevicesSync?.();
        }
      });
    }
  }

  supports(
    manifest: Pick<AppManifest, 'id'> & Partial<Pick<AppManifest, 'image'>>,
    catalogEntry?: AppCatalogEntry,
  ): boolean {
    if (isDockerGovee2MqttManifest(manifest)) return false;
    return catalogEntry?.runtimeType === 'homebridge' || isHomebridgeGoveeAppId(manifest.id);
  }

  async configure(options: { dataDirectory: string }): Promise<void> {
    this.dataDirectory = options.dataDirectory;
  }

  async restore(entries: readonly InstalledAppEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!this.supports(entry.manifest)) continue;
      if (
        isHomebridgeGoveeAppId(entry.manifest.id) &&
        entry.state !== 'stopped' &&
        this.homeService
      ) {
        pruneSupersededMqttGoveeOutlets(this.homeService);
      }
      if (entry.state !== 'running' || this.bridges.has(entry.manifest.id)) continue;
      try {
        await this.startBridge(entry.manifest.id, entry.manifest, entry.config);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.appendLog(entry.manifest.id, `Restore failed: ${reason}`);
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
    await this.startBridge(appId, entry.manifest, entry.config);
    return { logs: this.getLogs(appId) };
  }

  async execute(entry: InstalledAppEntry, action: AppAction): Promise<void> {
    const appId = entry.manifest.id;
    if (action === 'start') {
      await this.startBridge(appId, entry.manifest, entry.config);
      return;
    }
    if (action === 'stop') {
      await this.stopBridge(appId, true);
      return;
    }
    if (action === 'restart') {
      await this.stopBridge(appId, false);
      await this.startBridge(appId, entry.manifest, entry.config);
    }
  }

  async inspect(entry: InstalledAppEntry): Promise<Partial<AppInfo> | undefined> {
    const active = this.bridges.get(entry.manifest.id);
    if (active) {
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
    if (entry.state === 'running' || this.bridges.has(appId)) {
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
    const wasRunning = entry.state === 'running' || this.bridges.has(appId);
    const hasOverridePath =
      typeof entry.config.pluginPath === 'string' && entry.config.pluginPath.trim().length > 0;
    await this.stopBridge(appId, false);
    await this.resolvePluginRuntime(appId, entry.config, !hasOverridePath);
    if (wasRunning) {
      await this.startBridge(appId, targetManifest, entry.config);
    }
    return { logs: this.getLogs(appId) };
  }

  async removeApp(entry: InstalledAppEntry): Promise<void> {
    const appId = entry.manifest.id;
    await this.stopBridge(appId, true);
    this.logsByApp.delete(appId);
  }

  getLogs(appId: string): readonly string[] | undefined {
    const lines = this.logsByApp.get(appId);
    return lines ? [...lines] : undefined;
  }

  async close(): Promise<void> {
    this.unsubscribeHomeDevices?.();
    this.unsubscribeHomeDevices = undefined;
    const activeIds = Array.from(this.bridges.keys());
    await Promise.allSettled(activeIds.map((appId) => this.stopBridge(appId, true)));
  }

  private async resolvePluginRuntime(
    appId: string,
    config: Record<string, unknown>,
    forceInstall = false,
  ): Promise<{ pluginDirectory: string; catalog?: GoveeOutletCatalog }> {
    const explicitPath =
      typeof config.pluginPath === 'string' && config.pluginPath.trim().length > 0
        ? resolve(config.pluginPath.trim())
        : undefined;

    if (isHomebridgeGoveeAppId(appId)) {
      let resolvedDir: string | undefined;
      if (!forceInstall) {
        resolvedDir = explicitPath
          ? explicitPath
          : await resolveHomebridgeGoveePluginDirectory({
              pluginDirectory: explicitPath,
              dataDirectory: this.dataDirectory,
              searchRoots: [
                join(this.dataDirectory, 'kitsune', 'plugins'),
                join(this.dataDirectory, 'apps'),
              ],
            });
      }

      if (!resolvedDir) {
        const installer = new PluginInstaller(this.dataDirectory);
        const installed = await installer.install(HOMEBRIDGE_GOVEE_PACKAGE, 'latest');
        resolvedDir = installed.directory;
      }

      const catalog = await loadHomebridgeGoveeOutletCatalog({
        pluginDirectory: resolvedDir,
        dataDirectory: this.dataDirectory,
      });
      setActiveGoveeOutletCatalog(catalog);
      this.appendLog(
        appId,
        `Loaded Govee outlet catalog (${catalog.source}, ${catalog.allModels.size} outlet models${catalog.pluginVersion ? `, v${catalog.pluginVersion}` : ''})`,
      );
      return { pluginDirectory: resolvedDir, catalog };
    }

    if (explicitPath) {
      return { pluginDirectory: explicitPath };
    }

    const packageName =
      typeof config.packageName === 'string' && config.packageName.trim().length > 0
        ? config.packageName.trim()
        : appId;
    const installer = new PluginInstaller(this.dataDirectory);
    const installed = await installer.install(packageName, 'latest');
    return { pluginDirectory: installed.directory };
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
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      if (['pluginPath', 'hybridSplit', 'outletsOnly', 'packageName', '_bridge'].includes(key)) {
        continue;
      }
      if ((key === 'code' || key === 'apiKey') && (typeof value !== 'string' || !value.trim())) {
        continue;
      }
      cleaned[key] = value;
    }

    if (isHomebridgeGoveeAppId(appId)) {
      return {
        // Leave bleDisable unset/user-controlled so native Bluetooth stays active out of the box.
        ...cleaned,
        platform:
          typeof cleaned.platform === 'string' && cleaned.platform.trim().length > 0
            ? cleaned.platform
            : 'Govee',
        name:
          typeof cleaned.name === 'string' && cleaned.name.trim().length > 0
            ? cleaned.name
            : 'Govee',
      };
    }

    return {
      ...cleaned,
      name:
        typeof cleaned.name === 'string' && cleaned.name.trim().length > 0
          ? cleaned.name
          : manifest.name,
    };
  }

  private async startBridge(
    appId: string,
    manifest: AppManifest,
    config: Record<string, unknown>,
  ): Promise<void> {
    const existingStart = this.startInFlight.get(appId);
    if (existingStart) return existingStart;

    const task = (async () => {
      await this.stopBridge(appId, false);
      this.registerConfigSecrets(appId, config);

      const { pluginDirectory, catalog } = await this.resolvePluginRuntime(appId, config, false);
      const bleEnv = resolveHomebridgeBleEnvironment();
      this.appendLog(appId, `BLE transport mode: ${bleEnv.mode} (${bleEnv.reason})`);

      const safeAppSegment = appId.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const storagePath = join(this.dataDirectory, 'kitsune', 'homebridge', safeAppSegment);
      await mkdir(storagePath, { recursive: true });

      const bridgeConfig = this.buildChildConfig(appId, manifest, config);
      const bridge = new HomebridgeChildBridge({
        pluginName: appId,
        config: bridgeConfig,
        pluginPath: pluginDirectory,
        storagePath,
        dataDirectory: this.dataDirectory,
      });

      const currentLease = this.engine.getSession('homebridge', appId);
      const lease =
        currentLease && currentLease.status === 'active'
          ? this.engine.restartSession('homebridge', appId, BRIDGE_OWNER_ID)
          : this.engine.acquireSession('homebridge', appId, BRIDGE_OWNER_ID);

      this.engine.attachHomebridgeBridge(appId, lease.ownerId, lease.epoch, bridge);
      this.bridges.set(appId, {
        bridge,
        epoch: lease.epoch,
        pluginDirectory,
        bleMode: bleEnv.mode,
        catalog,
      });

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
        this.appendLog(appId, `Bridge process error: ${err.message}`);
      });
      bridge.on('exit', (info: { code: number | null; signal: string | null }) => {
        const record = this.bridges.get(appId);
        if (record?.bridge === bridge) {
          this.bridges.delete(appId);
          this.appendLog(
            appId,
            `Bridge exited (code=${String(info.code)}, signal=${String(info.signal)})`,
          );
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
    const active = this.bridges.get(appId);
    if (active) {
      this.bridges.delete(appId);
      await active.bridge.stop();
    }
    if (releaseSession) {
      const existing = this.engine.getSession('homebridge', appId);
      if (existing && existing.status === 'active') {
        try {
          this.engine.releaseSession('homebridge', appId, BRIDGE_OWNER_ID);
        } catch {
          // Ignore session ownership mismatch when releasing stale state.
        }
      }
      this.onDevicesSync?.();
    }
  }

  private appendLog(appId: string, rawLine: string): void {
    const lines = this.logsByApp.get(appId) ?? [];
    lines.push(`[${new Date().toISOString()}] ${this.engine.secrets.redactText(rawLine)}`);
    if (lines.length > MAX_LOG_LINES) {
      lines.splice(0, lines.length - MAX_LOG_LINES);
    }
    this.logsByApp.set(appId, lines);
  }
}
