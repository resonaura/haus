/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { Blobs, RecordingIndex, createNode } from '../../src/nvr/index.js';
import { port, required } from '../nvr/support/values.js';
import { remoteTarget } from './support/remote.js';
import { exerciseProtocol } from './support/protocol.js';

for (const keepFixture of [false, true])
  test(`exercises container protocol on an owned loopback fixture (retain=${keepFixture})`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-container-protocol-'));
    let index: RecordingIndex | undefined, listener: Server | undefined;
    context.onTestFinished(async () => {
      try {
        if (listener) {
          const server = listener;
          server.closeAllConnections();
          if (server.listening)
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
        }
      } finally {
        try {
          await index?.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    });
    const blobs = new Blobs(join(root, 'blobs'), { reserveBytes: 0, maxBytes: 4 * 1024 ** 2 });
    await blobs.initialize();
    const recordings = await RecordingIndex.open(join(root, 'recordings.sqlite'), blobs);
    index = recordings;
    const key = randomBytes(32).toString('hex'),
      keyFile = join(root, 'fixture.key');
    await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
    const server = createNode({
      key,
      blobs,
      recordings,
      nodeId: 'isolated-protocol-fixture',
      instanceId: randomUUID(),
    });
    listener = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const target = required(
      remoteTarget({
        HAUS_NVR_TEST_DISPOSABLE: '1',
        HAUS_NVR_TEST_URL: `http://127.0.0.1:${port(server)}`,
        HAUS_NVR_TEST_KEY_FILE: keyFile,
      }),
    );
    const report = await exerciseProtocol(target, { keepFixture });
    expect(report.nodeId).toBe('isolated-protocol-fixture');
    expect(report.fixtureRetained).toBe(keepFixture);
    expect((await recordings.get(report.recordingId)) !== null).toBe(keepFixture);
  }, 15000);
