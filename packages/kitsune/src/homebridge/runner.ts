/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import Module, { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KitsuneCommandPayload } from '../engine.js';
import { HomebridgeVirtualApi } from './api.js';
import { loadHomebridgePlatform, resolveHomebridgePluginEntrypoint } from './loader.js';
import type { HomebridgePluginConfig } from './types.js';

type ModuleInternals = typeof Module & {
  _load(request: string, parent: Module | undefined, isMain: boolean): unknown;
};

function installHomebridgeModuleShims(api: HomebridgeVirtualApi): void {
  const hapShim: Record<string, unknown> = {
    ...api.hap,
    PlatformAccessory: api.platformAccessory,
    PluginAPI: HomebridgeVirtualApi,
    HomebridgeAPI: HomebridgeVirtualApi,
    hap: api.hap,
    __esModule: true,
  };
  const internals = Module as ModuleInternals;
  const originalLoad = internals._load;
  internals._load = function (request: string, parent: Module | undefined, isMain: boolean) {
    if (request === 'homebridge' || request === 'hap-nodejs') {
      return hapShim;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  (globalThis as Record<string, unknown>).__hausVirtualHapShim = hapShim;
  const VIRTUAL_PREFIX = 'haus-virtual-hb:';
  if (typeof registerHooks === 'function') {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === 'homebridge' || specifier === 'hap-nodejs') {
          return { url: `${VIRTUAL_PREFIX}${specifier}`, shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (url.startsWith(VIRTUAL_PREFIX)) {
          const keys = Object.keys(hapShim).filter(
            (k) => k !== '__esModule' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k),
          );
          const named = keys.map((k) => `export const ${k} = shim.${k};`).join('\n');
          return {
            format: 'module',
            shortCircuit: true,
            source: `const shim = globalThis.__hausVirtualHapShim;\nexport default shim;\n${named}\n`,
          };
        }
        return nextLoad(url, context);
      },
    });
  }
}

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
  installHomebridgeModuleShims(api);
  try {
    const { prepareHomebridgeBleRuntime } = await import('./ble-env.js');
    const bleEnv = prepareHomebridgeBleRuntime();
    if (bleEnv.mode === 'unavailable') {
      console.warn(
        `[${pluginName}] BLE transport unavailable (${bleEnv.reason}); using network/cloud paths`,
      );
    }
    const entrypoint = resolveHomebridgePluginEntrypoint(pluginPath);
    const mod = (await import(entrypoint)) as {
      default?:
        ((api: HomebridgeVirtualApi) => void) | { default?: (api: HomebridgeVirtualApi) => void };
    };
    const pluginModule =
      typeof mod.default === 'function'
        ? mod.default
        : typeof mod.default === 'object' && typeof mod.default?.default === 'function'
          ? mod.default.default
          : undefined;
    if (!pluginModule) {
      throw new Error(`kitsune_homebridge_invalid_plugin_export:${pluginName}`);
    }
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
    if (process.connected) process.send?.({ type: 'ready' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Failed to load Homebridge platform for ${pluginName}:`, err);
    if (process.connected) process.send?.({ type: 'loadError', error: detail });
    process.exit(1);
  }
}

const keepAlive = setInterval(() => {}, 60000);
process.on('unhandledRejection', (reason: unknown) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  console.error(`[${pluginName}] Unhandled promise rejection in child bridge: ${detail}`);
});
process.on('uncaughtException', (err: Error) => {
  console.error(`[${pluginName}] Uncaught exception in child bridge: ${err.stack ?? err.message}`);
});
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
