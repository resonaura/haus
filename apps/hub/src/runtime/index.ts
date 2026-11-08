/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export { createHubService, type HubServiceOptions } from './application.js';
export { runtimeConfig, type RuntimeConfig, type NvrConfig } from './config.js';
export { NvrRuntime, type NvrDependencies } from './nvr.js';
export {
  nvrMdnsConfiguration,
  startNvrMdnsAdvertisement,
  type DiscoveryOptions,
} from './discovery.js';
export {
  SUPPORTED_HA_APPLIANCES,
  defaults,
  validateOptions,
  loadConfig,
  type HubOptions,
  type LoadedHubConfig,
} from './appliance-config.js';
export { createApi, requestBody, type CreateApiOptions } from './server/index.js';
export { bootstrapHub, Hub } from './bootstrap.js';
