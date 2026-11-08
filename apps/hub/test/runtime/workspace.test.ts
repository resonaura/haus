/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { sign } from '../../src/nvr/auth.js';
import { record } from '../nvr/support/values.js';
import { freePort, hubEntrypoint } from './process.js';
test('production reports its actual separate working filesystem through authenticated status', async (t) => {
  const shm = await stat('/dev/shm').catch(() => null);
  if (!shm?.isDirectory()) return t.skip('Linux tmpfs unavailable');
  const archive = await mkdtemp(join(tmpdir(), 'haus-main-archive-'));
  const root = await mkdtemp('/dev/shm/haus-main-workspace-');
  let child: ChildProcess | undefined;
  t.onTestFinished(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const current = child;
      const closed = once(current, 'close');
      current.kill('SIGTERM');
      const timer = setTimeout(() => current.kill('SIGKILL'), 5000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    }
    await rm(root, { recursive: true, force: true });
    await rm(archive, { recursive: true, force: true });
  });
  if ((await stat(root)).dev === (await stat(archive)).dev)
    return t.skip('Separate filesystems required');
  await symlink(archive, join(root, 'blobs'), 'dir');
  const port = await freePort();
  const key = 'workspace-status-fixture-key-not-production-32';
  child = spawn(process.execPath, [hubEntrypoint], {
    env: {
      ...process.env,
      HAUS_DATA: root,
      HAUS_DATA_DIR: root,
      HAUS_NODE_KEY: key,
      HAUS_NODE_KEY_FILE: '',
      HAUS_ROLES: 'storage',
      HAUS_BIND_ADDRESS: '127.0.0.1',
      HAUS_MDNS_ADVERTISE: 'false',
      HAUS_SOURCE_ORIGIN: '',
      HAUS_HOST_TELEMETRY_FILE: '',
      PORT: String(port),
    },
    stdio: 'ignore',
  });
  let status: Record<string, unknown> | undefined, lastError: unknown;
  const deadline = Date.now() + 75000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw Error('Fixture server exited before status');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/status`, {
        headers: { ...sign(key, 'GET', '/v1/status') },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        status = record(await response.json());
        break;
      }
    } catch (error) {
      lastError = error;
    }
    await pause(100);
  }
  assert.ok(status, 'Production status must become ready: ' + String(lastError));
  assert.equal(record(record(status.storage).workspace).separateFilesystem, true);
  assert.equal(record(record(status.storage).workspace).state, 'fresh');
  const freeBytes = record(record(status.storage).workspace).freeBytes;
  assert.ok(typeof freeBytes === 'number' && freeBytes >= 0);
  assert.equal(record(status.storage).storageLimitBytes, null);
}, 90000);
