/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  extractTranslationResources,
  formatDiscoverySource,
  parseCatalogInstallPayload,
  parseEcosystemCatalogPayload,
  type EcosystemCatalogSourceItem,
  type FlowStartTarget,
  type FlowStepRecord,
  type IntegrationCatalogChoice,
  type ManagementPort,
  type OnboardingDiscoveredFlow,
  type ParsedOAuthCallbackInput,
} from '@haus/core/transport';
import type { CommissioningTransaction } from '@haus/core';
import type { EcosystemPluginInstallInfo } from '@haus/ui/components';
import type { GpuiRpcRequest } from './integrations.js';

function humanizeDomain(domain: string): string {
  return domain.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function flowBasePath(target: FlowStartTarget): string {
  if (target.repair) return 'repairs/issues/fix';
  if (target.kind === 'options') return 'config/config_entries/options/flow';
  return 'config/config_entries/flow';
}

export function parseFlowStep(raw: unknown): FlowStepRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error('The Hub returned an empty integration flow response.');
  }
  const obj = raw as Readonly<Record<string, unknown>>;
  if (
    typeof obj.type !== 'string' ||
    typeof obj.flow_id !== 'string' ||
    typeof obj.handler !== 'string'
  ) {
    throw new Error('The Hub returned an unexpected integration flow step.');
  }
  return raw as FlowStepRecord;
}

export function parseCommissioningTx(raw: unknown): CommissioningTransaction {
  if (!raw || typeof raw !== 'object') {
    throw new Error('The Hub returned an invalid commissioning session response.');
  }
  const obj = raw as Readonly<Record<string, unknown>>;
  if (typeof obj.commissioningId !== 'string' || typeof obj.state !== 'string') {
    throw new Error('The Hub returned an unexpected commissioning state.');
  }
  return raw as CommissioningTransaction;
}

export async function fetchLiveOnboardingState(options: {
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
}): Promise<{
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly names: Readonly<Record<string, string>>;
  readonly ecosystemApps: readonly EcosystemCatalogSourceItem[];
}> {
  const [rawProgress, rawHandlers, rawManifests, rawTitles, rawEcoCatalog] = await Promise.all([
    options.requestRpc
      ? options.requestRpc<unknown>({ type: 'config_entries/flow/progress' }).catch(() => [])
      : Promise.resolve([]),
    options.management
      ? options.management
          .management<unknown>({ method: 'GET', path: 'config/config_entries/flow_handlers' })
          .catch(() => [])
      : Promise.resolve([]),
    options.requestRpc
      ? options.requestRpc<unknown>({ type: 'manifest/list' }).catch(() => [])
      : Promise.resolve([]),
    options.requestRpc
      ? options
          .requestRpc<unknown>({
            type: 'frontend/get_translations',
            language: 'en',
            category: 'title',
            config_flow: true,
          })
          .catch(() => ({ resources: {} }))
      : Promise.resolve({ resources: {} }),
    options.management
      ? options.management
          .management<unknown>({ method: 'GET', path: 'apps/catalog' })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const titleByDomain = new Map<string, string>();
  const names: Record<string, string> = {};
  if (Array.isArray(rawManifests)) {
    for (const entry of rawManifests) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Readonly<Record<string, unknown>>;
      if (typeof rec.domain === 'string' && typeof rec.name === 'string' && rec.name.trim()) {
        const clean = rec.name.trim();
        titleByDomain.set(rec.domain, clean);
        names[`component.${rec.domain}.title`] = clean;
        names[rec.domain] = clean;
      }
    }
  }
  for (const [key, val] of Object.entries(extractTranslationResources(rawTitles))) {
    names[key] = val;
    const match = /^component\.([^.]+)\.title$/.exec(key);
    if (match?.[1] && val.trim()) {
      titleByDomain.set(match[1], val.trim());
    }
  }

  const discovered: OnboardingDiscoveredFlow[] = [];
  if (Array.isArray(rawProgress)) {
    for (const entry of rawProgress) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Readonly<Record<string, unknown>>;
      if (typeof rec.flow_id !== 'string' || typeof rec.handler !== 'string') continue;
      const ctx =
        rec.context && typeof rec.context === 'object'
          ? (rec.context as Readonly<Record<string, unknown>>)
          : undefined;
      const source = typeof ctx?.source === 'string' ? ctx.source : undefined;
      if (source === 'reauth' || source === 'reconfigure' || source === 'user') continue;
      const placeholders =
        ctx?.title_placeholders && typeof ctx.title_placeholders === 'object'
          ? (ctx.title_placeholders as Readonly<Record<string, unknown>>)
          : undefined;
      const domain = rec.handler;
      const title = titleByDomain.get(domain) ?? humanizeDomain(domain);
      const placeholderName =
        typeof placeholders?.name === 'string' && placeholders.name.trim()
          ? placeholders.name.trim()
          : undefined;
      discovered.push({
        flowId: rec.flow_id,
        domain,
        title,
        label: placeholderName ?? title,
        ...(source ? { source } : {}),
        sourceLabel: formatDiscoverySource(source),
      });
    }
  }

  const catalog: IntegrationCatalogChoice[] = [];
  const seenDomains = new Set<string>();
  if (Array.isArray(rawHandlers)) {
    for (const handler of rawHandlers) {
      if (typeof handler !== 'string' || !handler.trim() || seenDomains.has(handler)) continue;
      seenDomains.add(handler);
      catalog.push({
        domain: handler,
        title: titleByDomain.get(handler) ?? humanizeDomain(handler),
      });
    }
  }

  const ecosystemApps = parseEcosystemCatalogPayload(rawEcoCatalog);
  return { discovered, catalog, names, ecosystemApps };
}

export async function searchLiveEcosystemCatalog(
  management: ManagementPort | undefined,
  query: string,
): Promise<readonly EcosystemCatalogSourceItem[]> {
  const trimmed = query.trim();
  if (!management || trimmed.length < 2) return [];
  const raw = await management
    .management<unknown>({
      method: 'GET',
      path: `apps/catalog?search=${encodeURIComponent(trimmed)}`,
    })
    .catch(() => []);
  return parseEcosystemCatalogPayload(raw);
}

export async function fetchLiveStepTranslations(
  requestRpc: GpuiRpcRequest | undefined,
  domains: readonly string[],
  category: 'config' | 'options' | 'issues',
): Promise<Record<string, string>> {
  const list = [...new Set(domains.filter(Boolean))];
  if (!requestRpc || list.length === 0) return {};
  const integration = list.length === 1 ? list[0] : list;
  const [mainRes, selectorRes, titleRes] = await Promise.all([
    requestRpc<unknown>({
      type: 'frontend/get_translations',
      language: 'en',
      category,
      integration,
    }).catch(() => ({})),
    requestRpc<unknown>({
      type: 'frontend/get_translations',
      language: 'en',
      category: 'selector',
      integration,
    }).catch(() => ({})),
    requestRpc<unknown>({
      type: 'frontend/get_translations',
      language: 'en',
      category: 'title',
      integration,
    }).catch(() => ({})),
  ]);
  return {
    ...extractTranslationResources(titleRes),
    ...extractTranslationResources(selectorRes),
    ...extractTranslationResources(mainRes),
  };
}

export async function submitLiveOAuthCallback(
  management: ManagementPort,
  flowId: string,
  parsed: ParsedOAuthCallbackInput,
): Promise<FlowStepRecord> {
  return parseFlowStep(
    await management.management({
      method: 'POST',
      path: 'commissioning/oauth/callback',
      data: {
        flowId,
        ...(parsed.state ? { state: parsed.state } : {}),
        ...(parsed.code ? { code: parsed.code } : {}),
        ...(parsed.error ? { error: parsed.error } : {}),
      },
    }),
  );
}

export async function saveLiveApplicationCredentials(
  management: ManagementPort,
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await management.management({
    method: 'POST',
    path: 'commissioning/application-credentials',
    data: { domain, clientId, clientSecret },
  });
}

export async function loadLiveCatalogPluginDetail(
  management: ManagementPort,
  base: EcosystemPluginInstallInfo,
): Promise<EcosystemPluginInstallInfo> {
  const raw = await management.management<unknown>({
    method: 'GET',
    path: `apps/catalog/${encodeURIComponent(base.appId)}`,
  });
  if (!raw || typeof raw !== 'object') return base;
  const rec = raw as Readonly<Record<string, unknown>>;
  const manifest =
    rec.manifest && typeof rec.manifest === 'object'
      ? (rec.manifest as Readonly<Record<string, unknown>>)
      : undefined;
  return {
    ...base,
    packageName:
      typeof rec.packageName === 'string'
        ? rec.packageName
        : typeof rec.domain === 'string'
          ? rec.domain
          : base.packageName,
    version:
      typeof manifest?.version === 'string'
        ? manifest.version
        : typeof rec.latestVersion === 'string'
          ? rec.latestVersion
          : base.version,
    category: typeof rec.category === 'string' ? rec.category : base.category,
    description:
      typeof manifest?.description === 'string'
        ? manifest.description
        : typeof rec.description === 'string'
          ? rec.description
          : base.description,
    verified: rec.verified === true ? true : base.verified,
    documentationUrl:
      typeof rec.documentationUrl === 'string' ? rec.documentationUrl : base.documentationUrl,
    repositoryUrl: typeof rec.repositoryUrl === 'string' ? rec.repositoryUrl : base.repositoryUrl,
    hacsRepositoryId:
      typeof rec.hacsRepositoryId === 'string' ? rec.hacsRepositoryId : base.hacsRepositoryId,
    hacsDomain: typeof rec.domain === 'string' ? rec.domain : base.hacsDomain,
  };
}

export async function installLiveCatalogPlugin(options: {
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly plugin: EcosystemPluginInstallInfo;
  readonly onStage?: (stage: string) => void;
}): Promise<void> {
  const { management, requestRpc, plugin, onStage } = options;
  if (plugin.runtime === 'hacs') {
    const repo = plugin.hacsRepositoryId ?? plugin.hacsDomain ?? plugin.packageName;
    if (!requestRpc || !repo) {
      throw new Error('HACS repository download requires an active Hub connection.');
    }
    onStage?.('pulling');
    await requestRpc({ type: 'hacs/repository/download', repository: String(repo) });
    onStage?.('complete');
    return;
  }
  if (!management) {
    throw new Error('Connect your Haus Hub to install ecosystem drivers.');
  }
  onStage?.('validating');
  const detail = await management.management({
    method: 'GET',
    path: `apps/catalog/${encodeURIComponent(plugin.appId)}`,
  });
  const install = parseCatalogInstallPayload(detail);
  if (!install) {
    throw new Error('Could not resolve driver manifest from the Hub catalog.');
  }
  onStage?.('pulling');
  await management.management({
    method: 'POST',
    path: 'apps/install',
    data: {
      manifest: install.manifest,
      grantedPermissions: [...install.grantedPermissions],
    },
  });
  onStage?.('complete');
}

export async function startLiveManualCameraFlow(
  management: ManagementPort,
  input: { readonly streamUrl: string; readonly snapshotUrl: string },
): Promise<FlowStepRecord> {
  const first = parseFlowStep(
    await management.management({
      method: 'POST',
      path: 'config/config_entries/flow',
      data: { handler: 'generic' },
    }),
  );
  if (first.type !== 'form') {
    throw new Error(first.reason ?? 'The Hub could not start generic camera setup.');
  }
  const payload: Record<string, unknown> = {};
  const fieldNames = new Set((first.data_schema ?? []).map((f) => f.name));
  if (input.streamUrl) {
    if (fieldNames.has('stream_source')) payload.stream_source = input.streamUrl;
    else payload.stream_source = input.streamUrl;
  }
  if (input.snapshotUrl) {
    if (fieldNames.has('still_image_url')) payload.still_image_url = input.snapshotUrl;
    else payload.still_image_url = input.snapshotUrl;
  }
  return parseFlowStep(
    await management.management({
      method: 'POST',
      path: `config/config_entries/flow/${first.flow_id}`,
      data: payload,
    }),
  );
}

export async function updateLiveCameraEntity(
  requestRpc: GpuiRpcRequest,
  input: { readonly entityId: string; readonly name: string; readonly roomId: string },
): Promise<void> {
  await requestRpc({
    type: 'config/entity_registry/update',
    entity_id: input.entityId,
    name: input.name,
    area_id: input.roomId || null,
  });
}

export async function startLiveCommissioningSession(
  management: ManagementPort,
  code: string,
  contextProtocol?: string,
): Promise<CommissioningTransaction> {
  return parseCommissioningTx(
    await management.management({
      method: 'POST',
      path: 'commissioning/sessions',
      data: { code, contextProtocol },
    }),
  );
}

export async function readLiveCommissioningSession(
  management: ManagementPort,
  sessionId: string,
  sinceSeq: number,
): Promise<CommissioningTransaction> {
  return parseCommissioningTx(
    await management.management({
      method: 'GET',
      path: `commissioning/sessions/${encodeURIComponent(sessionId)}`,
      data: { sinceSeq },
    }),
  );
}

export async function selectLiveCommissioningCandidate(
  management: ManagementPort,
  sessionId: string,
  candidateId: string,
): Promise<CommissioningTransaction> {
  return parseCommissioningTx(
    await management.management({
      method: 'POST',
      path: `commissioning/sessions/${encodeURIComponent(sessionId)}/select`,
      data: { candidateId },
    }),
  );
}

export async function submitLiveCommissioningCredentials(
  management: ManagementPort,
  sessionId: string,
  payload: {
    readonly ssid: string;
    readonly password: string;
    readonly threadDataset?: string;
    readonly saveForReuse: boolean;
  },
): Promise<CommissioningTransaction> {
  return parseCommissioningTx(
    await management.management({
      method: 'POST',
      path: `commissioning/sessions/${encodeURIComponent(sessionId)}/credentials`,
      data: payload,
    }),
  );
}

export function cancelLiveCommissioningSession(
  management: ManagementPort,
  sessionId: string,
): Promise<unknown> {
  return management
    .management({
      method: 'POST',
      path: `commissioning/sessions/${encodeURIComponent(sessionId)}/cancel`,
      data: {},
    })
    .catch(() => {});
}

export function moveCommissionedDeviceRoom(
  management: ManagementPort,
  deviceId: string,
  targetRoomId: string,
): Promise<unknown> {
  return management
    .management({
      method: 'POST',
      path: `devices/${encodeURIComponent(deviceId)}/move-room`,
      data: { targetRoomId },
    })
    .catch(() => {});
}
