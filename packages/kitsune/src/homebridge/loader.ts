/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { HomebridgeVirtualApi } from './api.js';
import type { HomebridgePluginConfig } from './types.js';
import { HomebridgeAccessoryCache } from './cache.js';
import type { MockAccessory } from './hap.js';

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
  logger?: (msg: string) => void;
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
    logger = () => {},
    storagePath = api.user.storagePath(),
    pluginModule,
  } = options;

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
