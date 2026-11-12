/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import {
  isLeaseValid,
  type Advertisement,
  type RadioAgent,
  type RadioAgentCapabilities,
  type RadioAgentDescriptor,
  type RadioAgentPlatform,
  type RadioAgentSessionLease,
  type ScanRequest,
} from '@haus/core';

export interface AgentRegistrationInput {
  readonly id?: string;
  readonly name: string;
  readonly platform: RadioAgentPlatform;
  readonly capabilities?: RadioAgentCapabilities;
  readonly homeId: string;
}

interface AgentEntry {
  readonly agent: RadioAgent;
  descriptor: RadioAgentDescriptor;
}

interface ActiveScanSession {
  readonly commissioningId: string;
  readonly agentScans: Map<string, { abort: () => void }>;
}

export class RadioAgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly leases = new Map<string, RadioAgentSessionLease>();
  private readonly transportOwners = new Map<string, string>(); // commissioningId -> agentId
  private readonly activeScans = new Map<string, ActiveScanSession>(); // commissioningId -> ActiveScanSession

  register(agent: RadioAgent, input?: Partial<RadioAgentDescriptor>): () => void {
    const id = agent.id;
    const now = Date.now();
    const descriptor: RadioAgentDescriptor = {
      id,
      name: input?.name ?? `Radio Agent (${id})`,
      platform: agent.platform,
      capabilities: input?.capabilities ?? { bleScan: true, bleConnect: true },
      homeId: input?.homeId ?? 'home-default',
      registeredAt: input?.registeredAt ?? now,
      lastSeenAt: now,
      status: input?.status ?? 'online',
    };
    this.agents.set(id, { agent, descriptor });
    return () => {
      this.unregister(id);
    };
  }

  unregister(agentId: string): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    this.revokeAllLeasesForAgent(agentId);
    if ('disconnect' in entry.agent && typeof entry.agent.disconnect === 'function') {
      entry.agent.disconnect('agent_unregistered');
    }
    this.agents.delete(agentId);
    return true;
  }

  get(agentId: string): RadioAgent | undefined {
    return this.agents.get(agentId)?.agent;
  }

  getDescriptor(agentId: string): RadioAgentDescriptor | undefined {
    return this.agents.get(agentId)?.descriptor;
  }

  list(filter?: {
    homeId?: string;
    platform?: RadioAgentPlatform;
    onlineOnly?: boolean;
  }): RadioAgent[] {
    return this.listEntries(filter).map((e) => e.agent);
  }

  listDescriptors(filter?: {
    homeId?: string;
    platform?: RadioAgentPlatform;
    onlineOnly?: boolean;
  }): RadioAgentDescriptor[] {
    return this.listEntries(filter).map((e) => ({ ...e.descriptor }));
  }

  heartbeat(agentId: string, now = Date.now()): boolean {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    entry.descriptor = { ...entry.descriptor, lastSeenAt: now, status: 'online' };
    return true;
  }

  pruneStale(maxIdleMs = 60_000, now = Date.now()): string[] {
    const stale: string[] = [];
    for (const [id, entry] of this.agents.entries()) {
      if (now - entry.descriptor.lastSeenAt > maxIdleMs) {
        if (entry.descriptor.status === 'online') {
          entry.descriptor = { ...entry.descriptor, status: 'offline' };
          stale.push(id);
        }
      }
    }
    return stale;
  }

  grantLease(
    agentId: string,
    commissioningId: string,
    homeId: string,
    ttlMs = 120_000,
  ): RadioAgentSessionLease {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error('agent_not_found');
    if (entry.descriptor.homeId !== homeId) throw new Error('wrong_home');
    if (entry.descriptor.status === 'offline') throw new Error('agent_offline');

    const now = Date.now();
    const leaseId = randomUUID();
    const leaseToken = randomBytes(24).toString('base64url');
    const permittedTransports: ('ble' | 'softap')[] = [];
    if (entry.descriptor.capabilities.bleScan || entry.descriptor.capabilities.bleConnect) {
      permittedTransports.push('ble');
    }
    if (entry.descriptor.capabilities.softApScan || entry.descriptor.capabilities.softApConnect) {
      permittedTransports.push('softap');
    }

    const lease: RadioAgentSessionLease = {
      leaseId,
      leaseToken,
      agentId,
      commissioningId,
      homeId,
      grantedAt: now,
      expiresAt: now + ttlMs,
      revoked: false,
      permittedTransports,
    };

    this.leases.set(leaseId, lease);
    this.leases.set(leaseToken, lease);
    if ('setLease' in entry.agent && typeof entry.agent.setLease === 'function') {
      entry.agent.setLease(lease);
    }
    return lease;
  }

  validateLease(
    leaseToken: string,
    commissioningId: string,
    homeId: string,
    now = Date.now(),
  ): boolean {
    const lease = this.leases.get(leaseToken);
    return isLeaseValid(lease, commissioningId, homeId, now);
  }

  revokeLease(leaseIdOrToken: string): boolean {
    const lease = this.leases.get(leaseIdOrToken);
    if (!lease) return false;
    const revoked = { ...lease, revoked: true };
    this.leases.set(lease.leaseId, revoked);
    this.leases.set(lease.leaseToken, revoked);
    return true;
  }

  revokeAllLeasesForSession(commissioningId: string): number {
    let count = 0;
    for (const [key, lease] of this.leases.entries()) {
      if (lease.commissioningId === commissioningId && !lease.revoked) {
        this.revokeLease(key);
        count++;
      }
    }
    this.closeScansForSession(commissioningId);
    this.transportOwners.delete(commissioningId);
    return count;
  }

  revokeAllLeasesForAgent(agentId: string): number {
    let count = 0;
    for (const [key, lease] of this.leases.entries()) {
      if (lease.agentId === agentId && !lease.revoked) {
        this.revokeLease(key);
        count++;
      }
    }
    return count;
  }

  async *scanAcrossAgents(options: {
    commissioningId: string;
    homeId: string;
    request: ScanRequest;
    signal?: AbortSignal;
  }): AsyncIterable<Advertisement & { agentId: string }> {
    const onlineAgents = this.listEntries({ homeId: options.homeId, onlineOnly: true }).filter(
      (e) => e.descriptor.capabilities.bleScan !== false,
    );
    if (onlineAgents.length === 0) return;

    const agentScans = new Map<string, { abort: () => void }>();
    const session: ActiveScanSession = { commissioningId: options.commissioningId, agentScans };
    this.activeScans.set(options.commissioningId, session);

    const buffer: (Advertisement & { agentId: string })[] = [];
    let resolveWait: (() => void) | undefined;
    let completed = false;

    const pushAdv = (adv: Advertisement, agentId: string): void => {
      buffer.push({ ...adv, agentId });
      resolveWait?.();
    };

    const cleanup = (): void => {
      completed = true;
      for (const scan of agentScans.values()) {
        scan.abort();
      }
      agentScans.clear();
      this.activeScans.delete(options.commissioningId);
      resolveWait?.();
    };

    options.signal?.addEventListener('abort', cleanup, { once: true });

    for (const { agent } of onlineAgents) {
      this.grantLease(agent.id, options.commissioningId, options.homeId, options.request.timeoutMs);
      const controller = new AbortController();
      let activeIter: AsyncIterator<Advertisement> | undefined;
      agentScans.set(agent.id, {
        abort: () => {
          controller.abort();
          void activeIter?.return?.();
        },
      });

      const req: ScanRequest = { ...options.request, signal: controller.signal };
      void (async () => {
        try {
          const iterable = agent.scan(req);
          activeIter = iterable[Symbol.asyncIterator]();
          while (!completed && !controller.signal.aborted) {
            const next = await activeIter.next();
            if (next.done || completed || controller.signal.aborted) break;
            pushAdv(next.value, agent.id);
          }
        } catch {
          // agent scan ended or aborted
        } finally {
          void activeIter?.return?.();
        }
      })();
    }

    try {
      const deadline = Date.now() + (options.request.timeoutMs ?? 15_000);
      while (!completed && Date.now() < deadline) {
        if (options.signal?.aborted) break;
        if (buffer.length > 0) {
          const item = buffer.shift();
          if (item) yield item;
        } else {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            const remaining = Math.max(10, deadline - Date.now());
            const timer = setTimeout(resolve, Math.min(remaining, 500));
            resolveWait = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      }
    } finally {
      cleanup();
    }
  }

  claimTransportOwner(commissioningId: string, agentId: string): RadioAgent {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error('agent_not_found');
    this.transportOwners.set(commissioningId, agentId);

    // Close losing scans on all OTHER agents immediately
    const session = this.activeScans.get(commissioningId);
    if (session) {
      for (const [otherId, scan] of session.agentScans.entries()) {
        if (otherId !== agentId) {
          scan.abort();
          session.agentScans.delete(otherId);
        }
      }
    }
    return entry.agent;
  }

  getTransportOwner(commissioningId: string): string | undefined {
    return this.transportOwners.get(commissioningId);
  }

  closeScansForSession(commissioningId: string): void {
    const session = this.activeScans.get(commissioningId);
    if (session) {
      for (const scan of session.agentScans.values()) {
        scan.abort();
      }
      session.agentScans.clear();
      this.activeScans.delete(commissioningId);
    }
  }

  handleAgentDisconnect(agentId: string, reason = 'radio_agent_disconnected'): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.descriptor = { ...entry.descriptor, status: 'offline' };
    if ('disconnect' in entry.agent && typeof entry.agent.disconnect === 'function') {
      entry.agent.disconnect(reason);
    }
    this.revokeAllLeasesForAgent(agentId);
  }

  private listEntries(filter?: {
    homeId?: string;
    platform?: RadioAgentPlatform;
    onlineOnly?: boolean;
  }): AgentEntry[] {
    return Array.from(this.agents.values()).filter((e) => {
      if (filter?.homeId && e.descriptor.homeId !== filter.homeId) return false;
      if (filter?.platform && e.descriptor.platform !== filter.platform) return false;
      if (filter?.onlineOnly && e.descriptor.status !== 'online') return false;
      return true;
    });
  }
}
