/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { freePort, hubEntrypoint } from './process.js';
import { record } from '../nvr/support/values.js';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sign } from '../../src/nvr/auth.js';

test(
  'the actual server process starts in monitoring mode without a media producer',
  { timeout: 25000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'haus-monitor-process-'));
    const port = await freePort();
    const key = 'monitoring-process-fixture-key-32-characters';
    const child = spawn(process.execPath, [hubEntrypoint], {
      env: {
        ...process.env,
        HAUS_DATA: root,
        HAUS_DATA_DIR: root,
        HAUS_NODE_ID: 'monitoring-fixture',
        HAUS_NODE_KEY: key,
        HAUS_NODE_KEY_FILE: '',
        HAUS_ROLES: '',
        HAUS_BIND_ADDRESS: '127.0.0.1',
        HAUS_MDNS_ADVERTISE: 'false',
        HAUS_SOURCE_ORIGIN: '',
        HAUS_HOST_TELEMETRY_FILE: '',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const recordOutput = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    child.stdout.on('data', recordOutput);
    child.stderr.on('data', recordOutput);
    child.once('error', (error) => recordOutput(Buffer.from(error.message)));
    const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      child.once('close', (code, signal) => resolve([code, signal])),
    );
    t.onTestFinished(async () => {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try {
        const [code, signal] = await exited;
        assert.equal(code, 0, 'Hub must finish graceful shutdown: ' + output);
        assert.equal(signal, null);
      } finally {
        clearTimeout(timer);
        await rm(root, { recursive: true, force: true });
      }
    });
    let status: Record<string, unknown> | undefined, lastError: unknown;
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v1/status`, {
          headers: { ...sign(key, 'GET', '/v1/status') },
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          status = record(await response.json());
          break;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    assert.ok(status, 'Monitoring process did not become ready: ' + output + String(lastError));
    assert.equal(status.nodeId, 'monitoring-fixture');
    assert.deepEqual(status.roles, []);
    assert.equal(record(status.streams).max, 0);
    assert.equal(record(status.media).max, 0);
    assert.equal(record(status.host).scope, 'host');
    const sampledAt = record(status.host).sampledAt;
    assert.ok(typeof sampledAt === 'string' && Number.isFinite(Date.parse(sampledAt)));
    assert.equal(status.rtspSessions, undefined);
    assert.equal(status.playback, undefined);
    assert.equal(status.detectors, undefined);
    const files = await readdir(root);
    assert.ok(
      !files.some((name) =>
        ['camera-runtime', 'camera-sessions', 'playback', 'streams'].includes(name),
      ),
    );
  },
);
