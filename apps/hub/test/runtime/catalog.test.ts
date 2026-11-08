/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { expect, it, vi } from 'vitest';
import { createHubService } from '../../src/runtime/application.js';
import { createNestApp } from '../../src/nest.js';
import { CATALOG_SOURCE } from '../../src/storage/storage.module.js';
import { CatalogLifetime } from '../../src/storage/lifetime.js';
import { RecordingStore } from '../../src/events/recording.store.js';
import { deferred } from './support.js';

function failureMessages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(failureMessages);
  return error instanceof Error ? [error.message] : [];
}

it.each(['connection', 'writer'])(
  'reports a %s shutdown failure through the real Hub service without logging its private cause',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-catalog-failure-'));
    const sources: DataSource[] = [];
    const restorers: Array<() => void> = [];
    const privateCause = 'catalog-private-url-token-fixture';
    const logger = vi.spyOn(Logger, 'error').mockImplementation(() => {});
    const closeWriter = vi.fn(async () => {
      throw Error(privateCause);
    });
    let destroys = () => 0;
    let stopFailure: unknown;
    const service = createHubService({
      env: { HAUS_DATA_DIR: root, PORT: '0', HAUS_BIND_ADDRESS: '127.0.0.1' },
      createApp: async (options) => {
        const app = await createNestApp(options);
        const source = app.get<DataSource>(CATALOG_SOURCE);
        sources.push(source);
        const destroy = vi.spyOn(source, 'destroy');
        if (mode === 'connection') destroy.mockRejectedValueOnce(Error(privateCause));
        else app.get(CatalogLifetime).defer(closeWriter);
        destroys = () => destroy.mock.calls.length;
        restorers.push(() => destroy.mockRestore());
        return app;
      },
    });
    try {
      await service.start();
      await service.stop().catch((error: unknown) => {
        stopFailure = error;
      });
      expect.soft(stopFailure).toBeInstanceOf(AggregateError);
      expect.soft(service.state).toBe('failed');
      expect(failureMessages(stopFailure)).toContain(privateCause);
      expect(sources.at(0)?.isInitialized).toBe(true);
      expect(destroys()).toBe(mode === 'writer' ? 0 : 1);
      expect(closeWriter).toHaveBeenCalledTimes(mode === 'writer' ? 1 : 0);
      await expect(service.stop()).rejects.toBe(stopFailure);
      expect(destroys()).toBe(mode === 'writer' ? 0 : 1);
      const logged = logger.mock.calls
        .flat()
        .map((value: unknown) => (value instanceof Error ? value.stack : String(value)))
        .join('\n');
      expect(logged).not.toContain(privateCause);
    } finally {
      try {
        await service.stop().catch((error: unknown) => {
          if (error !== stopFailure) throw error;
        });
      } finally {
        for (const restore of restorers) restore();
        for (const source of sources) if (source.isInitialized) await source.destroy();
        logger.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);

it('stops HTTP admission while awaiting a catalog writer, then preserves its final record through actual Hub restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-catalog-owner-'));
  const entered = deferred(),
    release = deferred();
  const stores: RecordingStore[] = [];
  const closeWriter = vi.fn(async (store: RecordingStore) => {
    entered.resolve();
    await release.promise;
    await store.setCamera('fixture-camera', { stopped: true });
  });
  let port = 0;
  const options = {
    env: { HAUS_DATA_DIR: root, PORT: '0', HAUS_BIND_ADDRESS: '127.0.0.1' },
    ready: (_config: unknown, value: number) => {
      port = value;
    },
    createApp: async (configuration: Parameters<typeof createNestApp>[0]) => {
      const app = await createNestApp(configuration);
      const store = app.get(RecordingStore);
      if (stores.length === 0) app.get(CatalogLifetime).defer(() => closeWriter(store));
      stores.push(store);
      return app;
    },
  };
  const first = createHubService(options),
    second = createHubService(options);
  try {
    await first.start();
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const stopping = first.stop();
    await entered.promise;
    expect(first.stop()).toBe(stopping);
    expect(first.state).toBe('stopping');
    const original = stores.at(0);
    if (!original) throw Error('missing fixture store');
    expect(original.source.isInitialized).toBe(true);
    expect(await original.overrides()).toEqual({});
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    release.resolve();
    await stopping;
    expect(original.source.isInitialized).toBe(false);
    expect(first.state).toBe('closed');
    await second.start();
    expect(await stores.at(1)?.overrides()).toEqual({ 'fixture-camera': { stopped: true } });
    await second.stop();
    expect(closeWriter).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await Promise.all([first.stop(), second.stop()]);
    await rm(root, { recursive: true, force: true });
  }
});
