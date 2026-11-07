/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HomeKitIdentityStorage } from '@haus/homekit';
import { HomeKitIdentityEntity } from '../storage/entities/domains.js';
import type { Transactions } from '../storage/transactions.js';

export class HomeKitIdentityStore implements HomeKitIdentityStorage {
  constructor(private readonly transactions: Transactions) {}

  async list(): Promise<readonly { cameraId: string; value: string }[]> {
    return this.transactions.run((manager) =>
      manager.find(HomeKitIdentityEntity, { select: { cameraId: true, value: true } }),
    );
  }

  async save(cameraId: string, value: string): Promise<void> {
    await this.transactions.run((manager) =>
      manager.upsert(HomeKitIdentityEntity, { cameraId, value }, ['cameraId']),
    );
  }

  async delete(cameraId: string): Promise<void> {
    await this.transactions.run((manager) => manager.delete(HomeKitIdentityEntity, { cameraId }));
  }
}
