/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Transactions } from '../transactions.js';
import {
  ClientEntity,
  FeatureEntity,
  ReadyEntity,
  OwnerEntity,
  ReleaseEntity,
  JournalEntity,
} from './entities.js';
import type {
  ClientRow,
  FeatureRow,
  ReadyRow,
  OwnerRow,
  ReleaseRow,
  JournalRow,
} from './entities.js';
const readyKey = (clientId: string, cameraId: string) => `${clientId}\0${cameraId}`;

/** Committed snapshots keep authentication and ownership checks synchronous. */
export class HaCatalog {
  private clients = new Map<string, ClientRow>();
  private features = new Map<string, FeatureRow>();
  private readiness = new Map<string, ReadyRow>();
  private owners = new Map<string, OwnerRow>();
  private releases = new Map<string, ReleaseRow>();
  private journals = new Map<string, JournalRow>();
  constructor(private readonly transactions: Transactions) {}
  async initialize(): Promise<void> {
    const data = await this.transactions.read(async (manager) => ({
      clients: await manager.find(ClientEntity),
      features: await manager.find(FeatureEntity),
      readiness: await manager.find(ReadyEntity),
      owners: await manager.find(OwnerEntity),
      releases: await manager.find(ReleaseEntity),
      journals: await manager.find(JournalEntity),
    }));
    this.clients = new Map(data.clients.map((row) => [row.id, row]));
    this.features = new Map(data.features.map((row) => [row.clientId, row]));
    this.readiness = new Map(
      data.readiness.map((row) => [readyKey(row.clientId, row.cameraId), row]),
    );
    this.owners = new Map(data.owners.map((row) => [row.cameraId, row]));
    this.releases = new Map(data.releases.map((row) => [row.bridgeId, row]));
    this.journals = new Map(data.journals.map((row) => [row.bridgeId, row]));
  }
  canManageNative(id: string): boolean {
    return this.clients.get(id)?.nativeEntities === true;
  }
  authenticate(tokenHash: string): string | undefined {
    return [...this.clients.values()].find((row) => row.tokenHash === tokenHash)?.id;
  }
  hasNativeClient(): boolean {
    return [...this.clients.values()].some((row) => row.nativeEntities);
  }
  ownsActivity(cameraId: string): boolean {
    const owner = this.owners.get(cameraId);
    return !!owner && this.canManageNative(owner.clientId);
  }
  readyClient(cameraId: string, revision: string, after: number): { clientId: string } | undefined {
    const row = [...this.readiness.values()]
      .filter(
        (row) =>
          row.cameraId === cameraId &&
          row.revision === revision &&
          row.at >= after &&
          this.canManageNative(row.clientId),
      )
      .sort((a, b) => b.at - a.at)[0];
    return row && { clientId: row.clientId };
  }
  supportsDisabledReadiness(clientId: string, after: number): boolean {
    const row = this.features.get(clientId);
    return !!row?.disabledReadiness && row.at >= after;
  }
  pendingReleases(): string[] {
    return [...this.releases.keys()];
  }
  releasing(bridgeId: string): boolean {
    return this.releases.has(bridgeId);
  }
  ownedCameras(clientId: string): string[] {
    return [...this.owners.values()]
      .filter((row) => row.clientId === clientId)
      .map((row) => row.cameraId);
  }
  journalRows(): JournalRow[] {
    return [...this.journals.values()].map((row) => ({ ...row }));
  }
  journal(id: string): string | undefined {
    return this.journals.get(id)?.value;
  }
  async enroll(row: ClientRow): Promise<void> {
    await this.transactions.run(async (manager) => {
      if ((await manager.count(ClientEntity)) >= 16) throw Error('ha_integration_busy');
      await manager.insert(ClientEntity, row);
    });
    this.clients.set(row.id, { ...row });
  }
  async revoke(clientId: string, bridges: readonly string[], at: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      for (const bridgeId of bridges)
        await manager.upsert(ReleaseEntity, { bridgeId, requestedAt: at }, ['bridgeId']);
      await manager.delete(ClientEntity, { id: clientId });
    });
    for (const bridgeId of bridges) this.releases.set(bridgeId, { bridgeId, requestedAt: at });
    this.clients.delete(clientId);
  }
  async acknowledge(
    clientId: string,
    values: readonly { cameraId: string; revision: string }[],
    disabledReadiness: boolean,
    at: number,
  ): Promise<void> {
    await this.transactions.run(async (manager) => {
      if (!(await manager.findOneBy(ClientEntity, { id: clientId, nativeEntities: true })))
        throw Error('native_access_required');
      if (disabledReadiness)
        await manager.upsert(FeatureEntity, { clientId, disabledReadiness: true, at }, [
          'clientId',
        ]);
      for (const value of values)
        await manager.upsert(ReadyEntity, { clientId, ...value, at }, ['clientId', 'cameraId']);
    });
    if (disabledReadiness) this.features.set(clientId, { clientId, disabledReadiness: true, at });
    for (const value of values)
      this.readiness.set(readyKey(clientId, value.cameraId), { clientId, ...value, at });
  }
  async requestRelease(bridgeId: string, at: number): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.upsert(ReleaseEntity, { bridgeId, requestedAt: at }, ['bridgeId']);
    });
    this.releases.set(bridgeId, { bridgeId, requestedAt: at });
  }
  async completeRelease(bridgeId: string, cameraIds: readonly string[]): Promise<void> {
    await this.transactions.run(async (manager) => {
      for (const cameraId of cameraIds) await manager.delete(OwnerEntity, { cameraId });
      await manager.delete(ReleaseEntity, { bridgeId });
    });
    for (const cameraId of cameraIds) this.owners.delete(cameraId);
    this.releases.delete(bridgeId);
  }
  async handover(bridgeId: string, owners: readonly OwnerRow[], at: number): Promise<void> {
    const accepted = await this.transactions.run(async (manager) => {
      for (const owner of owners)
        if (
          !(await manager.findOneBy(ClientEntity, { id: owner.clientId, nativeEntities: true }))
        ) {
          await manager.upsert(ReleaseEntity, { bridgeId, requestedAt: at }, ['bridgeId']);
          return false;
        }
      await manager.delete(ReleaseEntity, { bridgeId });
      for (const owner of owners) await manager.upsert(OwnerEntity, owner, ['cameraId']);
      return true;
    });
    if (!accepted) {
      this.releases.set(bridgeId, { bridgeId, requestedAt: at });
      throw Error('native_ha_grant_revoked');
    }
    this.releases.delete(bridgeId);
    for (const owner of owners) this.owners.set(owner.cameraId, { ...owner });
  }
  async saveJournal(bridgeId: string, value: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.upsert(JournalEntity, { bridgeId, value }, ['bridgeId']);
    });
    this.journals.set(bridgeId, { bridgeId, value });
  }
}
