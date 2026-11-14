/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  FlowCatalogManifest,
  FlowDomainHandler,
  FlowFormField,
  HausDevice,
  WifiCredentials,
} from '@haus/core';
import { parseDnsSdTxt } from '@haus/core';
import type { AppCatalog, AppCatalogEntry } from '@haus/apps';
import {
  vendorCatalog,
  type CompatibilityRuntimeKind,
  type PluginSecretVault,
  type VendorPreset,
} from '@haus/kitsune';

export interface KitsuneCompatSession {
  readonly runtime: CompatibilityRuntimeKind;
  readonly pluginId: string;
  readonly status: string;
}

export interface KitsuneCompatDiagnostic {
  readonly plugin: string;
  readonly level: string;
  readonly code: string;
  readonly message: string;
  readonly timestamp?: number;
}

export function parseKitsuneCompatibility(raw: unknown): {
  readonly sessions: readonly KitsuneCompatSession[];
  readonly diagnostics: readonly KitsuneCompatDiagnostic[];
} {
  if (!raw || typeof raw !== 'object') return { sessions: [], diagnostics: [] };
  const obj = raw as { sessions?: unknown; diagnostics?: unknown };
  const sessions = Array.isArray(obj.sessions) ? (obj.sessions as KitsuneCompatSession[]) : [];
  const diagnostics = Array.isArray(obj.diagnostics)
    ? (obj.diagnostics as KitsuneCompatDiagnostic[])
    : [];
  return { sessions, diagnostics };
}

export function toCompatibilityRuntime(rt: IntegrationRuntimeType): CompatibilityRuntimeKind {
  if (rt === 'homebridge') return 'homebridge';
  if (rt === 'scrypted') return 'scrypted';
  if (rt === 'custom_integration') return 'hacs';
  return 'supervisor';
}

export type IntegrationRuntimeType =
  'built_in' | 'custom_integration' | 'homebridge' | 'scrypted' | 'docker_app' | 'addon';

export type IntegrationEntryState =
  'loaded' | 'setup_error' | 'setup_retry' | 'not_loaded' | 'failed_unload';

export interface PersistedIntegrationEntry {
  readonly entry_id: string;
  readonly domain: string;
  readonly title: string;
  readonly state: IntegrationEntryState;
  readonly reason: string | null;
  readonly source: string;
  readonly disabled_by: 'user' | null;
  readonly data: Record<string, unknown>;
  readonly options: Record<string, unknown>;
  readonly version?: string;
  readonly runtimeType: IntegrationRuntimeType;
  readonly iotClass?: string;
  readonly supports_options: boolean;
  readonly supports_reconfigure: boolean;
  readonly supports_remove_device: boolean;
  readonly supports_unload: boolean;
  readonly supports_multiple: boolean;
  readonly documentationUrl?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HaEntryLifecycleHooks {
  onEntryPersisted?(
    entry: PersistedIntegrationEntry,
    rawData?: Readonly<Record<string, unknown>>,
    rawOptions?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  onEntryRemoved?(entryId: string): Promise<void>;
  onEntryUpdated?(entry: PersistedIntegrationEntry): Promise<void>;
  getRuntimeEntryPayload?(
    entryId: string,
  ): Promise<
    | { readonly data: Record<string, unknown>; readonly options: Record<string, unknown> }
    | undefined
  >;
}

export interface IntegrationDomainMeta {
  readonly domain: string;
  readonly name: string;
  readonly version?: string;
  readonly runtimeType: IntegrationRuntimeType;
  readonly iotClass?: string;
  readonly supportsOptions: boolean;
  readonly supportsReconfigure: boolean;
  readonly supportsMultiple: boolean;
  readonly documentationUrl?: string;
  readonly deviceCount: number;
  readonly entityCount: number;
  readonly entryCount: number;
  readonly brokenCount: number;
}

const SECRET_KEY_PATTERN = /password|token|secret|api_?key|local_?key|pin|private_?key|passphrase/i;

export function sanitizeEntryPayload(
  raw: Readonly<Record<string, unknown>> | undefined,
  vault?: PluginSecretVault,
  scope?: { runtime: IntegrationRuntimeType; pluginId: string },
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (!raw) return safe;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (SECRET_KEY_PATTERN.test(key)) {
      if (typeof value === 'string' && value.length > 0 && vault && scope) {
        vault.setSecret(toCompatibilityRuntime(scope.runtime), scope.pluginId, key, value);
      }
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function inferDomainFromDevice(device: HausDevice): string {
  const inst = device.source?.instanceId ?? '';
  const proto = device.connectivity?.protocol;
  if (inst.startsWith('homebridge:')) return inst.slice('homebridge:'.length);
  if (inst.startsWith('scrypted:')) return inst.slice('scrypted:'.length);
  if (inst.startsWith('hacs:')) return inst.slice('hacs:'.length);
  if (inst.startsWith('app:')) return inst.slice('app:'.length);
  if (inst === 'kitsune') return device.id.split(':')[1] ?? 'kitsune';
  if (inst === 'mqtt' || proto === 'mqtt') return 'mqtt';
  if (inst === 'matter' || proto === 'matter') return 'matter';
  if (inst === 'homekit' || proto === 'homekit') return 'homekit_controller';
  if (device.id.startsWith('tuya:') || inst.startsWith('tuya:') || inst.startsWith('entry_tuya_')) {
    return 'tuya';
  }
  return inst || proto || 'haus';
}

export function appRuntimeToIntegrationType(entry?: AppCatalogEntry): IntegrationRuntimeType {
  if (!entry) return 'docker_app';
  if (entry.runtimeType === 'homebridge') return 'homebridge';
  if (entry.runtimeType === 'hacs') return 'custom_integration';
  if (entry.runtimeType === 'scrypted') return 'scrypted';
  return 'docker_app';
}

export function mapAppCatalogToSchema(entry: AppCatalogEntry): readonly FlowFormField[] {
  const secretFields: FlowFormField[] = (entry.manifest.secrets ?? []).map((s) => ({
    name: s.name,
    type: 'pin',
    label: s.name,
    required: s.required ?? false,
    description: s.description,
  }));
  const optionFields: FlowFormField[] = (entry.manifest.options ?? []).map((opt) => ({
    name: opt.name,
    type:
      opt.type === 'boolean'
        ? 'boolean'
        : opt.type === 'number'
          ? 'number'
          : opt.type === 'select'
            ? 'select'
            : 'string',
    label: opt.name,
    required: opt.required ?? false,
    defaultValue: opt.default,
    choices: opt.choices?.map((c) => String(c)),
    description: opt.description,
  }));
  return [...secretFields, ...optionFields];
}

export function mapVendorField(field: VendorPreset['fields'][number]): FlowFormField {
  return {
    name: field.key,
    type: field.type === 'password' ? 'pin' : field.type === 'url' ? 'url' : 'string',
    label: field.label,
    required: field.required,
  };
}

export function buildAppOrVendorHandler(
  domain: string,
  title: string,
  schema: readonly FlowFormField[],
  documentationUrl?: string,
): FlowDomainHandler {
  return {
    start: ({ flowId, source }) => ({
      type: 'form',
      flowId,
      handler: domain,
      stepId: source === 'reauth' ? 'reauth' : 'user',
      title: source === 'reconfigure' ? `Reconfigure ${title}` : `Configure ${title}`,
      description: `Enter connection settings for ${title}.`,
      documentationUrl,
      lastStep: true,
      dataSchema: schema,
    }),
  };
}

export interface NetworkCredentialsInput {
  readonly wifi?: WifiCredentials;
  readonly threadDataset?: Uint8Array | string;
  readonly saveForReuse?: boolean;
}

export function parseNetworkCredentialsInput(input: WifiCredentials | NetworkCredentialsInput): {
  wifi?: WifiCredentials;
  threadDataset?: Uint8Array;
  saveForReuse: boolean;
} {
  if ('ssid' in input && typeof input.ssid === 'string') {
    return { wifi: { ssid: input.ssid, password: input.password }, saveForReuse: false };
  }
  const opts = input as NetworkCredentialsInput;
  let threadDataset: Uint8Array | undefined;
  if (typeof opts.threadDataset === 'string') {
    const clean = opts.threadDataset.trim().replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    threadDataset = bytes;
  } else if (opts.threadDataset instanceof Uint8Array) {
    threadDataset = new Uint8Array(opts.threadDataset);
  }
  return {
    wifi: opts.wifi,
    threadDataset,
    saveForReuse: opts.saveForReuse ?? false,
  };
}

export function mergeDiscoveryTxtDetails(
  protocol: string | undefined,
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const sType = details?.serviceType as string | undefined;
  if (!sType || protocol !== 'zeroconf') return details;
  const parsedTxt = parseDnsSdTxt(sType, (details?.txt ?? details) as Record<string, string>);
  return { ...parsedTxt, ...details };
}

export interface DomainMetaResolverInput {
  readonly domain: string;
  readonly catalog: AppCatalog;
  readonly manifest?: FlowCatalogManifest;
}

export function resolveDomainMetaBase({ domain, catalog, manifest }: DomainMetaResolverInput): {
  runtimeType: IntegrationRuntimeType;
  version?: string;
  iotClass?: string;
  supportsMultiple: boolean;
  documentationUrl?: string;
} {
  const appEntry = catalog.get(domain);
  if (appEntry) {
    return {
      runtimeType: appRuntimeToIntegrationType(appEntry),
      version: appEntry.manifest.version,
      iotClass: domain.includes('local') ? 'local_push' : 'cloud_polling',
      supportsMultiple: domain === 'meross_lan' || domain === 'govee',
      documentationUrl: appEntry.documentationUrl,
    };
  }
  const vendor = vendorCatalog.find((v) => v.id === domain);
  if (vendor) {
    return {
      runtimeType: vendor.driver === 'npm' ? 'scrypted' : 'custom_integration',
      version: '1.0.0',
      iotClass: vendor.id === 'ring' ? 'cloud_polling' : 'local_push',
      supportsMultiple: true,
    };
  }
  const isCustom =
    domain === 'xiaomi_miot' || domain === 'hacs' || manifest?.iot_class === 'custom';
  return {
    runtimeType: isCustom ? 'custom_integration' : 'built_in',
    iotClass: manifest?.iot_class,
    supportsMultiple: manifest ? manifest.single_config_entry !== true : true,
    documentationUrl: manifest?.documentation,
  };
}

export function buildIntegrationDomainMetaList(input: {
  readonly entries: readonly PersistedIntegrationEntry[];
  readonly devices: readonly HausDevice[];
  readonly catalog: AppCatalog;
  readonly catalogManifests?: readonly FlowCatalogManifest[];
}): readonly IntegrationDomainMeta[] {
  const entryDomainById = new Map(input.entries.map((entry) => [entry.entry_id, entry.domain]));
  const byDomain = new Map<
    string,
    { entries: PersistedIntegrationEntry[]; devices: HausDevice[] }
  >();

  for (const entry of input.entries) {
    const bucket = byDomain.get(entry.domain) ?? { entries: [], devices: [] };
    bucket.entries.push(entry);
    byDomain.set(entry.domain, bucket);
  }
  for (const device of input.devices) {
    const inst = device.source?.instanceId ?? '';
    const domain = entryDomainById.get(inst) ?? inferDomainFromDevice(device);
    const bucket = byDomain.get(domain) ?? { entries: [], devices: [] };
    bucket.devices.push(device);
    byDomain.set(domain, bucket);
  }

  const manifestMap = new Map<string, FlowCatalogManifest>();
  for (const m of input.catalogManifests ?? []) manifestMap.set(m.domain, m);

  const allDomains = new Set<string>([
    ...byDomain.keys(),
    ...input.catalog.list().map((a) => a.manifest.id),
    ...vendorCatalog.map((v) => v.id),
  ]);

  const out: IntegrationDomainMeta[] = [];
  for (const domain of allDomains) {
    const bucket = byDomain.get(domain) ?? { entries: [], devices: [] };
    const manifest = manifestMap.get(domain);
    const base = resolveDomainMetaBase({ domain, catalog: input.catalog, manifest });
    const appEntry = input.catalog.get(domain);
    const vendor = vendorCatalog.find((v) => v.id === domain);
    const entityCount = bucket.devices.reduce((sum, dev) => sum + (dev.endpoints?.length ?? 1), 0);
    const brokenCount = bucket.entries.filter(
      (e) => e.state === 'setup_error' || e.state === 'setup_retry',
    ).length;

    out.push({
      domain,
      name:
        appEntry?.manifest.name ??
        vendor?.name ??
        manifest?.name ??
        bucket.entries[0]?.title ??
        domain,
      version: bucket.entries[0]?.version ?? base.version,
      runtimeType: bucket.entries[0]?.runtimeType ?? base.runtimeType,
      iotClass: base.iotClass,
      supportsOptions: true,
      supportsReconfigure: true,
      supportsMultiple: base.supportsMultiple,
      documentationUrl: base.documentationUrl,
      deviceCount: bucket.devices.length,
      entityCount,
      entryCount: bucket.entries.length,
      brokenCount,
    });
  }
  return out;
}
