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

function resolveFileVariant(baseDir: string, candidate: string): string | undefined {
  const cleaned = candidate.trim().replace(/^\.\//, '');
  if (!cleaned) return undefined;
  for (const rel of [
    cleaned,
    `${cleaned}.js`,
    `${cleaned}.cjs`,
    `${cleaned}.mjs`,
    `${cleaned}/index.js`,
    `${cleaned}/index.cjs`,
    `${cleaned}/index.mjs`,
  ]) {
    const full = resolve(baseDir, rel);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return undefined;
}

function extractPkgExportsRoot(exportsField: unknown, depth = 0): string | undefined {
  if (depth > 6) return undefined;
  if (typeof exportsField === 'string') return exportsField;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return undefined;
  }
  const obj = exportsField as Record<string, unknown>;
  const root = '.' in obj ? obj['.'] : obj;
  if (typeof root === 'string') return root;
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const cond = root as Record<string, unknown>;
    for (const key of ['import', 'node', 'default', 'require']) {
      const nested = extractPkgExportsRoot(cond[key], depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function resolveHomebridgePluginEntrypoint(pluginPathOrUrl: string): string {
  if (pluginPathOrUrl.startsWith('file://')) return pluginPathOrUrl;
  const resolved = resolve(pluginPathOrUrl);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    const pkgFile = join(resolved, 'package.json');
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
          main?: unknown;
          exports?: unknown;
        };
        if (typeof pkg.main === 'string') {
          const hit = resolveFileVariant(resolved, pkg.main);
          if (hit) return pathToFileURL(hit).href;
        }
        const expMain = extractPkgExportsRoot(pkg.exports);
        if (expMain) {
          const hit = resolveFileVariant(resolved, expMain);
          if (hit) return pathToFileURL(hit).href;
        }
      } catch {
        // fallback below
      }
    }
    const candidates = [
      'dist/index.js',
      'lib/index.js',
      'build/index.js',
      'src/index.js',
      'index.js',
    ];
    for (const rel of candidates) {
      const candidate = join(resolved, rel);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
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
    const accessoryCtor = api.getAccessoryConstructor(pluginName, platformName);
    if (accessoryCtor) {
      const instance = new accessoryCtor(logger, config as Record<string, unknown>, api);
      const services = typeof instance.getServices === 'function' ? instance.getServices() : [];
      if (Array.isArray(services) && services.length > 0) {
        const displayName =
          (typeof config.name === 'string' && config.name.trim()) || platformName || pluginName;
        const uuid = api.hap.uuid.generate(`${pluginName}:${displayName}`);
        const wrapped = new api.platformAccessory(displayName, uuid);
        for (const svc of services) {
          if (
            svc &&
            typeof svc.UUID === 'string' &&
            !wrapped.services.some((s) => s.UUID === svc.UUID)
          ) {
            wrapped.services.push(svc);
          }
        }
        api.registerPlatformAccessories(pluginName, platformName, [wrapped]);
      }
      api.emit('didFinishLaunching');
      return instance as unknown as HomebridgePlatformInstance;
    }
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

  if (typeof platform.accessories === 'function') {
    try {
      platform.accessories((foundAccessories) => {
        if (Array.isArray(foundAccessories) && foundAccessories.length > 0) {
          api.registerPlatformAccessories(pluginName, platformName, foundAccessories);
        }
      });
    } catch (err) {
      logger(`Failed to load static platform accessories for ${pluginName}: ${err}`);
    }
  }

  // Fire didFinishLaunching to let the platform initialize real discovery and connections
  api.emit('didFinishLaunching');

  return platform;
}
