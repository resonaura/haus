/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HomebridgeVirtualApi } from './api.js';
import type { HomebridgePluginConfig } from './types.js';
import { HomebridgeAccessoryCache } from './cache.js';
import type { MockAccessory } from './hap.js';

export interface HomebridgeLogger {
  (msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  log(msg: string, ...args: unknown[]): void;
}

export function ensureHomebridgeLogger(
  logger?: ((msg: string, ...args: unknown[]) => void) & Partial<HomebridgeLogger>,
): HomebridgeLogger {
  const base: ((msg: string, ...args: unknown[]) => void) & Partial<HomebridgeLogger> =
    logger ?? (() => {});
  if (
    typeof base.info === 'function' &&
    typeof base.warn === 'function' &&
    typeof base.error === 'function' &&
    typeof base.debug === 'function' &&
    typeof base.log === 'function'
  ) {
    return base as HomebridgeLogger;
  }
  return Object.assign((msg: string, ...args: unknown[]) => base(msg, ...args), {
    info: base.info ?? ((msg: string, ...args: unknown[]) => base(msg, ...args)),
    warn: base.warn ?? ((msg: string, ...args: unknown[]) => base(msg, ...args)),
    error: base.error ?? ((msg: string, ...args: unknown[]) => base(msg, ...args)),
    debug: base.debug ?? (() => {}),
    log: base.log ?? ((msg: string, ...args: unknown[]) => base(msg, ...args)),
  });
}

export function resolveHomebridgePluginEntrypoint(pluginPathOrUrl: string): string {
  if (pluginPathOrUrl.startsWith('file://')) return pluginPathOrUrl;
  const resolved = resolve(pluginPathOrUrl);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    const pkgFile = join(resolved, 'package.json');
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { main?: unknown };
        if (typeof pkg.main === 'string' && pkg.main.trim()) {
          return pathToFileURL(resolve(resolved, pkg.main)).href;
        }
      } catch {
        // fallback below
      }
    }
    const candidates = ['lib/index.js', 'dist/index.js', 'index.js'];
    for (const rel of candidates) {
      const candidate = join(resolved, rel);
      if (existsSync(candidate)) {
        return pathToFileURL(candidate).href;
      }
    }
  }
  return pathToFileURL(resolved).href;
}

export interface HomebridgePlatformInstance {
  configureAccessory?(accessory: MockAccessory): void;
  accessories?(callback: (foundAccessories: MockAccessory[]) => void): void;
  [key: string]: unknown;
}

export interface LoadPlatformOptions {
  api: HomebridgeVirtualApi;
  pluginName: string;
  platformName: string;
  config: HomebridgePluginConfig;
  logger?: (msg: string, ...args: unknown[]) => void;
  storagePath?: string;
  pluginModule?: (api: HomebridgeVirtualApi) => void;
}

/** Loads and boots a real Homebridge platform plugin through HomebridgeVirtualApi. */
export async function loadHomebridgePlatform(
  options: LoadPlatformOptions,
): Promise<HomebridgePlatformInstance> {
  const {
    api,
    pluginName,
    platformName,
    config,
    storagePath = api.user.storagePath(),
    pluginModule,
  } = options;
  const logger = ensureHomebridgeLogger(options.logger);

  await Promise.all([
    mkdir(storagePath, { recursive: true }).catch(() => {}),
    mkdir(api.user.persistPath(), { recursive: true }).catch(() => {}),
    mkdir(api.user.cachedAccessoryPath(), { recursive: true }).catch(() => {}),
  ]);

  if (pluginModule) {
    pluginModule(api);
  }

  const constructor = api.getPlatformConstructor(pluginName, platformName);
  if (!constructor) {
    throw new Error(`kitsune_homebridge_platform_not_registered:${pluginName}.${platformName}`);
  }

  const platform = new constructor(
    logger,
    config as Record<string, unknown>,
    api,
  ) as HomebridgePlatformInstance;

  // Restore durable cached accessories before didFinishLaunching
  const cached = await HomebridgeAccessoryCache.load(storagePath, pluginName);
  for (const acc of cached) {
    api.restoreCachedAccessory(pluginName, acc);
    if (typeof platform.configureAccessory === 'function') {
      try {
        platform.configureAccessory(acc);
      } catch (err) {
        logger(`Failed to configure cached accessory ${acc.displayName}: ${err}`);
      }
    }
  }

  // Fire didFinishLaunching to let the platform initialize real discovery and connections
  api.emit('didFinishLaunching');

  return platform;
}
