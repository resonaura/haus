/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import type { FlowDomainHandler } from '@haus/core';
import { STANDALONE_HOME_SERVICE, type StandaloneHomeService } from '../../home/home.service.js';
import { StandaloneHomePersistence } from '../../home/home.persistence.js';
import { CATALOG_TRANSACTIONS } from '../../storage/storage.module.js';
import type { Transactions } from '../../storage/transactions.js';
import { HUB_DATA_DIRECTORY } from '../../cluster/crypto/master-key.js';
import { ClusterLeaseService } from '../../cluster/coordination/leases.js';
import { deriveRequirementsFromWorkloadMeta } from '../../cluster/coordination/placement.js';
import { ClusterSyncService } from '../../cluster/sync/service.js';
import { AesGcmCredentialCipher } from '../credentials.service.js';
import type { PersistedIntegrationEntry } from '../entry-helpers.js';
import { TuyaApiSession, TuyaClient, type TuyaClientOptions } from './client.js';
import {
  createTuyaFlowHandler,
  type PendingTuyaAuthorization,
  type TuyaFlowSessionState,
} from './flow.js';
import { buildTuyaDpCommands, mapTuyaDeviceToHaus } from './mapper.js';
import type { TuyaStoredCredentials } from './types.js';

const POLL_INTERVAL_MS = 60_000;
const SYNC_TIMEOUT_MS = 10_000;

interface EncryptedCredentialsEnvelope {
  readonly encrypted: string;
}

/**
 * Coordinates live Tuya Device Sharing QR auth, encrypted token persistence,
 * cloud home/device sync, and device commands in standalone Hub mode.
 */
@Injectable()
export class HubTuyaService implements OnModuleDestroy {
  private readonly logger = new Logger(HubTuyaService.name);
  private readonly persistence: StandaloneHomePersistence;
  private cipher: AesGcmCredentialCipher;
  private client: TuyaClient;
  private readonly flowStates = new Map<string, TuyaFlowSessionState>();
  private readonly pendingCredentials = new Map<string, PendingTuyaAuthorization>();
  private readonly sessions = new Map<string, TuyaApiSession>();
  private readonly commandUnregisters = new Map<string, () => void>();
  private readonly disabledEntries = new Set<string>();
  private readonly inFlightSyncs = new Set<Promise<unknown>>();
  private destroyed = false;
  private pollTimer?: NodeJS.Timeout;
  private unsubscribeClusterSync?: () => void;

  constructor(
    @Optional()
    @Inject(STANDALONE_HOME_SERVICE)
    private readonly homeService?: StandaloneHomeService,
    @Optional() @Inject(CATALOG_TRANSACTIONS) transactions?: Transactions,
    @Optional() @Inject(HUB_DATA_DIRECTORY) dataDir?: string,
    @Optional() @Inject(ClusterLeaseService) private readonly clusterLeases?: ClusterLeaseService,
    @Optional() @Inject(ClusterSyncService) private readonly clusterSync?: ClusterSyncService,
  ) {
    this.persistence = new StandaloneHomePersistence(transactions);
    this.cipher = new AesGcmCredentialCipher(undefined, { dataDir });
    this.client = new TuyaClient();
  }

  /** Overrides the underlying HTTP client and cipher for isolated unit tests. */
  configureForTesting(options: {
    readonly clientOptions?: TuyaClientOptions;
    readonly cipherSecret?: string;
  }): void {
    if (options.clientOptions) {
      this.client = new TuyaClient(options.clientOptions);
    }
    if (options.cipherSecret) {
      this.cipher = new AesGcmCredentialCipher(options.cipherSecret);
    }
  }

  /** Awaits completion of any background cloud sync tasks tracked by this service. */
  async flushSyncs(): Promise<void> {
    while (this.inFlightSyncs.size > 0) {
      await Promise.allSettled(this.inFlightSyncs);
    }
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.unsubscribeClusterSync?.();
    this.unsubscribeClusterSync = undefined;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    for (const unregister of this.commandUnregisters.values()) {
      unregister();
    }
    this.commandUnregisters.clear();
    this.sessions.clear();
    this.persistence.close();
  }

  /** Creates a FlowDomainHandler using live Tuya QR auth endpoints. */
  createFlowHandler(): FlowDomainHandler {
    return createTuyaFlowHandler({
      getClient: () => this.client,
      flowStates: this.flowStates,
      pendingCredentials: this.pendingCredentials,
    });
  }

  /** Persists encrypted Tuya tokens after flow completion and runs initial device sync. */
  async commitPendingEntryCredentials(
    flowId: string,
    entryId: string,
    disabled = false,
  ): Promise<boolean> {
    const pending = this.pendingCredentials.get(flowId);
    if (!pending) return false;
    this.pendingCredentials.delete(flowId);

    const effectiveEntryId = entryId || pending.entryId;
    await this.saveEncryptedCredentials(effectiveEntryId, pending.credentials);
    const workloadId = `integration:tuya:${effectiveEntryId}`;
    this.registerClusterController(effectiveEntryId, 'Tuya');
    if (this.clusterLeases) {
      await this.clusterLeases.ensureLocalOwnership({
        workloadId,
        kind: 'integration',
        name: 'Tuya',
        requirements: deriveRequirementsFromWorkloadMeta({ kind: 'integration', id: 'tuya', name: 'Tuya' }),
        active: !disabled,
      });
    }
    const shouldRun = !this.clusterLeases || this.clusterLeases.shouldRunLocally(workloadId);
    if (shouldRun) {
      this.registerSession(effectiveEntryId, pending.credentials, disabled);
      if (!disabled) {
        await this.syncEntryWithTimeout(effectiveEntryId);
        this.ensurePollingLoop();
      }
    }
    return true;
  }

  private registerClusterController(entryId: string, title = 'Tuya'): void {
    if (!this.clusterLeases) return;
    const workloadId = `integration:tuya:${entryId}`;
    this.clusterLeases.registerWorkloadController(workloadId, {
      kind: 'integration',
      name: title,
      requirements: deriveRequirementsFromWorkloadMeta({ kind: 'integration', id: 'tuya', name: title }),
      getLocalStatus: () =>
        !this.disabledEntries.has(entryId) && this.sessions.has(entryId) ? 'running' : 'stopped',
      startLocal: async () => {
        if (this.destroyed || this.disabledEntries.has(entryId)) return;
        const creds = await this.loadEncryptedCredentials(entryId);
        if (!creds || this.destroyed) return;
        this.registerSession(entryId, creds, false);
        this.trackSync(this.syncEntry(entryId).catch(() => undefined));
        this.ensurePollingLoop();
      },
      stopLocal: async () => {
        this.unregisterCommandHandler(entryId);
        this.sessions.delete(entryId);
      },
      executeRemote: async (action, payload) => {
        if (action === 'execute_device_command' && this.homeService) {
          await this.homeService.executeDeviceCommand(
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
  }

  /** Restores Tuya cloud sessions for persisted config entries on Hub startup. */
  async restoreEntries(entries: readonly PersistedIntegrationEntry[]): Promise<void> {
    if (this.destroyed) return;
    if (this.clusterSync && !this.unsubscribeClusterSync) {
      this.unsubscribeClusterSync = this.clusterSync.onSnapshotApplied(async () => {
        if (this.destroyed || !this.clusterLeases) return;
        const rows = await this.persistence.listByKind<PersistedIntegrationEntry>('integration_entry');
        for (const row of rows) {
          if (row.value?.domain !== 'tuya') continue;
          const id = row.value.entry_id;
          this.registerClusterController(id, row.value.title);
          const wid = `integration:tuya:${id}`;
          if (!this.clusterLeases.shouldRunLocally(wid)) {
            this.unregisterCommandHandler(id);
            this.sessions.delete(id);
          } else if (row.value.disabled_by !== 'user' && !this.sessions.has(id)) {
            const creds = await this.loadEncryptedCredentials(id);
            if (creds && !this.destroyed) this.registerSession(id, creds, false);
          }
        }
      });
    }
    const tuyaEntries = entries.filter((e) => e.domain === 'tuya');
    if (tuyaEntries.length === 0) return;

    const storedRows =
      await this.persistence.listByKind<EncryptedCredentialsEnvelope>('tuya_credentials');
    if (this.destroyed) return;
    const byEntryId = new Map(storedRows.map((row) => [row.entryId, row.value]));

    for (const entry of tuyaEntries) {
      if (this.destroyed) return;
      this.registerClusterController(entry.entry_id, entry.title);
      const disabled = entry.disabled_by === 'user';
      if (this.clusterLeases) {
        const wid = `integration:tuya:${entry.entry_id}`;
        await this.clusterLeases.ensureLocalOwnership({
          workloadId: wid,
          kind: 'integration',
          name: entry.title || 'Tuya',
          requirements: deriveRequirementsFromWorkloadMeta({ kind: 'integration', id: 'tuya', name: entry.title }),
          active: !disabled,
        });
        if (!this.clusterLeases.shouldRunLocally(wid)) {
          continue;
        }
      }
      const envelope = byEntryId.get(entry.entry_id);
      if (!envelope?.encrypted) continue;
      try {
        const creds = await this.decryptCredentials(envelope.encrypted);
        if (this.destroyed) return;
        this.registerSession(entry.entry_id, creds, disabled);
        if (!disabled) {
          this.trackSync(
            this.syncEntry(entry.entry_id).catch((err) => {
              if (!this.destroyed) {
                this.logger.warn(`Initial Tuya sync warning for ${entry.entry_id}: ${String(err)}`);
              }
            }),
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to restore Tuya credentials for ${entry.entry_id}: ${String(err)}`,
        );
      }
    }

    if (!this.destroyed && this.sessions.size > 0) {
      this.ensurePollingLoop();
    }
  }

  /** Disables or re-enables a Tuya integration entry without losing device history. */
  async setEntryDisabled(entryId: string, disabled: boolean): Promise<void> {
    if (this.destroyed) return;
    if (disabled) {
      this.disabledEntries.add(entryId);
      this.unregisterCommandHandler(entryId);
      if (this.homeService) {
        for (const dev of this.homeService.listDevices()) {
          if (dev.source?.instanceId === entryId) {
            this.homeService.registerDevice({ ...dev, availability: 'offline' });
          }
        }
      }
      return;
    }

    this.disabledEntries.delete(entryId);
    let session = this.sessions.get(entryId);
    if (!session) {
      const loaded = await this.loadEncryptedCredentials(entryId);
      if (this.destroyed) return;
      if (loaded) {
        session = this.registerSession(entryId, loaded, false);
      }
    } else {
      this.registerCommandHandler(entryId, session);
    }
    if (session && !this.destroyed) {
      await this.trackSync(this.syncEntry(entryId));
      this.ensurePollingLoop();
    }
  }

  /** Expires Tuya terminal session best-effort and removes credentials and synced devices. */
  async removeEntry(entryId: string): Promise<void> {
    this.disabledEntries.delete(entryId);
    this.unregisterCommandHandler(entryId);
    const session = this.sessions.get(entryId);
    this.sessions.delete(entryId);

    if (session) {
      await session.expireTerminal().catch(() => {});
    }
    await this.persistence.remove('tuya_credentials', entryId);

    if (this.homeService) {
      for (const dev of this.homeService.listDevices()) {
        if (dev.source?.instanceId === entryId) {
          this.homeService.removeDevice(dev.id);
        }
      }
    }
  }

  /** Fetches all Tuya homes and devices for an entry and updates StandaloneHomeService. */
  async syncEntry(entryId: string): Promise<number> {
    if (this.destroyed || this.disabledEntries.has(entryId)) return 0;
    let session = this.sessions.get(entryId);
    if (!session) {
      const creds = await this.loadEncryptedCredentials(entryId);
      if (!creds || this.destroyed || this.disabledEntries.has(entryId)) return 0;
      session = this.registerSession(entryId, creds, false);
    }

    const activeSession = session;
    const isStale = (): boolean =>
      this.destroyed ||
      this.disabledEntries.has(entryId) ||
      this.sessions.get(entryId) !== activeSession;

    const homes = await activeSession.queryHomes();
    if (isStale()) return 0;

    const seenDeviceIds = new Set<string>();
    let syncedCount = 0;

    for (const home of homes) {
      const cloudDevices = await activeSession.queryDevicesByHome(home.id);
      if (isStale()) return 0;
      for (const cloudDevice of cloudDevices) {
        if (isStale()) return 0;
        const mapped = mapTuyaDeviceToHaus(cloudDevice, entryId, this.disabledEntries.has(entryId));
        seenDeviceIds.add(mapped.device.id);
        if (this.homeService) {
          this.homeService.registerDevice(mapped.device);
          for (const [endpointId, patch] of mapped.initialStates) {
            if (isStale()) return 0;
            await this.homeService.updateEndpointState(endpointId, patch, false);
          }
        }
        syncedCount += 1;
      }
    }

    if (this.homeService && !isStale()) {
      for (const existing of this.homeService.listDevices()) {
        if (existing.source?.instanceId === entryId && !seenDeviceIds.has(existing.id)) {
          this.homeService.removeDevice(existing.id);
        }
      }
    }

    return syncedCount;
  }

  private async syncEntryWithTimeout(entryId: string): Promise<void> {
    try {
      const syncPromise = this.trackSync(
        this.syncEntry(entryId).catch((err) => {
          if (!this.destroyed) {
            this.logger.warn(`Tuya device sync warning for ${entryId}: ${String(err)}`);
          }
          return 0;
        }),
      );
      await Promise.race([
        syncPromise,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, SYNC_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } catch (err) {
      this.logger.warn(`Tuya device sync warning for ${entryId}: ${String(err)}`);
    }
  }

  private trackSync<T>(promise: Promise<T>): Promise<T> {
    this.inFlightSyncs.add(promise);
    void promise.finally(() => {
      this.inFlightSyncs.delete(promise);
    });
    return promise;
  }

  private registerSession(
    entryId: string,
    credentials: TuyaStoredCredentials,
    disabled: boolean,
  ): TuyaApiSession {
    const session = this.client.createSession(credentials, async (refreshed) => {
      if (this.destroyed || !this.sessions.has(entryId)) return;
      await this.saveEncryptedCredentials(entryId, refreshed);
    });
    this.sessions.set(entryId, session);
    if (disabled) {
      this.disabledEntries.add(entryId);
      this.unregisterCommandHandler(entryId);
    } else {
      this.disabledEntries.delete(entryId);
      this.registerCommandHandler(entryId, session);
    }
    return session;
  }

  private registerCommandHandler(entryId: string, session: TuyaApiSession): void {
    if (this.destroyed || !this.homeService) return;
    this.unregisterCommandHandler(entryId);
    const unregister = this.homeService.registerCommandHandler(
      { protocol: 'vendor', externalId: entryId, domain: 'tuya' },
      async (endpointId, capability, command, parameters) => {
        if (this.disabledEntries.has(entryId)) {
          throw new Error('tuya_entry_disabled');
        }
        const dev = this.homeService
          ?.listDevices()
          .find((d) => d.endpoints.some((ep) => ep.id === endpointId));
        const ep = dev?.endpoints.find((candidate) => candidate.id === endpointId);
        const payload = buildTuyaDpCommands(ep?.sourceRefs, capability, command, parameters);
        if (!payload) {
          throw new Error('tuya_unsupported_command');
        }
        await session.sendCommands(payload.tuyaDeviceId, payload.commands);
      },
      { optimistic: true },
    );
    this.commandUnregisters.set(entryId, unregister);
  }

  private unregisterCommandHandler(entryId: string): void {
    const existing = this.commandUnregisters.get(entryId);
    if (existing) {
      existing();
      this.commandUnregisters.delete(entryId);
    }
  }

  private ensurePollingLoop(): void {
    if (this.destroyed || this.pollTimer || process.env.VITEST) return;
    this.pollTimer = setInterval(() => {
      if (this.destroyed) return;
      for (const entryId of this.sessions.keys()) {
        if (this.clusterLeases && !this.clusterLeases.shouldRunLocally(`integration:tuya:${entryId}`)) {
          continue;
        }
        if (!this.disabledEntries.has(entryId)) {
          this.trackSync(
            this.syncEntry(entryId).catch((err) => {
              if (!this.destroyed) {
                this.logger.warn(`Periodic Tuya sync failed for ${entryId}: ${String(err)}`);
              }
            }),
          );
        }
      }
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  private async saveEncryptedCredentials(
    entryId: string,
    credentials: TuyaStoredCredentials,
  ): Promise<void> {
    if (this.destroyed) return;
    const raw = Buffer.from(JSON.stringify(credentials), 'utf8');
    const encrypted = await this.cipher.encrypt(raw);
    if (this.destroyed) return;
    await this.persistence.save('tuya_credentials', entryId, { encrypted });
    void this.clusterLeases
      ?.bumpWorkloadRevision(`integration:tuya:${entryId}`, 'credentialRevision')
      .catch(() => undefined);
    void this.clusterSync
      ?.notifyLocalCredentialOrConfigChange('credential', `tuya:${entryId}`)
      .catch(() => undefined);
  }

  private async loadEncryptedCredentials(
    entryId: string,
  ): Promise<TuyaStoredCredentials | undefined> {
    const rows =
      await this.persistence.listByKind<EncryptedCredentialsEnvelope>('tuya_credentials');
    const row = rows.find((item) => item.entryId === entryId);
    if (!row?.value?.encrypted) return undefined;
    return this.decryptCredentials(row.value.encrypted);
  }

  private async decryptCredentials(encrypted: string): Promise<TuyaStoredCredentials> {
    const raw = await this.cipher.decrypt(encrypted);
    return JSON.parse(Buffer.from(raw).toString('utf8')) as TuyaStoredCredentials;
  }
}
