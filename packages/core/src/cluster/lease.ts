/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface ResourceLease {
  readonly resourceId: string;
  readonly holderHubId: string;
  readonly generation: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly renewedAt: string;
}

export type LeaseErrorCode =
  'LEASE_ALREADY_HELD' | 'STALE_LEASE_GENERATION' | 'LEASE_EXPIRED' | 'NOT_LEASE_HOLDER';

export class LeaseError extends Error {
  constructor(
    readonly code: LeaseErrorCode,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'LeaseError';
  }
}

export interface LeaseStore {
  get(resourceId: string): ResourceLease | undefined;
  set(lease: ResourceLease): void;
  delete(resourceId: string): void;
  list(): readonly ResourceLease[];
}

export class InMemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, ResourceLease>();

  get(resourceId: string): ResourceLease | undefined {
    return this.leases.get(resourceId);
  }

  set(lease: ResourceLease): void {
    this.leases.set(lease.resourceId, lease);
  }

  delete(resourceId: string): void {
    this.leases.delete(resourceId);
  }

  list(): readonly ResourceLease[] {
    return Array.from(this.leases.values());
  }
}

export class ScopedLeaseManager {
  constructor(
    private readonly store: LeaseStore = new InMemoryLeaseStore(),
    private readonly defaultDurationMs: number = 30000,
  ) {}

  private isExpired(lease: ResourceLease, now: number): boolean {
    return new Date(lease.expiresAt).getTime() <= now;
  }

  acquireLease(
    resourceId: string,
    holderHubId: string,
    options?: { durationMs?: number; currentTime?: number },
  ): ResourceLease {
    const now = options?.currentTime ?? Date.now();
    const duration = options?.durationMs ?? this.defaultDurationMs;
    const existing = this.store.get(resourceId);

    if (existing) {
      const expired = this.isExpired(existing, now);

      if (!expired) {
        if (existing.holderHubId === holderHubId) {
          // Re-affirm existing valid lease
          return existing;
        }
        throw new LeaseError(
          'LEASE_ALREADY_HELD',
          `Resource "${resourceId}" is exclusively held by "${existing.holderHubId}" until ${existing.expiresAt}.`,
        );
      }

      // Expired lease takeover: increment generation to fence off stale holder
      const newGeneration = existing.generation + 1;
      const isoNow = new Date(now).toISOString();
      const isoExpires = new Date(now + duration).toISOString();

      const newLease: ResourceLease = {
        resourceId,
        holderHubId,
        generation: newGeneration,
        acquiredAt: isoNow,
        expiresAt: isoExpires,
        renewedAt: isoNow,
      };

      this.store.set(newLease);
      return newLease;
    }

    // First acquisition of this resource
    const isoNow = new Date(now).toISOString();
    const isoExpires = new Date(now + duration).toISOString();

    const newLease: ResourceLease = {
      resourceId,
      holderHubId,
      generation: 1,
      acquiredAt: isoNow,
      expiresAt: isoExpires,
      renewedAt: isoNow,
    };

    this.store.set(newLease);
    return newLease;
  }

  renewLease(
    resourceId: string,
    holderHubId: string,
    generation: number,
    options?: { durationMs?: number; currentTime?: number },
  ): ResourceLease {
    const now = options?.currentTime ?? Date.now();
    const duration = options?.durationMs ?? this.defaultDurationMs;
    const existing = this.store.get(resourceId);

    if (!existing) {
      throw new LeaseError('LEASE_EXPIRED', `No active lease exists for resource "${resourceId}".`);
    }

    if (existing.generation !== generation) {
      throw new LeaseError(
        'STALE_LEASE_GENERATION',
        `Generation mismatch on renewal for "${resourceId}". Presented generation ${generation}, current generation is ${existing.generation}. Holder fenced.`,
      );
    }

    if (existing.holderHubId !== holderHubId) {
      throw new LeaseError(
        'NOT_LEASE_HOLDER',
        `Hub "${holderHubId}" is not the recorded holder of lease "${resourceId}" (held by "${existing.holderHubId}").`,
      );
    }

    const isoNow = new Date(now).toISOString();
    const isoExpires = new Date(now + duration).toISOString();

    const renewed: ResourceLease = {
      ...existing,
      expiresAt: isoExpires,
      renewedAt: isoNow,
    };

    this.store.set(renewed);
    return renewed;
  }

  releaseLease(resourceId: string, holderHubId: string, generation: number): void {
    const existing = this.store.get(resourceId);
    if (!existing) return;

    if (existing.holderHubId === holderHubId && existing.generation === generation) {
      this.store.delete(resourceId);
    }
  }

  fenceResource(resourceId: string): number {
    const existing = this.store.get(resourceId);
    const nextGen = (existing?.generation ?? 0) + 1;
    this.store.set({
      resourceId,
      holderHubId: '__FENCED__',
      generation: nextGen,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(0).toISOString(), // Expired immediately, blocking writes until explicit reacquisition
      renewedAt: new Date().toISOString(),
    });
    return nextGen;
  }

  validateWriteToken(
    resourceId: string,
    holderHubId: string,
    generation: number,
    currentTime?: number,
  ): boolean {
    const now = currentTime ?? Date.now();
    const existing = this.store.get(resourceId);
    if (!existing) return false;

    // Fencing token check: generation must strictly match
    if (existing.generation !== generation) return false;
    // Holder must match
    if (existing.holderHubId !== holderHubId) return false;
    // Must not be expired
    if (this.isExpired(existing, now)) return false;

    return true;
  }

  getLease(resourceId: string): ResourceLease | undefined {
    return this.store.get(resourceId);
  }
}
