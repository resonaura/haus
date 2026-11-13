/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KitsuneCommandPayload } from '../engine.js';
import { HomebridgeVirtualApi } from './api.js';
import { loadHomebridgePlatform, resolveHomebridgePluginEntrypoint } from './loader.js';
import type { HomebridgePluginConfig } from './types.js';

const pluginName = process.env.HOMEBRIDGE_PLUGIN_NAME ?? '';
let config: HomebridgePluginConfig = { name: pluginName };
try {
  if (process.env.HOMEBRIDGE_CONFIG) {
    config = JSON.parse(process.env.HOMEBRIDGE_CONFIG);
  }
} catch {
  // Use default config fallback
}

const storagePath =
  process.env.HOMEBRIDGE_STORAGE_PATH ||
  join(tmpdir(), `homebridge-${pluginName.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
const pluginPath = process.env.HOMEBRIDGE_PLUGIN_PATH;

const pin =
  (typeof (config._bridge as Record<string, unknown>)?.pin === 'string'
    ? ((config._bridge as Record<string, unknown>).pin as string)
    : undefined) ??
  (typeof config.pin === 'string' ? (config.pin as string) : undefined) ??
  (pluginName === 'homebridge-sample' ? '031-45-154' : undefined);

console.log(`Starting child bridge for ${pluginName}`);
if (pin) {
  console.log(`Enter code: ${pin}`);
  console.log(
    `Scan this code with your Home app: [X-HM://0023ISYWY${pluginName.replace(/[^A-Z0-9]/gi, '').slice(0, 5)}]`,
  );
}

const api = new HomebridgeVirtualApi({
  storagePath,
  pluginId: pluginName || undefined,
});

if (process.connected && process.send) {
  api.on('devicesChanged', (devices) => {
    process.send?.({ type: 'devices', devices });
  });
  api.on('deviceStateChanged', (deviceId, readings) => {
    process.send?.({ type: 'state', deviceId, readings });
  });
  api.on('unsupportedCapability', (item) => {
    process.send?.({ type: 'unsupportedCapability', item });
  });

  process.on('message', async (input: unknown) => {
    const msg = input as {
      type?: string;
      id?: number;
      command?: KitsuneCommandPayload;
    };
    if (msg.type === 'command' && msg.command) {
      try {
        const ok = await api.executeCommand(msg.command);
        process.send?.({ type: 'result', id: msg.id, result: { ok } });
      } catch (err: unknown) {
        process.send?.({
          type: 'error',
          id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (msg.type === 'getDevices') {
      process.send?.({ type: 'result', id: msg.id, result: api.getHausDevices() });
    } else if (msg.type === 'shutdown') {
      api.emit('shutdown');
      process.exit(0);
    }
  });
}

if (pluginPath) {
  try {
    const { prepareHomebridgeBleRuntime } = await import('./ble-env.js');
    const bleEnv = prepareHomebridgeBleRuntime();
    if (bleEnv.mode === 'unavailable') {
      console.warn(
        `[${pluginName}] BLE transport unavailable (${bleEnv.reason}); using network/cloud paths`,
      );
    }
    const entrypoint = resolveHomebridgePluginEntrypoint(pluginPath);
    const mod = await import(entrypoint);
    const pluginModule = typeof mod.default === 'function' ? mod.default : mod;
    const platformName =
      (typeof config.platform === 'string' && config.platform) ||
      (typeof config.name === 'string' && config.name) ||
      pluginName;
    const baseLogger = (msg: string, ...args: unknown[]) => {
      console.log(`[${pluginName}] ${msg}`, ...args);
    };
    const logger = Object.assign(baseLogger, {
      info: (msg: string, ...args: unknown[]) => console.log(`[${pluginName}] ${msg}`, ...args),
      warn: (msg: string, ...args: unknown[]) => console.warn(`[${pluginName}] ${msg}`, ...args),
      error: (msg: string, ...args: unknown[]) => console.error(`[${pluginName}] ${msg}`, ...args),
      debug: (msg: string, ...args: unknown[]) => console.debug(`[${pluginName}] ${msg}`, ...args),
      log: (msg: string, ...args: unknown[]) => console.log(`[${pluginName}] ${msg}`, ...args),
    });
    await loadHomebridgePlatform({
      api,
      pluginName,
      platformName,
      config,
      storagePath,
      pluginModule,
      logger,
    });
  } catch (err) {
    console.error(`Failed to load Homebridge platform for ${pluginName}:`, err);
  }
}

const keepAlive = setInterval(() => {}, 60000);
process.on('SIGTERM', () => {
  clearInterval(keepAlive);
  api.emit('shutdown');
  process.exit(0);
});
process.on('SIGINT', () => {
  clearInterval(keepAlive);
  api.emit('shutdown');
  process.exit(0);
});
