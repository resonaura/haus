/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { sanitizeServiceName } from './discovery.js';

export type DiscoveredHomeTargetType =
  'home-network' | 'home' | 'standalone-hub' | 'home-assistant';

export interface DiscoveredHubEndpointInput {
  readonly id: string;
  readonly hubId?: string;
  readonly homeId?: string;
  readonly homeName?: string;
  readonly name: string;
  readonly url: string;
  readonly host?: string;
  readonly port?: number;
  readonly kind?: 'haus-hub' | 'home-assistant';
  readonly onboarded?: boolean;
  readonly clusterRole?: 'standalone' | 'coordinator' | 'node' | 'fenced';
  readonly coordinatorHubId?: string;
  readonly hubCount?: number;
}

export interface DiscoveredHomeTarget {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly host?: string;
  readonly port?: number;
  readonly kind?: 'haus-hub' | 'home-assistant';
  readonly targetType?: DiscoveredHomeTargetType;
  readonly homeId?: string;
  readonly hubId?: string;
  readonly coordinatorHubId?: string;
  readonly hubCount?: number;
  readonly onboarded?: boolean;
  readonly memberUrls?: readonly string[];
  readonly memberNames?: readonly string[];
}

/** Strips mDNS Bonjour collision suffixes such as `"Haus (2)"` -> `"Haus"`. */
export function stripBonjourInstanceSuffix(name: string): string {
  const cleaned = sanitizeServiceName(name)
    .replace(/\s+\(\d+\)$/u, '')
    .trim();
  return cleaned || sanitizeServiceName(name) || 'Haus Hub';
}

function normalizeUrlOrigin(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function isCoordinatorCandidate(
  item: DiscoveredHubEndpointInput,
  groupCoordinatorId?: string,
): boolean {
  if (item.clusterRole === 'coordinator') return true;
  if (groupCoordinatorId && item.hubId && item.hubId === groupCoordinatorId) return true;
  return false;
}

/**
 * Collapses discovered LAN Hubs into user-facing connection targets:
 * - Configured multi-Hub clusters (`onboarded && totalHubs >= 2`) collapse into one `home-network`
 *   target routed coordinator-first with all member URLs attached for mesh failover.
 * - Configured single-Hub homes (`onboarded && totalHubs === 1`) appear as a `home` target so
 *   ordinary household members always choose their Home rather than raw Hub infrastructure.
 * - Unconfigured Hubs (`onboarded === false`) remain individual `standalone-hub` targets ready
 *   for first-time Home setup or joining an existing Home cluster.
 */
export function groupDiscoveredHomeTargets(
  inputs: readonly DiscoveredHubEndpointInput[],
): DiscoveredHomeTarget[] {
  const haTargets: DiscoveredHomeTarget[] = [];
  const standaloneTargets: DiscoveredHomeTarget[] = [];
  const unknownHubTargets: DiscoveredHomeTarget[] = [];
  const byHomeId = new Map<string, DiscoveredHubEndpointInput[]>();

  for (const raw of inputs) {
    const cleanUrl = normalizeUrlOrigin(raw.url);
    if (!cleanUrl) continue;
    if (raw.kind === 'home-assistant') {
      haTargets.push({
        id: raw.id,
        name: raw.name,
        url: cleanUrl,
        ...(raw.host ? { host: raw.host } : {}),
        ...(raw.port !== undefined ? { port: raw.port } : {}),
        kind: 'home-assistant',
        targetType: 'home-assistant',
      });
      continue;
    }

    const cleanName = stripBonjourInstanceSuffix(raw.name);
    const isClustered =
      (raw.hubCount !== undefined && raw.hubCount > 1) ||
      raw.clusterRole === 'node' ||
      (Boolean(raw.coordinatorHubId) && Boolean(raw.hubId) && raw.coordinatorHubId !== raw.hubId);

    // Explicitly un-onboarded standalone Hub (not part of a multi-hub cluster) stays a standalone Hub.
    if (raw.onboarded === false && !isClustered) {
      standaloneTargets.push({
        id: raw.id,
        name: cleanName,
        url: cleanUrl,
        ...(raw.host ? { host: raw.host } : {}),
        ...(raw.port !== undefined ? { port: raw.port } : {}),
        kind: 'haus-hub',
        targetType: 'standalone-hub',
        ...(raw.homeId ? { homeId: raw.homeId } : {}),
        ...(raw.hubId ? { hubId: raw.hubId } : {}),
        hubCount: 1,
        onboarded: false,
        memberUrls: [cleanUrl],
        memberNames: [cleanName],
      });
      continue;
    }

    // If neither onboarded status nor homeId is known (e.g. unprobed mDNS fallback), keep individual entry
    // unless multiple discovered Hubs share a non-default homeId.
    if (
      raw.onboarded === undefined &&
      !isClustered &&
      (!raw.homeId || raw.homeId === 'home-fresh')
    ) {
      unknownHubTargets.push({
        id: raw.id,
        name: cleanName,
        url: cleanUrl,
        ...(raw.host ? { host: raw.host } : {}),
        ...(raw.port !== undefined ? { port: raw.port } : {}),
        kind: 'haus-hub',
        ...(raw.homeId ? { homeId: raw.homeId } : {}),
        ...(raw.hubId ? { hubId: raw.hubId } : {}),
        memberUrls: [cleanUrl],
        memberNames: [cleanName],
      });
      continue;
    }

    const groupKey = raw.homeId?.trim() || `hub:${raw.hubId ?? cleanUrl}`;
    const list = byHomeId.get(groupKey);
    if (list) {
      if (!list.some((existing) => normalizeUrlOrigin(existing.url) === cleanUrl)) {
        list.push({ ...raw, url: cleanUrl });
      }
    } else {
      byHomeId.set(groupKey, [{ ...raw, url: cleanUrl }]);
    }
  }

  const homeTargets: DiscoveredHomeTarget[] = [];
  for (const [homeKey, members] of byHomeId.entries()) {
    const groupCoordinatorId = members.find((m) => m.coordinatorHubId)?.coordinatorHubId;
    const sorted = [...members].sort((a, b) => {
      const aCoord = isCoordinatorCandidate(a, groupCoordinatorId) ? 1 : 0;
      const bCoord = isCoordinatorCandidate(b, groupCoordinatorId) ? 1 : 0;
      if (aCoord !== bCoord) return bCoord - aCoord;
      return stripBonjourInstanceSuffix(a.name).localeCompare(stripBonjourInstanceSuffix(b.name));
    });

    const primary = sorted[0]!;
    const reportedMaxCount = Math.max(
      sorted.length,
      ...sorted.map((m) => (typeof m.hubCount === 'number' && m.hubCount > 0 ? m.hubCount : 1)),
    );
    const anyOnboarded = sorted.some((m) => m.onboarded === true);

    // If unprobed single hub with default homeId and not confirmed onboarded, keep as regular hub entry
    if (!anyOnboarded && reportedMaxCount === 1 && sorted.every((m) => m.onboarded === undefined)) {
      const cleanName = stripBonjourInstanceSuffix(primary.name);
      unknownHubTargets.push({
        id: primary.id,
        name: cleanName,
        url: primary.url,
        ...(primary.host ? { host: primary.host } : {}),
        ...(primary.port !== undefined ? { port: primary.port } : {}),
        kind: 'haus-hub',
        ...(primary.homeId ? { homeId: primary.homeId } : {}),
        ...(primary.hubId ? { hubId: primary.hubId } : {}),
        memberUrls: [primary.url],
        memberNames: [cleanName],
      });
      continue;
    }

    const isNetwork = reportedMaxCount >= 2;
    const explicitHomeName = sorted.find((m) => m.homeName?.trim())?.homeName?.trim();
    const displayName = stripBonjourInstanceSuffix(explicitHomeName || primary.name);
    const memberUrls = sorted.map((m) => normalizeUrlOrigin(m.url));
    const memberNames = [...new Set(sorted.map((m) => stripBonjourInstanceSuffix(m.name)))];
    const homeId = primary.homeId ?? (homeKey.startsWith('hub:') ? undefined : homeKey);

    homeTargets.push({
      id: homeId ? `haus-home:${homeId}` : primary.id,
      name: displayName,
      url: primary.url,
      ...(primary.host ? { host: primary.host } : {}),
      ...(primary.port !== undefined ? { port: primary.port } : {}),
      kind: 'haus-hub',
      targetType: isNetwork ? 'home-network' : 'home',
      ...(homeId ? { homeId } : {}),
      ...(primary.hubId ? { hubId: primary.hubId } : {}),
      ...(groupCoordinatorId ? { coordinatorHubId: groupCoordinatorId } : {}),
      hubCount: reportedMaxCount,
      onboarded: true,
      memberUrls,
      memberNames,
    });
  }

  homeTargets.sort((a, b) => a.name.localeCompare(b.name));
  unknownHubTargets.sort((a, b) => a.name.localeCompare(b.name));
  standaloneTargets.sort((a, b) => a.name.localeCompare(b.name));
  haTargets.sort((a, b) => a.name.localeCompare(b.name));

  return [...homeTargets, ...unknownHubTargets, ...standaloneTargets, ...haTargets];
}

/**
 * Produces deduplicated Hub candidate URLs ordered with `preferredCoordinatorUrl` first,
 * followed by `primaryUrl` and all known `clusterUrls` for automatic mesh failover.
 */
export function orderClusterCandidateUrls(
  primaryUrl: string,
  clusterUrls?: readonly string[],
  preferredCoordinatorUrl?: string,
): string[] {
  const out: string[] = [];
  const push = (raw?: string) => {
    if (!raw) return;
    const clean = normalizeUrlOrigin(raw);
    if (!clean) return;
    // Never prioritize loopback for remote mesh failover unless primaryUrl itself is loopback.
    const primaryIsLoopback =
      primaryUrl.includes('://127.0.0.1') || primaryUrl.includes('://localhost');
    const candidateIsLoopback = clean.includes('://127.0.0.1') || clean.includes('://localhost');
    if (candidateIsLoopback && !primaryIsLoopback) return;
    if (!out.includes(clean)) out.push(clean);
  };
  push(preferredCoordinatorUrl);
  push(primaryUrl);
  if (clusterUrls) {
    for (const url of clusterUrls) push(url);
  }
  return out;
}
