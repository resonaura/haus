/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { KitsunePluginEntity, ServicePolicyEntity } from '../storage/policy/entities.js';
import type { KitsunePluginRow } from '../storage/policy/entities.js';
import type { Transactions } from '../storage/transactions.js';

/** One owner for durable server policies and installed plugin selections. */
export class ServiceCatalog {
  private readonly policies = new Map<string, string>();
  private readonly installed = new Map<string, KitsunePluginRow>();
  private initialization?: Promise<void>;
  private ready = false;

  constructor(private readonly transactions: Transactions) {}

  initialize(): Promise<void> {
    this.initialization ??= this.transactions
      .run(async (manager) => {
        const policies = await manager.find(ServicePolicyEntity);
        const plugins = await manager.find(KitsunePluginEntity);
        return { policies, plugins };
      })
      .then(({ policies, plugins }) => {
        for (const row of policies) this.policies.set(row.id, row.value);
        for (const row of plugins) this.installed.set(row.vendor, row);
        this.ready = true;
      })
      .catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  policy(id: string): string | undefined {
    this.assertReady();
    return this.policies.get(id);
  }

  async savePolicy(id: string, value: string): Promise<void> {
    this.assertReady();
    await this.transactions.run(async (manager) => {
      await manager.upsert(ServicePolicyEntity, { id, value }, ['id']);
    });
    this.policies.set(id, value);
  }

  plugins(): KitsunePluginRow[] {
    this.assertReady();
    return [...this.installed.values()].map((row) => ({ ...row }));
  }

  async savePlugin(vendor: string, version: string | null): Promise<void> {
    this.assertReady();
    await this.transactions.run(async (manager) => {
      await manager.upsert(KitsunePluginEntity, { vendor, version }, ['vendor']);
    });
    this.installed.set(vendor, { vendor, version });
  }

  private assertReady(): void {
    if (!this.ready) throw Error('service_catalog_not_initialized');
  }
}
