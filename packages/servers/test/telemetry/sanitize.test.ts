/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { rows, record } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { sanitizeHostReport } from '../../src/index.js';

import { sample } from './support.js';
test('host reports whitelist fields, reject stale/future reports and bound lists', () => {
  const input = sample();
  input.password = 'secret';
  input.memory.installedBytes = 1024;
  input.battery = { level: 87.5, charging: true, token: 'secret' };
  input.docker = {
    available: true,
    socket: 'secret',
    containers: Array.from({ length: 300 }, (_, id) => ({
      id: String(id),
      name: 'media',
      image: 'image:tag',
      state: 'running',
      status: 'Up',
      cpuPercent: 20,
      memoryUsedBytes: 1,
      memoryLimitBytes: 2,
      environment: { TOKEN: 'secret' },
      command: 'secret',
    })),
  };
  input.pm2 = {
    available: true,
    processes: [
      {
        id: 1,
        name: 'app',
        pid: 42,
        status: 'online',
        cpuPercent: 0,
        memoryBytes: 200,
        uptimeSeconds: 3,
        restarts: 0,
        env: { KEY: 'secret' },
        args: 'secret',
      },
    ],
  };
  const clean = sanitizeHostReport(input);
  assert.equal(rows(record(clean.docker).containers).length, 256);
  assert.equal(clean.docker.source, 'host-collector');
  assert.deepEqual(clean.battery, { level: 87.5, charging: true });
  assert.equal(clean.memory.installedBytes, 1024);
  assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.throws(() =>
    sanitizeHostReport({
      ...sample(),
      sampledAt: new Date(Date.now() - 31000).toISOString(),
    }),
  );
  assert.throws(() =>
    sanitizeHostReport({
      ...sample(),
      sampledAt: new Date(Date.now() + 6000).toISOString(),
    }),
  );
});
