/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  DiscoveredCandidate,
  DiscoveryAdvertisementInput,
  DiscoveryFilter,
  DiscoveryMatcherRule,
  DiscoveryProtocol,
  DiscoveryStatus,
  DurableIdentity,
} from './discovery-types.js';
import { isGenericDiscoveryDomain, selectBestDiscoveryMatch } from './matchers.js';

export function normalizeMac(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  return clean.length >= 6 ? clean : undefined;
}

export function normalizeUuid(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  const withoutPrefix = trimmed.startsWith('uuid:') ? trimmed.slice(5) : trimmed;
  const match = withoutPrefix.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (match) return match[0];
  const clean = withoutPrefix.replace(/[^a-f0-9]/g, '');
  return clean.length >= 16 ? clean : undefined;
}

export function globMatches(pattern: string, target?: string): boolean {
  if (target === undefined || target === null) return false;
  const p = pattern.toLowerCase();
  const t = target.toLowerCase();
  if (p === '*' || p === t) return true;
  if (!p.includes('*')) return t.includes(p);
  const escaped = p.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(t);
}

export function computeDurableIdentities(input: DiscoveryAdvertisementInput): DurableIdentity[] {
  const ids: DurableIdentity[] = [];

  const rawMac =
    input.mac ??
    (typeof input.details?.macaddress === 'string' ? input.details.macaddress : undefined) ??
    (typeof input.details?.mac === 'string' ? input.details.mac : undefined);
  let mac = normalizeMac(rawMac);

  const rawHapId =
    typeof input.details?.id === 'string'
      ? input.details.id
      : typeof input.details?.accessoryId === 'string'
        ? input.details.accessoryId
        : undefined;
  if (
    rawHapId &&
    (input.protocol === 'homekit' ||
      String(input.details?.serviceType ?? '').startsWith('_hap._tcp'))
  ) {
    const cleanHapId = rawHapId.toLowerCase().trim();
    ids.push({ kind: 'hap', value: `hap:${cleanHapId}` });
    if (!mac) {
      mac = normalizeMac(cleanHapId);
    }
  }

  if (mac) ids.push({ kind: 'mac', value: `mac:${mac}` });

  const rawMatterRi =
    typeof input.details?.RI === 'string'
      ? input.details.RI
      : typeof input.details?.ri === 'string'
        ? input.details.ri
        : undefined;
  if (rawMatterRi) {
    ids.push({ kind: 'matter', value: `matter-ri:${rawMatterRi.toLowerCase().trim()}` });
  }

  const rawMatterInstance =
    typeof input.details?.instance === 'string' ? input.details.instance : undefined;
  if (
    rawMatterInstance &&
    (input.protocol === 'matter' ||
      String(input.details?.serviceType ?? '').startsWith('_matter._tcp'))
  ) {
    ids.push({ kind: 'matter', value: `matter:${rawMatterInstance.toLowerCase().trim()}` });
  }

  const rawUuid =
    input.uuid ??
    (typeof input.details?.uuid === 'string' ? input.details.uuid : undefined) ??
    (typeof input.details?.udn === 'string' ? input.details.udn : undefined) ??
    (typeof input.details?.usn === 'string' ? input.details.usn : undefined);
  const uuid = normalizeUuid(rawUuid);
  if (uuid) ids.push({ kind: 'uuid', value: `uuid:${uuid}` });

  if (input.usb) {
    const vid = input.usb.vid.toLowerCase().padStart(4, '0');
    const pid = input.usb.pid.toLowerCase().padStart(4, '0');
    const serial = (input.usb.serialNumber || input.usb.description || 'default')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    ids.push({ kind: 'usb', value: `usb:${vid}:${pid}:${serial}` });
  }

  const host = input.host ?? input.addresses?.[0];
  if (host && input.port) {
    ids.push({ kind: 'net', value: `net:${host.toLowerCase()}:${input.port}` });
  }

  if (input.mqttTopic) {
    ids.push({ kind: 'mqtt', value: `mqtt:${input.mqttTopic}` });
  }

  if (input.protocol === 'zeroconf') {
    const rawFqdn =
      typeof input.details?.instanceFqdn === 'string'
        ? input.details.instanceFqdn
        : typeof input.details?.serviceType === 'string' && input.name
          ? `${input.name}.${input.details.serviceType}`
          : undefined;
    const cleanFqdn = rawFqdn?.replace(/\.+$/, '').trim().toLowerCase();
    if (cleanFqdn) {
      ids.push({ kind: 'mdns', value: `mdns:${cleanFqdn}` });
    }
  }

  return ids;
}

export function pickPrimaryDurableId(identities: readonly DurableIdentity[]): string {
  const precedence: Record<string, number> = {
    matter: 7,
    hap: 6,
    mac: 5,
    uuid: 4,
    usb: 3,
    net: 2,
    mqtt: 1,
    mdns: 0,
  };
  const sorted = [...identities].sort(
    (a, b) => (precedence[b.kind] ?? 0) - (precedence[a.kind] ?? 0),
  );
  return sorted[0]?.value ?? `disc:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class DiscoveryRegistry {
  private readonly candidates = new Map<string, DiscoveredCandidate>();
  private readonly identityIndex = new Map<string, string>();
  private readonly ignored = new Set<string>();
  private readonly configured = new Set<string>();
  private readonly inProgress = new Map<string, string>();
  private readonly candidateListeners = new Set<(c: DiscoveredCandidate) => void>();

  ingest(
    input: DiscoveryAdvertisementInput,
    rules?: readonly DiscoveryMatcherRule[],
  ): DiscoveredCandidate {
    const identities = computeDurableIdentities(input);
    let existingId: string | undefined;

    for (const id of identities) {
      const match = this.identityIndex.get(id.value);
      if (match) {
        existingId = match;
        break;
      }
    }

    const primaryId = existingId ?? pickPrimaryDurableId(identities);
    const now = Date.now();
    const existing = existingId ? this.candidates.get(existingId) : undefined;

    const mergedDetails = { ...existing?.details, ...input.details };
    const matched = rules
      ? selectBestDiscoveryMatch(rules, { ...input, details: mergedDetails })
      : undefined;

    let matchedDomain: string;
    if (input.domain) {
      matchedDomain = input.domain;
    } else if (existing && existing.domain !== 'generic') {
      if (
        matched &&
        isGenericDiscoveryDomain(existing.domain) &&
        !isGenericDiscoveryDomain(matched.rule.domain)
      ) {
        matchedDomain = matched.rule.domain;
      } else {
        matchedDomain = existing.domain;
      }
    } else {
      matchedDomain = matched?.rule.domain ?? existing?.domain ?? 'generic';
    }

    const secondaryProtocols: DiscoveryProtocol[] = existing
      ? Array.from(new Set([...existing.secondaryProtocols, input.protocol]))
      : [input.protocol];

    const incomingIsResolved = input.details?.addressSource === 'resolved';
    const existingWasFallback = existing?.details?.addressSource === 'fallback';
    const baseAddresses =
      incomingIsResolved && existingWasFallback ? [] : (existing?.addresses ?? []);
    const mergedAddresses = Array.from(
      new Set([...baseAddresses, ...(input.addresses ?? []), ...(input.host ? [input.host] : [])]),
    );

    const mergedIdentities: DurableIdentity[] = [...(existing?.durableIdentities ?? [])];
    for (const id of identities) {
      if (!mergedIdentities.some((i) => i.kind === id.kind && i.value === id.value)) {
        mergedIdentities.push(id);
      }
    }

    let status: DiscoveryStatus = 'discovered';
    if (
      this.configured.has(primaryId) ||
      this.configured.has(input.mac ?? '') ||
      mergedIdentities.some((i) => this.configured.has(i.value))
    ) {
      status = 'configured';
    } else if (
      this.ignored.has(primaryId) ||
      mergedIdentities.some((i) => this.ignored.has(i.value))
    ) {
      status = 'ignored';
    } else if (this.inProgress.has(primaryId)) {
      status = 'in_progress';
    }

    const ttlMs =
      input.ttlMs ??
      (input.details?.ttl ? Number(input.details.ttl) * 1000 : undefined) ??
      (input.details?.ttlMs ? Number(input.details.ttlMs) : 120_000);
    const expiresAt = now + ttlMs;

    const candidate: DiscoveredCandidate = {
      id: primaryId,
      domain: matchedDomain,
      name: input.name?.trim() || existing?.name || matchedDomain,
      protocol: existing?.protocol ?? input.protocol,
      secondaryProtocols,
      status,
      authenticated: false,
      addresses: mergedAddresses,
      port: input.port ?? existing?.port,
      durableIdentities: mergedIdentities,
      details: mergedDetails,
      discoveredAt: existing?.discoveredAt ?? now,
      updatedAt: now,
      ttlMs,
      expiresAt,
      flowId: this.inProgress.get(primaryId),
    };

    this.candidates.set(primaryId, candidate);
    for (const id of mergedIdentities) {
      this.identityIndex.set(id.value, primaryId);
    }

    for (const listener of this.candidateListeners) {
      try {
        listener(candidate);
      } catch {
        // Safe dispatch
      }
    }

    return candidate;
  }

  ignore(candidateId: string): boolean {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return false;
    this.ignored.add(candidateId);
    for (const id of candidate.durableIdentities) {
      this.ignored.add(id.value);
    }
    this.candidates.set(candidateId, { ...candidate, status: 'ignored', updatedAt: Date.now() });
    return true;
  }

  seedIgnored(candidateId: string): void {
    this.ignored.add(candidateId);
    const candidate = this.candidates.get(candidateId);
    if (candidate) {
      this.candidates.set(candidateId, { ...candidate, status: 'ignored', updatedAt: Date.now() });
    }
  }

  unignore(candidateId: string): boolean {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return false;
    this.ignored.delete(candidateId);
    for (const id of candidate.durableIdentities) {
      this.ignored.delete(id.value);
    }
    const newStatus: DiscoveryStatus = this.configured.has(candidateId)
      ? 'configured'
      : this.inProgress.has(candidateId)
        ? 'in_progress'
        : 'discovered';
    this.candidates.set(candidateId, { ...candidate, status: newStatus, updatedAt: Date.now() });
    return true;
  }

  markConfigured(candidateId: string, configured = true): boolean {
    const candidate = this.candidates.get(candidateId);
    if (configured) {
      this.configured.add(candidateId);
      this.inProgress.delete(candidateId);
      if (candidate) {
        this.candidates.set(candidateId, {
          ...candidate,
          status: 'configured',
          flowId: undefined,
          updatedAt: Date.now(),
        });
      }
    } else {
      this.configured.delete(candidateId);
      if (candidate && candidate.status === 'configured') {
        this.candidates.set(candidateId, {
          ...candidate,
          status: 'discovered',
          updatedAt: Date.now(),
        });
      }
    }
    return true;
  }

  markInProgress(candidateId: string, flowId: string): boolean {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return false;
    this.inProgress.set(candidateId, flowId);
    this.candidates.set(candidateId, {
      ...candidate,
      status: 'in_progress',
      flowId,
      updatedAt: Date.now(),
    });
    return true;
  }

  releaseInProgress(flowId: string): boolean {
    let changed = false;
    for (const [candidateId, activeFlowId] of this.inProgress.entries()) {
      if (activeFlowId === flowId) {
        this.inProgress.delete(candidateId);
        const candidate = this.candidates.get(candidateId);
        if (candidate && candidate.status === 'in_progress') {
          const status = this.configured.has(candidateId)
            ? 'configured'
            : this.ignored.has(candidateId)
              ? 'ignored'
              : 'discovered';
          this.candidates.set(candidateId, {
            ...candidate,
            status,
            flowId: undefined,
            updatedAt: Date.now(),
          });
          changed = true;
        }
      }
    }
    return changed;
  }

  getCandidate(candidateId: string): DiscoveredCandidate | undefined {
    return this.candidates.get(candidateId);
  }

  listCandidates(filter?: DiscoveryFilter): readonly DiscoveredCandidate[] {
    const all = Array.from(this.candidates.values());
    return all.filter((c) => {
      if (filter?.status && c.status !== filter.status) return false;
      if (filter?.domain && c.domain.toLowerCase() !== filter.domain.toLowerCase()) return false;
      if (
        filter?.protocol &&
        c.protocol !== filter.protocol &&
        !c.secondaryProtocols.includes(filter.protocol)
      ) {
        return false;
      }
      return true;
    });
  }

  clearStale(maxAgeMs = 15 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, c] of this.candidates.entries()) {
      if (c.status === 'discovered' && now - c.updatedAt > maxAgeMs) {
        this.candidates.delete(id);
        for (const identity of c.durableIdentities) {
          this.identityIndex.delete(identity.value);
        }
        removed++;
      }
    }
    return removed;
  }

  pruneExpired(now = Date.now()): number {
    let removed = 0;
    for (const [id, c] of this.candidates.entries()) {
      if (c.status === 'discovered' && c.expiresAt !== undefined && now > c.expiresAt) {
        this.candidates.delete(id);
        for (const identity of c.durableIdentities) {
          this.identityIndex.delete(identity.value);
        }
        removed++;
      }
    }
    return removed;
  }

  async waitForCandidate(
    predicate: (candidate: DiscoveredCandidate) => boolean,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<DiscoveredCandidate | undefined> {
    const now = Date.now();
    for (const c of this.candidates.values()) {
      if ((c.expiresAt === undefined || c.expiresAt > now) && predicate(c)) {
        return c;
      }
    }

    if (options?.signal?.aborted) return undefined;

    return new Promise<DiscoveredCandidate | undefined>((resolve) => {
      const timeoutMs = options?.timeoutMs ?? 30_000;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.candidateListeners.delete(listener);
        options?.signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        resolve(undefined);
      };

      const listener = (c: DiscoveredCandidate) => {
        if (predicate(c)) {
          cleanup();
          resolve(c);
        }
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      timer = setTimeout(() => {
        cleanup();
        resolve(undefined);
      }, timeoutMs);

      this.candidateListeners.add(listener);
    });
  }
}
