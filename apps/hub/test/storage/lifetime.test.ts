/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingStore } from '../../src/events/recording.store.js';
import { RecordingSettingEntity } from '../../src/events/recording.entities.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import {
  getDataSourcePendingQueue,
  getDataSourceQueueKey,
} from '../../src/storage/transactions.js';

const roots: string[] = [];
const sources: DataSource[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const source of sources.splice(0)) {
    if (!source.isInitialized) continue;
    await new Transactions(source).drain();
    await source.destroy();
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function open(path?: string) {
  const root = await mkdtemp(join(tmpdir(), 'haus-catalog-lifetime-'));
  roots.push(root);
  const file = path ?? join(root, 'catalog.sqlite');
  const source = await openCatalog(file);
  sources.push(source);
  const transactions = new Transactions(source);
  return { root, file, source, transactions, lifetime: new CatalogLifetime(source, transactions) };
}

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(['before', 'after'])(
  'keeps writers ahead of stores registered %s them and persists their final write across restart',
  async (order) => {
    const fixture = await open();
    const { source, transactions, lifetime } = fixture;
    const store = new RecordingStore(source, join(fixture.root, 'media'), transactions);
    const entered = gate(),
      release = gate();
    const closeStore = vi.spyOn(store, 'close');
    const destroy = vi.spyOn(source, 'destroy');
    let joined: Promise<void> | undefined;
    const writer = async () => {
      joined = lifetime.close();
      entered.resolve();
      await release.promise;
      await store.setCamera('final-owner-write', { stopped: true });
    };
    if (order === 'before') lifetime.deferStore(() => store.close());
    lifetime.defer(writer);
    if (order === 'after') lifetime.deferStore(() => store.close());
    const closing = lifetime.close();
    try {
      await entered.promise;
      expect(joined).toBe(closing);
      expect(lifetime.state).toBe('closing');
      expect(source.isInitialized).toBe(true);
      expect(closeStore).not.toHaveBeenCalled();
      expect(() => lifetime.defer(() => {})).toThrow('catalog_closing');
      expect(() => lifetime.deferStore(() => {})).toThrow('catalog_closing');
    } finally {
      release.resolve();
      await closing;
    }
    expect(lifetime.state).toBe('closed');
    expect(source.isInitialized).toBe(false);
    expect(closeStore).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(lifetime.close()).toBe(closing);
    await expect(transactions.run(async () => {})).rejects.toThrow('storage_closed');
    const reopened = await open(fixture.file);
    expect(
      await reopened.source.manager.findOneBy(RecordingSettingEntity, { id: 'final-owner-write' }),
    ).toEqual({ id: 'final-owner-write', value: JSON.stringify({ stopped: true }) });
  },
);

it('retains the catalog on unconfirmed writer cleanup, attempts other writers, and never replays a failed close', async () => {
  const { lifetime, source, transactions } = await open();
  const failure = Error('writer_shutdown_unconfirmed');
  const other = vi.fn(async () => {}),
    store = vi.fn(async () => {});
  const destroy = vi.spyOn(source, 'destroy');
  const drain = vi.spyOn(transactions, 'drain');
  lifetime.defer(other);
  lifetime.defer(async () => {
    throw failure;
  });
  lifetime.deferStore(store);
  const closing = lifetime.close();
  const rejected = await closing.catch((error: unknown) => error);
  expect(rejected).toBeInstanceOf(AggregateError);
  expect(other).toHaveBeenCalledTimes(1);
  expect(store).not.toHaveBeenCalled();
  expect(drain).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
  expect(source.isInitialized).toBe(true);
  expect(lifetime.state).toBe('failed');
  expect(lifetime.close()).toBe(closing);
  await expect(lifetime.close()).rejects.toBe(rejected);
  await transactions.run(async (manager) => {
    await manager.insert(RecordingSettingEntity, { id: 'still-owned', value: 'true' });
  });
  expect(() => lifetime.defer(() => {})).toThrow('catalog_closing');
});

it('attempts remaining stores and releases the source only after confirmed transaction drain on a store error', async () => {
  const { lifetime, source, transactions } = await open();
  const other = vi.fn(async () => {});
  lifetime.deferStore(other);
  lifetime.deferStore(async () => {
    throw Error('store_release_failure');
  });
  await expect(lifetime.close()).rejects.toThrow('catalog_shutdown_failed');
  expect(other).toHaveBeenCalledTimes(1);
  expect(lifetime.state).toBe('failed');
  expect(source.isInitialized).toBe(false);
  await expect(transactions.read(async () => {})).rejects.toThrow('storage_closed');
});

it('does not destroy an undrained catalog or silently retry its failed shutdown', async () => {
  const { lifetime, source, transactions } = await open();
  const drain = vi.spyOn(transactions, 'drain').mockRejectedValue(Error('drain_unconfirmed'));
  const destroy = vi.spyOn(source, 'destroy');
  const failure = await lifetime.close().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(lifetime.state).toBe('failed');
  expect(source.isInitialized).toBe(true);
  expect(destroy).not.toHaveBeenCalled();
  await expect(lifetime.close()).rejects.toBe(failure);
  expect(drain).toHaveBeenCalledTimes(1);
});

it('rejects a transaction owner from a different source and a source already destroyed', async () => {
  const first = await open(),
    second = await open();
  expect(() => new CatalogLifetime(first.source, second.transactions)).toThrow(
    'invalid_catalog_lifetime',
  );
  await first.transactions.drain();
  await first.source.destroy();
  expect(() => new CatalogLifetime(first.source, first.transactions)).toThrow(
    'invalid_catalog_lifetime',
  );
});

it('retains the queue key and resolves pending queues if the database directory is removed before close', async () => {
  const { root, source, lifetime } = await open();
  const initialKey = getDataSourceQueueKey(source);
  await rm(root, { recursive: true, force: true });
  expect(getDataSourceQueueKey(source)).toBe(initialKey);
  await expect(getDataSourcePendingQueue(source)).resolves.toBeUndefined();
  await expect(lifetime.close()).resolves.toBeUndefined();
});
