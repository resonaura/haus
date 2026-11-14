/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveredCandidate } from '@haus/core';
import type { DiscoveredHomeKitItem, PersistedHomeKitPairingItem } from '../flow-entries.js';
import type { ActiveFlowEntry } from './flow-dispatch.js';

function candidateMacHexes(candidate: DiscoveredCandidate): string[] {
  const result: string[] = [];
  for (const identity of candidate.durableIdentities ?? []) {
    if (identity.kind !== 'mac' && identity.kind !== 'hap') continue;
    const hex = identity.value
      .replace(/^(?:mac|hap):/i, '')
      .replace(/[^0-9a-fA-F]/g, '')
      .toUpperCase();
    if (hex.length === 12) result.push(hex);
  }
  return result;
}

function formatColonMac(hex12: string): string {
  return hex12.match(/.{2}/g)?.join(':').toUpperCase() ?? hex12.toUpperCase();
}

function formatDiscoveredLabel(name: string, detail?: string): string {
  const trimmed = name.trim();
  if (!detail || trimmed.includes(detail)) return trimmed || detail || 'Discovered device';
  return `${trimmed} (${detail})`;
}

function isHomeKitDomain(domain: string): boolean {
  return domain === 'homekit' || domain === 'homekit_controller';
}

export function buildDiscoveryFlowProgress(params: {
  discoveredHomeKit: readonly DiscoveredHomeKitItem[];
  pairings: readonly PersistedHomeKitPairingItem[];
  commissioningCandidates: Iterable<DiscoveredCandidate>;
  activeFlows: Map<string, ActiveFlowEntry>;
  ignoredHomeKitIds: ReadonlySet<string>;
}): Array<Record<string, unknown>> {
  const pairedIds = new Set(params.pairings.map((p) => p.accessoryId.toUpperCase()));
  const pairedCompact = new Set(
    params.pairings.map((p) => p.accessoryId.replace(/[:-]/g, '').toUpperCase()),
  );
  const ignoredCompact = new Set(
    Array.from(params.ignoredHomeKitIds, (id) => id.replace(/[:-]/g, '').toUpperCase()),
  );

  const candidates = Array.from(params.commissioningCandidates).filter(
    (c) =>
      (c.status === 'discovered' || c.status === 'in_progress') &&
      Boolean(c.domain && c.domain !== 'generic'),
  );

  const vendorClaimedIds = new Set<string>();
  const vendorClaimedIps = new Set<string>();
  const homekitCandidates: DiscoveredCandidate[] = [];
  const items: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    if (isHomeKitDomain(c.domain)) {
      homekitCandidates.push(c);
      continue;
    }
    for (const hex of candidateMacHexes(c)) vendorClaimedIds.add(hex);
    for (const addr of c.addresses) {
      if (addr) vendorClaimedIps.add(addr);
    }
    const flowId = `comm_disc_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const existing = params.activeFlows.get(flowId);
    params.activeFlows.set(flowId, {
      ...existing,
      handler: c.domain,
      candidateId: c.id,
      address: c.addresses[0],
      port: c.port,
      name: c.name,
    });
    items.push({
      flow_id: flowId,
      handler: c.domain,
      context: {
        source: c.protocol,
        title_placeholders: { name: formatDiscoveredLabel(c.name, c.addresses[0] ?? c.protocol) },
      },
    });
  }

  const emittedHomeKitIds = new Set<string>();
  for (const d of params.discoveredHomeKit) {
    const upperId = d.id.toUpperCase();
    const compact = d.id.replace(/[:-]/g, '').toUpperCase();
    if (d.paired || pairedIds.has(upperId) || params.ignoredHomeKitIds.has(upperId)) continue;
    if (ignoredCompact.has(compact) || vendorClaimedIds.has(compact)) continue;
    if (d.address && vendorClaimedIps.has(d.address)) continue;

    emittedHomeKitIds.add(compact);
    const flowId = `hk_disc_${d.id.replace(/:/g, '')}`;
    const existing = params.activeFlows.get(flowId);
    params.activeFlows.set(flowId, {
      ...existing,
      handler: 'homekit_controller',
      accessoryId: d.id,
      address: d.address,
      port: d.port,
      name: d.name,
    });
    items.push({
      flow_id: flowId,
      handler: 'homekit_controller',
      context: {
        source: 'zeroconf',
        title_placeholders: { name: formatDiscoveredLabel(d.name, d.address) },
      },
    });
  }

  for (const c of homekitCandidates) {
    const hexes = candidateMacHexes(c);
    if (
      hexes.some((h) => pairedCompact.has(h) || emittedHomeKitIds.has(h) || ignoredCompact.has(h))
    ) {
      continue;
    }
    const flowId = `comm_disc_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const existing = params.activeFlows.get(flowId);
    const accessoryId = hexes[0] ? formatColonMac(hexes[0]) : existing?.accessoryId;
    params.activeFlows.set(flowId, {
      ...existing,
      handler: 'homekit_controller',
      candidateId: c.id,
      ...(accessoryId ? { accessoryId } : {}),
      address: c.addresses[0],
      port: c.port,
      name: c.name,
    });
    items.push({
      flow_id: flowId,
      handler: 'homekit_controller',
      context: {
        source: c.protocol,
        title_placeholders: { name: formatDiscoveredLabel(c.name, c.addresses[0] ?? c.protocol) },
      },
    });
  }

  return items;
}

export async function ignoreDiscoveryCandidateFlow(params: {
  flowId: string;
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  activeFlows: Map<string, ActiveFlowEntry>;
  lastCommissioningDiscovered: Map<string, DiscoveredCandidate>;
  lastDiscoveredHomeKit: Map<string, DiscoveredHomeKitItem>;
  ignoredHomeKitIds: Set<string>;
}): Promise<Record<string, never>> {
  const flow = params.activeFlows.get(params.flowId);
  if (flow?.nativeFlowId) {
    await params
      .api(`/api/commissioning/flows/${encodeURIComponent(flow.nativeFlowId)}`, {
        method: 'DELETE',
      })
      .catch(() => {});
  }

  const candidateIdsToIgnore = new Set<string>();
  if (flow?.candidateId) {
    candidateIdsToIgnore.add(flow.candidateId);
  } else if (params.flowId.startsWith('comm_disc_')) {
    for (const c of params.lastCommissioningDiscovered.values()) {
      if (`comm_disc_${c.id.replace(/[^a-zA-Z0-9]/g, '_')}` === params.flowId) {
        candidateIdsToIgnore.add(c.id);
      }
    }
  }

  const accessoryId =
    flow?.accessoryId ??
    (params.flowId.startsWith('hk_disc_')
      ? Array.from(params.lastDiscoveredHomeKit.values()).find(
          (d) => `hk_disc_${d.id.replace(/:/g, '')}` === params.flowId,
        )?.id
      : undefined);

  if (accessoryId) {
    params.ignoredHomeKitIds.add(accessoryId.toUpperCase());
    const compact = accessoryId.replace(/[:-]/g, '').toUpperCase();
    for (const c of params.lastCommissioningDiscovered.values()) {
      if (candidateMacHexes(c).includes(compact)) {
        candidateIdsToIgnore.add(c.id);
      }
    }
  }

  for (const candidateId of candidateIdsToIgnore) {
    const cand = params.lastCommissioningDiscovered.get(candidateId);
    if (cand) {
      for (const hex of candidateMacHexes(cand)) {
        params.ignoredHomeKitIds.add(formatColonMac(hex));
      }
    }
    await params
      .api(`/api/commissioning/discoveries/${encodeURIComponent(candidateId)}/ignore`, {
        method: 'POST',
        body: {},
      })
      .catch(() => {});
    params.lastCommissioningDiscovered.delete(candidateId);
  }

  params.activeFlows.delete(params.flowId);
  return {};
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function liveFlowMatchesSynthetic(
  liveItem: Record<string, unknown>,
  syntheticEntry: ActiveFlowEntry | undefined,
): boolean {
  if (!syntheticEntry) return false;
  const ctx =
    liveItem.context && typeof liveItem.context === 'object'
      ? (liveItem.context as Record<string, unknown>)
      : {};
  const discoveryKey = asNonEmptyString(ctx.discovery_key);
  if (discoveryKey && syntheticEntry.candidateId && discoveryKey === syntheticEntry.candidateId) {
    return true;
  }

  const compactAcc = syntheticEntry.accessoryId?.replace(/[:-]/g, '').toLowerCase();
  const uniqueId = asNonEmptyString(ctx.unique_id)?.replace(/[:-]/g, '').toLowerCase();
  if (compactAcc && uniqueId && (uniqueId === compactAcc || uniqueId.includes(compactAcc))) {
    return true;
  }

  const hay = JSON.stringify(liveItem).toLowerCase();
  if (syntheticEntry.address && hay.includes(syntheticEntry.address.toLowerCase())) {
    return true;
  }
  const synName = syntheticEntry.name?.trim().toLowerCase();
  if (synName && synName.length >= 3 && hay.includes(synName)) {
    return true;
  }
  return false;
}

/** Merges live HA progress flows from Hub ahead of synthetic discovery candidates without duplicates. */
export function mergeLiveAndDiscoveredProgress(params: {
  rawLiveFlows: unknown;
  discoveredHomeKit: readonly DiscoveredHomeKitItem[];
  pairings: readonly PersistedHomeKitPairingItem[];
  commissioningCandidates: Iterable<DiscoveredCandidate>;
  activeFlows: Map<string, ActiveFlowEntry>;
  ignoredHomeKitIds: ReadonlySet<string>;
}): Array<Record<string, unknown>> {
  const syntheticItems = buildDiscoveryFlowProgress({
    discoveredHomeKit: params.discoveredHomeKit,
    pairings: params.pairings,
    commissioningCandidates: params.commissioningCandidates,
    activeFlows: params.activeFlows,
    ignoredHomeKitIds: params.ignoredHomeKitIds,
  });

  if (!Array.isArray(params.rawLiveFlows) || params.rawLiveFlows.length === 0) {
    return syntheticItems;
  }

  const liveItems: Array<Record<string, unknown>> = [];
  const suppressedSyntheticIds = new Set<string>();

  for (const raw of params.rawLiveFlows) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const flowId = asNonEmptyString(rec.flowId) ?? asNonEmptyString(rec.flow_id);
    const handler = asNonEmptyString(rec.handler);
    if (!flowId || !handler) continue;

    const stepId = asNonEmptyString(rec.stepId) ?? asNonEmptyString(rec.step_id);
    const title = asNonEmptyString(rec.title);
    const context =
      rec.context && typeof rec.context === 'object'
        ? (rec.context as Record<string, unknown>)
        : { source: 'discovery' };

    const normalizedLive: Record<string, unknown> = {
      flow_id: flowId,
      handler,
      ...(stepId ? { step_id: stepId } : {}),
      ...(title ? { title } : {}),
      context,
    };

    // Match against synthetic items of the same handler so ignore/metadata stay linked
    const sameHandlerSyn = syntheticItems.filter(
      (syn) => syn.handler === handler && !suppressedSyntheticIds.has(String(syn.flow_id)),
    );
    const matchedSyn =
      sameHandlerSyn.find((syn) =>
        liveFlowMatchesSynthetic(normalizedLive, params.activeFlows.get(String(syn.flow_id))),
      ) ?? (sameHandlerSyn.length === 1 ? sameHandlerSyn[0] : undefined);

    const matchedMeta = matchedSyn ? params.activeFlows.get(String(matchedSyn.flow_id)) : undefined;
    if (matchedSyn) {
      suppressedSyntheticIds.add(String(matchedSyn.flow_id));
      params.activeFlows.delete(String(matchedSyn.flow_id));
    }

    const prev = params.activeFlows.get(flowId);
    params.activeFlows.set(flowId, {
      ...matchedMeta,
      ...prev,
      handler,
      nativeFlowId: flowId,
      ...(stepId ? { currentStepId: stepId } : {}),
    });
    liveItems.push(normalizedLive);
  }

  return [
    ...liveItems,
    ...syntheticItems.filter((syn) => !suppressedSyntheticIds.has(String(syn.flow_id))),
  ];
}
