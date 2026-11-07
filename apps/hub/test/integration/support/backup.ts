/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import type { RecordingStore } from '../../../src/events/recording.store.js';
import type { BackupCatalog } from '../../../src/backup/catalog.js';
import { record, identifier } from '../../nvr/support/values.js';
import { construct, invoke, loadLegacy } from './legacy.js';

export class BackupRuntime {
  private constructor(
    readonly instance: Record<string, unknown>,
    private readonly module: Record<string, unknown>,
  ) {}
  static async create(
    config: Record<string, unknown>,
    store: RecordingStore,
    catalog: BackupCatalog,
  ): Promise<BackupRuntime> {
    const module = await loadLegacy('backup/backups.mjs');
    return new BackupRuntime(construct(module, 'Backups', [config, store, catalog]), module);
  }
  async initialize(): Promise<void> {
    await invoke(this.instance, 'initialize');
  }
  get key(): Buffer {
    const key = this.instance.key;
    assert.ok(Buffer.isBuffer(key));
    return key;
  }
  async snapshot(kind: string): Promise<{ digest: string }> {
    const result = record(await invoke(this.instance, 'snapshot', kind));
    return { digest: identifier(result.digest) };
  }
  path(digest: string): string {
    return identifier(invoke(this.instance, 'path', digest));
  }
  recoveryKit(): Record<string, unknown> {
    return record(invoke(this.instance, 'recoveryKit'));
  }
  async unseal(input: string, output: string, key: Buffer): Promise<void> {
    await invoke(this.module, 'unseal', input, output, key);
  }
  async stop(): Promise<void> {
    await invoke(this.instance, 'stop');
  }
}
