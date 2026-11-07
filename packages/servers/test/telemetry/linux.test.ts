/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { snapshot } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { HostTelemetry, parseOsRelease, sanitizeHostReport } from '../../src/index.js';

import { sample, memoryDevice } from './support.js';
test('Linux host reports identify the installed distribution without evaluating os-release', async (t) => {
  assert.deepEqual(
    parseOsRelease('ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\nSHELL=$(touch /tmp/nope)'),
    { distribution: 'ubuntu', osName: 'Ubuntu 24.04.3 LTS' },
  );
  const clean = sanitizeHostReport({
    ...sample(),
    distribution: 'ubuntu',
    osName: 'Ubuntu 24.04.3 LTS',
    osReleaseSecret: 'must be dropped',
  });
  assert.equal(clean.distribution, 'ubuntu');
  assert.equal(clean.osName, 'Ubuntu 24.04.3 LTS');
  assert.ok(!JSON.stringify(clean).includes('must be dropped'));
  const system = {
    cpus: () => [{ model: 'CPU', times: { user: 1, idle: 9 } }],
    totalmem: () => 1024,
    freemem: () => 512,
    release: () => '6.8.0-generic',
    hostname: () => 'miku',
    arch: () => 'x64',
    uptime: () => 100,
    loadavg: () => [0, 0, 0],
  };
  const telemetry = await new HostTelemetry({
    platform: 'linux',
    system,
    container: false,
    nativeServices: false,
    read: async (file) => {
      if (file === '/etc/os-release') return 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\n';
      if (file === '/proc/meminfo')
        return 'MemTotal: 1 kB\nMemAvailable: 0.5 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n';
      if (file === '/sys/firmware/dmi/entries/17-0/raw') return memoryDevice(8192);
      if (file === '/sys/firmware/dmi/entries/17-1/raw') return memoryDevice(8192);
      if (file === '/proc/self/mounts') return '';
      throw new Error('unexpected read');
    },
    list: async (path) => (path === '/sys/firmware/dmi/entries' ? ['17-0', '17-1'] : []),
    run: async () => {
      throw new Error('no disk tool available');
    },
  }).initialize({ poll: false });
  t.onTestFinished(() => telemetry.stop());
  assert.equal(snapshot(telemetry.status()).distribution, 'ubuntu');
  assert.equal(snapshot(telemetry.status()).osName, 'Ubuntu 24.04.3 LTS');
  assert.equal(snapshot(telemetry.status()).memory.installedBytes, 16 * 1024 ** 3);
  assert.equal(snapshot(telemetry.status()).scope, 'host');
});
