/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SessionOwner, SessionRecord } from '@haus/core/session';
import type { PrivateFiles } from './files.js';
import type { LocalRecovery } from './types.js';

export function isPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

/** OS process recovery verifying that a previously recorded process has terminated. */
export class OsProcessRecovery implements LocalRecovery {
  constructor(private readonly files: PrivateFiles) {}

  async fence(previous: SessionRecord, proposedOwner: SessionOwner): Promise<void> {
    if (previous.owner.hubId !== proposedOwner.hubId) {
      throw Error('integration_local_recovery_unavailable');
    }
    if (previous.owner.processId === proposedOwner.processId) {
      throw Error('integration_local_recovery_unavailable');
    }
    const bytes = await this.files.read('process');
    if (!bytes) {
      throw Error('integration_recovery_unverified');
    }
    let lease: unknown;
    try {
      lease = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw Error('integration_recovery_unverified');
    }
    if (
      !lease ||
      typeof lease !== 'object' ||
      Array.isArray(lease) ||
      !('version' in lease) ||
      lease.version !== 1 ||
      !('hubId' in lease) ||
      lease.hubId !== previous.owner.hubId
    ) {
      throw Error('integration_recovery_unverified');
    }

    const leaseObj = lease as Record<string, unknown>;
    const prevLease =
      leaseObj.previous && typeof leaseObj.previous === 'object'
        ? (leaseObj.previous as Record<string, unknown>)
        : undefined;

    const target =
      leaseObj.processId === previous.owner.processId && typeof leaseObj.pid === 'number'
        ? { pid: leaseObj.pid }
        : prevLease &&
            prevLease.processId === previous.owner.processId &&
            typeof prevLease.pid === 'number'
          ? { pid: prevLease.pid as number }
          : undefined;

    if (!target) {
      throw Error('integration_recovery_unverified');
    }

    const targetPid = target.pid;
    if (targetPid === process.pid) {
      return;
    }

    if (isPidAlive(targetPid)) {
      try {
        process.kill(targetPid, 'SIGTERM');
      } catch {
        // Ignored
      }
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 20));
        if (!isPidAlive(targetPid)) break;
      }
      if (isPidAlive(targetPid)) {
        try {
          process.kill(targetPid, 'SIGKILL');
        } catch {
          // Ignored
        }
        await new Promise((r) => setTimeout(r, 20));
        if (isPidAlive(targetPid)) {
          throw Error('integration_recovery_unverified');
        }
      }
    }
  }
}
