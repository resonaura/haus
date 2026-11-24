/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  formatDiscoverySource,
  type FlowStartTarget,
  type FlowStepRecord,
  type IntegrationCatalogChoice,
  type ManagementPort,
  type OnboardingDiscoveredFlow,
} from '@haus/core/transport';
import type { CommissioningTransaction } from '@haus/core';
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
  if (typeof obj.type !== 'string' || typeof obj.flow_id !== 'string' || typeof obj.handler !== 'string') {
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
}> {
  const [rawProgress, rawHandlers, rawManifests] = await Promise.all([
    options.requestRpc
      ? options
          .requestRpc<unknown>({ type: 'config_entries/flow/progress' })
          .catch(() => [])
      : Promise.resolve([]),
    options.management
      ? options.management
          .management<unknown>({ method: 'GET', path: 'config/config_entries/flow_handlers' })
          .catch(() => [])
      : Promise.resolve([]),
    options.requestRpc
      ? options.requestRpc<unknown>({ type: 'manifest/list' }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const titleByDomain = new Map<string, string>();
  if (Array.isArray(rawManifests)) {
    for (const entry of rawManifests) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Readonly<Record<string, unknown>>;
      if (typeof rec.domain === 'string' && typeof rec.name === 'string' && rec.name.trim()) {
        titleByDomain.set(rec.domain, rec.name.trim());
      }
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
      const source = typeof ctx?.source === 'string' ? ctx.source : undefined;
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

  return { discovered, catalog };
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

