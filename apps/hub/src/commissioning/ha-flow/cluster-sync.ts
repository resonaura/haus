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
          getLocalStatus: () =>
            entry.disabled_by !== 'user' && this.leaseService?.shouldRunLocally(workloadId)
              ? 'running'
              : 'stopped',
          startLocal: async () => {
            await bindings.syncRuntimeState();
          },
          stopLocal: async () => {
            await bindings.removeEntryFromRuntime(entry.entry_id);
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
        await this.leaseService.ensureLocalOwnership({
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
        if (!this.leaseService.shouldRunLocally(workloadId)) {
          continue;
        }
      }
      active.push(entry);
    }
    return active;
  }
}
