/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { Transactions } from '../transactions.js';
import {
  ProviderEntity,
  ControllerEntity,
  CameraIdentityEntity,
  CameraSourceEntity,
} from './entities.js';
import type { ProviderRow, CameraIdentityRow, CameraSourceRow } from './entities.js';
const key = (bridgeId: string, physicalId: string) => `${bridgeId}\0${physicalId}`;

export class NativeCatalog {
  private providerRows = new Map<string, ProviderRow>();
  private identityRows = new Map<string, CameraIdentityRow>();
  private sourceRows = new Map<string, CameraSourceRow>();
  controllerId = '';
  constructor(private readonly transactions: Transactions) {}

  async initialize(): Promise<void> {
    const snapshot = await this.transactions.run(async (manager) => {
      let controller = await manager.findOneBy(ControllerEntity, { id: 1 });
      if (!controller) {
        controller = { id: 1, value: randomUUID() };
        await manager.insert(ControllerEntity, controller);
      }
      return {
        controller,
        providers: await manager.find(ProviderEntity),
        identities: await manager.find(CameraIdentityEntity),
        sources: await manager.find(CameraSourceEntity),
      };
    });
    this.controllerId = snapshot.controller.value;
    this.providerRows = new Map(snapshot.providers.map((row) => [row.id, row]));
    this.identityRows = new Map(
      snapshot.identities.map((row) => [key(row.bridgeId, row.physicalId), row]),
    );
    this.sourceRows = new Map(
      snapshot.sources.map((row) => [key(row.bridgeId, row.physicalId), row]),
    );
  }
  providers(): ProviderRow[] {
    return [...this.providerRows.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ ...row }));
  }
  identities(bridgeId: string): CameraIdentityRow[] {
    return [...this.identityRows.values()]
      .filter((row) => row.bridgeId === bridgeId)
      .sort((a, b) => a.physicalId.localeCompare(b.physicalId))
      .map((row) => ({ ...row }));
  }
  identity(bridgeId: string, physicalId: string): CameraIdentityRow | undefined {
    const row = this.identityRows.get(key(bridgeId, physicalId));
    return row && { ...row };
  }
  sources(): CameraSourceRow[] {
    return [...this.sourceRows.values()]
      .sort(
        (a, b) => a.bridgeId.localeCompare(b.bridgeId) || a.physicalId.localeCompare(b.physicalId),
      )
      .map((row) => ({ ...row }));
  }
  async addProvider(row: ProviderRow): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.insert(ProviderEntity, row);
    });
    this.providerRows.set(row.id, { ...row });
  }
  async removeProvider(id: string): Promise<void> {
    await this.transactions.run(async (manager) => {
      await manager.delete(ProviderEntity, { id });
    });
    this.providerRows.delete(id);
  }
  private async claim(manager: EntityManager, row: CameraIdentityRow): Promise<void> {
    const prior = await manager.findOneBy(CameraIdentityEntity, {
      bridgeId: row.bridgeId,
      physicalId: row.physicalId,
    });
    if (prior) {
      if (prior.cameraId !== row.cameraId) throw Error('native_camera_identity_conflict');
      return;
    }
    if (await manager.findOneBy(CameraIdentityEntity, { cameraId: row.cameraId }))
      throw Error('native_camera_identity_conflict');
    await manager.insert(CameraIdentityEntity, row);
  }
  async resolveIdentity(row: CameraIdentityRow): Promise<string> {
    await this.transactions.run((manager) => this.claim(manager, row));
    this.identityRows.set(key(row.bridgeId, row.physicalId), { ...row });
    return row.cameraId;
  }
  async importSources(rows: Array<{ identity: CameraIdentityRow; value: string }>): Promise<void> {
    await this.transactions.run(async (manager) => {
      for (const row of rows) {
        await this.claim(manager, row.identity);
        await manager.upsert(
          CameraSourceEntity,
          {
            bridgeId: row.identity.bridgeId,
            physicalId: row.identity.physicalId,
            value: row.value,
          },
          ['bridgeId', 'physicalId'],
        );
      }
    });
    for (const row of rows) {
      const id = key(row.identity.bridgeId, row.identity.physicalId);
      this.identityRows.set(id, { ...row.identity });
      this.sourceRows.set(id, {
        bridgeId: row.identity.bridgeId,
        physicalId: row.identity.physicalId,
        value: row.value,
      });
    }
  }
}
