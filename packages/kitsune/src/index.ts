/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
export { Kitsune } from './hub.js';
export { KitsuneCameras, kitsuneDeviceIdentity } from './haus.js';
export { createSdk } from './sdk/managers.js';
export { FileStorage } from './sdk/storage.js';
export { compatibilityGuard } from './sdk/proxy-guard.js';
export { PluginInstaller, type PluginInstallerOptions } from './runtime/installer.js';
export { PluginProcess } from './runtime/host.js';
export { vendorCatalog, type VendorPreset, type OnboardingField } from './vendors/catalog/index.js';
export { vendorRoute, onboardingSettings, type DriverRoute } from './vendors/overrides.js';
export { selectStreams } from './vendors/streams.js';
export {
  kitsuneToHausDevice,
  inspectScryptedDevice,
  executeScryptedCommand,
} from './scrypted/adapter.js';
export {
  KitsuneCompatibilityEngine,
  PluginSecretVault,
  sanitizedChildEnv,
  COMPATIBILITY_MATRIX,
} from './engine.js';
export type * from './engine.js';
export { SupervisorApiServer } from './supervisor/server.js';
export type {
  AddonSupervisorConfig,
  MqttServiceDetails,
  SupervisorApiResponse,
} from './supervisor/types.js';
export { IngressProxy } from './supervisor/ingress.js';
export type * from './supervisor/types.js';
export { HacsVirtualizer } from './hacs/virtualizer.js';
export { PythonSidecarHarness } from './hacs/sidecar.js';
export type * from './hacs/types.js';
export { HomebridgeVirtualApi } from './homebridge/api.js';
export type {
  PlatformConstructor,
  AccessoryConstructor,
  HomebridgePluginModule,
} from './homebridge/api.js';
export { HomebridgeLogInterceptor } from './homebridge/log-interceptor.js';
export { HomebridgeChildBridge } from './homebridge/child.js';
export { generateHapUuid, HAP_NAMESPACE } from './homebridge/uuid.js';
export { HomebridgeAccessoryCache } from './homebridge/cache.js';
export {
  loadHomebridgePlatform,
  resolveHomebridgePluginEntrypoint,
  ensureHomebridgeLogger,
  type HomebridgeLogger,
} from './homebridge/loader.js';
export {
  resolveHomebridgeBleEnvironment,
  prepareHomebridgeBleRuntime,
  parseEffectiveCapNetRaw,
  resolveSharedNodeModulesPaths,
  type HomebridgeBleTransportMode,
  type HomebridgeBleEnvironmentAssessment,
  type BleProbeInput,
} from './homebridge/ble-env.js';
export {
  HOMEBRIDGE_GOVEE_PACKAGE,
  HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK,
  loadHomebridgeGoveeOutletCatalog,
  resolveHomebridgeGoveePluginDirectory,
  isHomebridgeGoveeOutletModel,
  getGoveeOutletChannelCount,
  normalizeGoveeModel,
  getActiveGoveeOutletCatalog,
  setActiveGoveeOutletCatalog,
  resetActiveGoveeOutletCatalog,
  type GoveeOutletCatalog,
  type GoveeCatalogResolveOptions,
} from './homebridge/govee-catalog.js';
export { projectAccessoryToHausDevice, executeAccessoryCommand } from './homebridge/projection.js';
export {
  MockAccessory,
  MockService,
  MockCharacteristic,
  HAPServices,
  HAPCharacteristics,
} from './homebridge/hap.js';
export type * from './homebridge/types.js';
export type * from './contracts.js';
