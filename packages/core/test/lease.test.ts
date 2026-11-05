/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { LeaseError, ScopedLeaseManager } from '../src/index.js';

describe('ScopedLeaseManager & Fencing Generations', () => {
  it('acquires and renews exclusive resource lease preserving generation', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    const lease = manager.acquireLease('recording:camera_front', 'hub_1', {
      durationMs: 30000,
      currentTime: now,
    });

    expect(lease.resourceId).toBe('recording:camera_front');
    expect(lease.holderHubId).toBe('hub_1');
    expect(lease.generation).toBe(1);
    expect(new Date(lease.expiresAt).getTime()).toBe(now + 30000);

    // Renew lease
    const renewed = manager.renewLease('recording:camera_front', 'hub_1', 1, {
      durationMs: 30000,
      currentTime: now + 10000,
    });

    expect(renewed.generation).toBe(1); // Generation strictly preserved on renewal!
    expect(new Date(renewed.expiresAt).getTime()).toBe(now + 40000);
  });

  it('strictly blocks duplicate recording writers for the same camera clip', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    // Hub 1 acquires writer lease
    manager.acquireLease('recording:camera_front', 'hub_1', {
      durationMs: 30000,
      currentTime: now,
    });

    // Hub 2 attempts to acquire same camera writer lease while valid
    expect(() =>
      manager.acquireLease('recording:camera_front', 'hub_2', {
        durationMs: 30000,
        currentTime: now + 5000,
      }),
    ).toThrowError(LeaseError);

    try {
      manager.acquireLease('recording:camera_front', 'hub_2', {
        durationMs: 30000,
        currentTime: now + 5000,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(LeaseError);
      const leaseErr = err as LeaseError;
      expect(leaseErr.code).toBe('LEASE_ALREADY_HELD');
      expect(leaseErr.message).toContain('hub_1');
    }
  });

  it('increments generation on lease takeover after expiration', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    // Hub 1 acquired lease expiring at now + 10000
    manager.acquireLease('recording:camera_front', 'hub_1', {
      durationMs: 10000,
      currentTime: now,
    });

    // At now + 15000, lease has expired
    const newLease = manager.acquireLease('recording:camera_front', 'hub_2', {
      durationMs: 10000,
      currentTime: now + 15000,
    });

    expect(newLease.holderHubId).toBe('hub_2');
    expect(newLease.generation).toBe(2); // Generation incremented!
  });

  it('fences off delayed workers attempting writes with stale generation tokens', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    // Hub 1 acquired generation 1
    const leaseGen1 = manager.acquireLease('recording:camera_front', 'hub_1', {
      durationMs: 10000,
      currentTime: now,
    });

    // Lease expires, Hub 2 takes over with generation 2
    manager.acquireLease('recording:camera_front', 'hub_2', {
      durationMs: 10000,
      currentTime: now + 12000,
    });

    // Delayed Hub 1 worker wakes up from pause/GC and validates write token with gen 1
    const isValid = manager.validateWriteToken(
      'recording:camera_front',
      'hub_1',
      leaseGen1.generation,
      now + 13000,
    );
    expect(isValid).toBe(false); // Stale worker strictly rejected!

    // Delayed worker attempting renewal with gen 1 throws
    expect(() =>
      manager.renewLease('recording:camera_front', 'hub_1', leaseGen1.generation, {
        currentTime: now + 13000,
      }),
    ).toThrowError(/STALE_LEASE_GENERATION/);

    // Current Hub 2 with generation 2 is valid
    const isHub2Valid = manager.validateWriteToken(
      'recording:camera_front',
      'hub_2',
      2,
      now + 13000,
    );
    expect(isHub2Valid).toBe(true);
  });

  it('preserves active sessions when coordinator disappears without aborting local jobs', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    manager.acquireLease('recording:camera_backyard', 'hub_local', {
      durationMs: 60000,
      currentTime: now,
    });

    // Even if peer/coordinator disappears, local lease remains valid for full duration
    expect(
      manager.validateWriteToken('recording:camera_backyard', 'hub_local', 1, now + 30000),
    ).toBe(true);
  });

  it('fences resource to immediately block all writes during emergency or transfer', () => {
    const manager = new ScopedLeaseManager();
    const now = 1000000;

    manager.acquireLease('token:spotify', 'hub_1', {
      durationMs: 30000,
      currentTime: now,
    });

    // Emergency revocation / split-brain fence
    const fencedGen = manager.fenceResource('token:spotify');
    expect(fencedGen).toBe(2);

    // Old holder is immediately blocked
    expect(manager.validateWriteToken('token:spotify', 'hub_1', 1, now + 1000)).toBe(false);
    expect(manager.validateWriteToken('token:spotify', 'hub_1', 2, now + 1000)).toBe(false);
  });
});
