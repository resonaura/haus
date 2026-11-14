/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export {
  computeVerhoeff,
  parseHomeKitPinPayload,
  parseHomeKitUriPayload,
  parseMatterManualPayload,
  parseMatterQrPayload,
  parseSetupCode,
  redactSetupCode,
  validateHomeKitPin,
  validateVerhoeff,
} from './code-parser.js';

export type {
  Advertisement,
  CommissioningAdapter,
  CommissioningContext,
  CommissioningEvent,
  CommissioningEventType,
  CommissioningProtocol,
  CommissioningResult,
  CommissioningState,
  CommissioningTransaction,
  HomeKitAccessoryClassification,
  HomeKitClassificationInfo,
  HomeKitOnboardingPayload,
  ImprovOnboardingPayload,
  MatterOnboardingPayload,
  NetworkCredentialProvider,
  OnboardingKind,
  ParseSetupCodeOptions,
  ParsedSetupCode,
  RadioAgent,
  RadioAgentPlatform,
  RadioConnection,
  RadioDevice,
  RequiredCredentialsPrompt,
  ScanRequest,
  VendorOnboardingPayload,
  WifiCredentials,
} from './types.js';

export type {
  ImprovCapabilities,
  ImprovCommandType,
  ImprovDeviceInfo,
  ImprovErrorType,
  ImprovRpcResult,
  ImprovSerialPacket,
  ImprovSerialTypeValue,
  ImprovServiceData,
  ImprovStateType,
  ImprovWifiScanEntry,
} from './improv.js';

export {
  IMPROV_BLE_CHUNK,
  IMPROV_CHARACTERISTICS,
  IMPROV_CMD_WIFI_SETTINGS,
  IMPROV_SERIAL_HEADER,
  IMPROV_SERIAL_VERSION,
  IMPROV_SERVICE_DATA_UUID,
  IMPROV_SERVICE_UUID,
  ImprovBlePacketReassembler,
  ImprovCapability,
  ImprovCommand,
  ImprovError,
  ImprovSerialFrameParser,
  ImprovSerialType,
  ImprovState,
  chunkImprovPacket,
  decodeImprovRpcResult,
  decodeImprovSerialPacket,
  encodeImprovDeviceInfoCommand,
  encodeImprovIdentifyCommand,
  encodeImprovRpcCommand,
  encodeImprovSerialPacket,
  encodeImprovWifiCommand,
  encodeImprovWifiScanCommand,
  improvChecksum,
  parseImprovCapabilities,
  parseImprovDeviceInfo,
  parseImprovServiceData,
  parseImprovWifiScan,
} from './improv.js';

export type { DiscoveredHomeKitBleAdvertisement, HomeKitClassificationInput } from './homekit.js';

export {
  APPLE_COMPANY_ID,
  HAP_INSTANCE_ID_DESCRIPTOR_UUID,
  HAP_PAIRING_FEATURES_CHAR_UUID,
  HAP_PAIRING_SERVICE_UUID,
  HAP_PAIRINGS_CHAR_UUID,
  HAP_PAIR_SETUP_CHAR_UUID,
  HAP_PAIR_VERIFY_CHAR_UUID,
  HOMEKIT_BLE_ADV_SUBTYPE,
  HapBleOpcode,
  HapBlePacketReassembler,
  HapBleStatus,
  REJECTED_FED3_UUID,
  chunkHapBlePdu,
  classifyHomeKitAccessory,
  decodeHapBleResponsePdu,
  encodeHapBleRequestPdu,
  hapBleStatusToString,
  isRejectedFed3Uuid,
  parseHomeKitBleAdvertisement,
} from './homekit.js';

export type { HomeKitMatcherRule } from './discovery-types.js';

export type {
  DiscoveryProtocol,
  DiscoveryStatus,
  DurableIdentityKind,
  DurableIdentity,
  DiscoveredCandidate,
  DiscoveryAdvertisementInput,
  ZeroconfMatcherRule,
  SsdpMatcherRule,
  DhcpMatcherRule,
  BluetoothMatcherRule,
  UsbMatcherRule,
  DiscoveryMatcherRule,
  DiscoveryFilter,
} from './discovery-types.js';

export {
  DiscoveryRegistry,
  computeDurableIdentities,
  globMatches,
  normalizeMac,
  normalizeUuid,
  pickPrimaryDurableId,
} from './discovery-deduplicator.js';

export type {
  CandidateMatchResult,
  DnsSdDetails,
  MatchCandidateOptions,
} from './dns-sd-matchers.js';

export {
  BUILTIN_DNS_SD_RULES,
  isCandidatePairingAvailable,
  isGenericDiscoveryDomain,
  matchAllDiscoveryRules,
  matchCandidateToSetupCode,
  matchesDiscoveryRule,
  normalizeZeroconfServiceType,
  parseDnsSdTxt,
  scoreDiscoveryRuleMatch,
  selectBestDiscoveryMatch,
} from './dns-sd-matchers.js';

export type {
  ExternalFlowProgressEntry,
  ExternalFlowRuntime,
  FlowStepType,
  FlowSource,
  FlowFormField,
  FlowCapabilityRequirement,
  IntegrationFlowStep,
  IntegrationFlowSession,
  FlowInitOptions,
  FlowSubmissionOptions,
  FlowCatalogManifest,
  FlowCatalogResolver,
  FlowDomainHandler,
} from './flow-types.js';

export type { DomainFlowDefinition, DomainFlowStepSpec } from './flow-domains.js';
export { KNOWN_FLOW_DOMAINS } from './flow-domains.js';
export { IntegrationFlowEngine } from './flow-engine.js';

export type {
  RadioAgentCapabilities,
  RadioAgentDescriptor,
  RadioAgentSessionLease,
  RadioRpcMessageType,
  RadioRpcMessage,
} from './radio-transport.js';

export {
  BoundedRpcQueue,
  RemoteRadioAgentProxy,
  isLeaseValid,
  sanitizeRadioRpcError,
} from './radio-transport.js';

export type {
  CredentialCipher,
  NetworkPermissionStatus,
  StoredThreadDataset,
  StoredWifiCredential,
  SystemNetworkInfo,
  SystemThreadAccessStatus,
  SystemThreadDatasetResult,
  SystemThreadProvider,
} from './credentials.js';

export {
  EncryptedNetworkCredentialStore,
  ManualWifiCredentialProvider,
  SystemAssistedThreadManager,
  redactThreadDataset,
  redactWifiCredentials,
  wipeBuffer,
  wipeWifiCredentials,
} from './credentials.js';

export type { ParsedThreadDataset, ThreadDatasetFields } from './thread-codec.js';

export { ThreadTlvTag, encodeThreadDatasetTlv, validateThreadDatasetTlv } from './thread-codec.js';

export type {
  PermissionEvaluationResult,
  PermissionEvaluationStatus,
  PlatformEnvironmentInput,
  PlatformOperatingSystem,
  PlatformPermissionKind,
  PlatformRadioCapabilities,
  RadioCapabilityKind,
} from './platform-matrix.js';

export { evaluatePlatformCapabilities } from './platform-matrix.js';

export type {
  VendorCandidate,
  VendorProtocol,
  VendorProvisioningOptions,
  VendorProvisioningResult,
} from './vendor.js';

export { classifyVendorDevice, provisionVendorDevice } from './vendor.js';
