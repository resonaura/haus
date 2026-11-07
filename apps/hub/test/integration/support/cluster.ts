/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { RecordingStore } from '../../../src/events/recording.store.js';
import type { ClusterCatalog } from '../../../src/cluster/catalog.js';
import { record } from '../../nvr/support/values.js';
import { construct, invoke, loadLegacy, records } from './legacy.js';

export class ClusterRuntime {
  private constructor(readonly instance: Record<string, unknown>) {}
  static async create(
    store: RecordingStore,
    backups: Record<string, unknown>,
    catalog: ClusterCatalog,
  ): Promise<ClusterRuntime> {
    const module = await loadLegacy('cluster/cluster.mjs');
    return new ClusterRuntime(construct(module, 'Cluster', [store, backups, { catalog }]));
  }
  async initialize(): Promise<void> {
    await invoke(this.instance, 'initialize');
  }
  async add(input: Record<string, unknown>): Promise<void> {
    await invoke(this.instance, 'add', input);
  }
  nodes(): Record<string, unknown>[] {
    return records(invoke(this.instance, 'nodes'));
  }
  status(): Record<string, unknown> {
    return record(invoke(this.instance, 'status'));
  }
  async tick(): Promise<void> {
    await invoke(this.instance, 'tick');
  }
  async poll(): Promise<void> {
    await invoke(this.instance, 'poll');
  }
  async source(event: unknown): Promise<unknown> {
    return await invoke(this.instance, 'source', event);
  }
  async preparePlayback(event: unknown, options: unknown): Promise<unknown> {
    return await invoke(this.instance, 'preparePlayback', event, options);
  }
  async stop(): Promise<void> {
    await invoke(this.instance, 'stop');
  }
}
