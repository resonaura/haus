/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ClusterLeaseService } from '../../cluster/coordination/leases.js';
import { deriveRequirementsFromWorkloadMeta } from '../../cluster/coordination/placement.js';
import type { ClusterSyncService } from '../../cluster/sync/service.js';
import type { PersistedIntegrationEntry } from '../entry-helpers.js';

export interface HaEntrySyncBindings {
  readonly reloadEntries: () => Promise<readonly PersistedIntegrationEntry[]>;
  readonly syncRuntimeState: () => Promise<void>;
  readonly removeEntryFromRuntime: (entryId: string) => Promise<void>;
  readonly executeLocalDeviceCommand?: (
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ) => Promise<void>;
}

/**
 * Coordinates single-active lease ownership and encrypted config/credential sync
 * for Home Assistant and generic commissioning integration entries.
 */
export class HaClusterIntegrationSync {
  private syncTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private destroyed = false;
  private entrySyncDepth = 0;
  private readonly localOwners = new Set<string>();

  constructor(
    private readonly leaseService?: ClusterLeaseService,
    private readonly syncService?: ClusterSyncService,
  ) {}

  attach(bindings: HaEntrySyncBindings): void {
    if (this.syncService && !this.unsubscribe) {
      this.unsubscribe = this.syncService.onSnapshotApplied(async () => {
        if (this.destroyed) return;
        const entries = await bindings.reloadEntries();
        await this.ensureEntryWorkloads(entries, bindings);
        await bindings.syncRuntimeState().catch(() => undefined);
      });
    }
  }

  dispose(): void {
    this.destroyed = true;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  scheduleSync(kind: 'credential' | 'config', resourceId: string): void {
    if (this.destroyed || !this.syncService || this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      if (this.destroyed) return;
      void this.syncService
        ?.notifyLocalCredentialOrConfigChange(kind, resourceId)
        .catch(() => undefined);
    }, 100);
    this.syncTimer.unref();
  }

  async ensureEntryWorkloads(
    entries: readonly PersistedIntegrationEntry[],
    bindings: HaEntrySyncBindings,
  ): Promise<readonly PersistedIntegrationEntry[]> {
    const active: PersistedIntegrationEntry[] = [];
    this.entrySyncDepth += 1;
    try {
      for (const entry of entries) {
        if (entry.domain === 'tuya' || entry.source === 'app') continue;
        const workloadId = `integration:${entry.entry_id}`;
        if (this.leaseService) {
          this.leaseService.registerWorkloadController(workloadId, {
            kind: 'integration',
            name: `${entry.title || entry.domain}`,
            requirements: deriveRequirementsFromWorkloadMeta({
              kind: 'integration',
              id: entry.domain,
              name: entry.title,
            }),
            getLocalStatus: () => (this.localOwners.has(workloadId) ? 'running' : 'stopped'),
            startLocal: async () => {
              // The enclosing reconciliation syncs the full entry set after leases settle.
              if (this.entrySyncDepth === 0) await bindings.syncRuntimeState();
              this.localOwners.add(workloadId);
            },
            stopLocal: async () => {
              await bindings.removeEntryFromRuntime(entry.entry_id);
              this.localOwners.delete(workloadId);
            },
            executeRemote: async (action, payload) => {
              if (action === 'execute_device_command' && bindings.executeLocalDeviceCommand) {
                await bindings.executeLocalDeviceCommand(
                  String(payload?.endpointId ?? ''),
                  String(payload?.capability ?? ''),
                  String(payload?.command ?? ''),
                  payload?.parameters as Record<string, unknown> | undefined,
                );
                return { ok: true };
              }
              return { ignored: true };
            },
          });
          const workload = await this.leaseService.ensureLocalOwnership({
            workloadId,
            kind: 'integration',
            name: entry.title || entry.domain,
            requirements: deriveRequirementsFromWorkloadMeta({
              kind: 'integration',
              id: entry.domain,
              name: entry.title,
            }),
            active: entry.disabled_by !== 'user',
          });
          if (
            entry.disabled_by !== 'user' &&
            workload?.state === 'stopped' &&
            !(await this.leaseService.reactivateStoppedLocalWorkload(workloadId))
          ) {
            continue;
          }
          if (!this.leaseService.shouldRunLocally(workloadId) && entry.disabled_by !== 'user') {
            this.localOwners.delete(workloadId);
            continue;
          }
          if (entry.disabled_by === 'user') this.localOwners.delete(workloadId);
          else this.localOwners.add(workloadId);
        }
        active.push(entry);
      }
    } finally {
      this.entrySyncDepth -= 1;
    }
    return active;
  }
}
