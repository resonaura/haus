/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { type Invocation, rows, record, encodedScript, snapshot } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  hostHardware,
  parseWindowsHardware,
  parseLinuxGpus,
  sanitizeHardware,
  HostTelemetry,
  sanitizeHostReport,
} from '../../src/index.js';

test('native Windows OS and every GPU remain distinct from WSL resources and unsafe 32-bit memory guesses', () => {
  const report = parseWindowsHardware(
    {
      OperatingSystem: {
        Caption: 'Microsoft Windows 11 Home',
        Version: '10.0.26100',
        BuildNumber: '26100',
        OSArchitecture: '64-bit',
        SerialNumber: 'private',
      },
      GPUs: [
        {
          Name: 'Integrated adapter',
          AdapterCompatibility: 'Vendor A',
          DriverVersion: '1',
          AdapterRAM: 512000000,
        },
        {
          Name: 'Discrete adapter',
          AdapterCompatibility: 'Vendor B',
          AdapterRAM: 4293918720,
        },
      ],
    },
    '2026-10-24T20:00:00.000Z',
  );
  assert.ok(report.operatingSystem);
  assert.equal(report.operatingSystem.name, 'Microsoft Windows 11 Home');
  assert.equal(report.operatingSystem.platform, 'win32');
  assert.equal(report.gpus.adapters.length, 2);
  assert.ok(report.gpus.adapters.every((g) => g.memoryBytes === null && g.kind === null));
  assert.ok(!JSON.stringify(report).includes('private'));
});
test('unsupported native queries stay unavailable instead of becoming zero adapters', () => {
  assert.equal(
    sanitizeHardware({
      operatingSystem: { name: 'Windows', source: 'windows-cim' },
    }).operatingSystem,
    undefined,
  );
  assert.equal(parseWindowsHardware({ GPUs: null }).gpus.available, false);
  assert.equal(parseWindowsHardware({ GPUs: [] }).gpus.available, true);
  assert.equal(
    sanitizeHardware({ operatingSystem: { name: 'fake', source: 'unknown' } }).operatingSystem,
    undefined,
  );
});
test('Linux inventories every actual display-class PCI function without guessing topology from names', () => {
  const report = parseLinuxGpus(
    'Slot:\t0000:01:00.0\nClass:\tVGA compatible controller [0300]\nVendor:\tAMD [1002]\nDevice:\tGraphics [1234]\n\nSlot:\t0000:02:00.0\nClass:\t3D controller [0302]\nVendor:\tNVIDIA [10de]\nDevice:\tGraphics [2345]\n\nSlot:\t0000:03:00.0\nClass:\tAudio device [0403]\nDevice:\tGPU Audio\n',
  );
  assert.equal(report.adapters.length, 2);
  assert.deepEqual(
    report.adapters.map((a) => a.kind),
    [null, null],
  );
});
test('Windows probing uses bounded fixed read-only selectors and does not request private identifiers or unreliable RAM', async () => {
  let command: Invocation | undefined;
  await hostHardware({
    platform: 'linux',
    wsl: true,
    run: async (file, args, options) => {
      command = { file, args, options: options ?? {} };
      return JSON.stringify({ GPUs: [] });
    },
  });
  assert.ok(command);
  assert.match(command.file, /WindowsPowerShell/);
  assert.equal(command.options.maxBuffer, 65536);
  const script = encodedScript(command.args);
  assert.match(script, /Caption,Version,BuildNumber,OSArchitecture/);
  assert.doesNotMatch(script, /SerialNumber|AdapterRAM|Set-|Remove-|Invoke-/);
});

test('hardware inventory is cached between live resource samples and refreshed independently', async () => {
  let clock = 1000,
    probes = 0;
  const system = {
    cpus: () => [{ model: 'CPU', times: { idle: 10, user: 10 } }],
    totalmem: () => 1000,
    freemem: () => 500,
    release: () => '6.8.0',
    arch: () => 'x64',
    uptime: () => 1,
    hostname: () => 'fixture',
    loadavg: () => [0, 0, 0],
  };
  const telemetry = await new HostTelemetry({
    platform: 'linux',
    container: false,
    nativeServices: true,
    system,
    now: () => clock,
    list: async () => [],
    read: async () => {
      throw Error('Unavailable');
    },
    run: async (file) => {
      if (file === 'lsblk') return JSON.stringify({ blockdevices: [] });
      if (file === 'lspci') {
        probes++;
        return 'Slot:\t0000:00:02.0\nClass:\tVGA controller [0300]\nDevice:\tActual Graphics [1234]\n';
      }
      throw Error('Unavailable');
    },
  }).initialize({ poll: false });
  assert.equal(probes, 1);
  clock += 5000;
  await telemetry.sample();
  assert.equal(probes, 1);
  assert.equal(
    rows(record(snapshot(telemetry.status()).gpus).adapters)[0].name,
    'Actual Graphics [1234]',
  );
  clock += 60000;
  await telemetry.sample();
  await telemetry.inventoryRefresh;
  assert.equal(probes, 2);
  telemetry.stop();
});

test('WSL reports physical Windows module capacity separately from its runtime memory limit', async () => {
  const runtimeBytes = 3 * 1024 ** 3;
  const installedBytes = 16 * 1024 ** 3;
  let moduleQueries = 0;
  let clock = 1000;
  const telemetry = await new HostTelemetry({
    platform: 'linux',
    container: false,
    nativeServices: true,
    now: () => clock,
    system: {
      cpus: () => [{ model: 'CPU', times: { idle: 10, user: 10 } }],
      totalmem: () => runtimeBytes,
      freemem: () => runtimeBytes / 2,
      release: () => '6.18-microsoft-standard-WSL2',
      arch: () => 'x64',
      uptime: () => 1,
      hostname: () => 'fixture',
      loadavg: () => [0, 0, 0],
    },
    list: async () => [],
    read: async () => {
      throw Error('Unavailable');
    },
    run: async (file, args) => {
      if (file === 'lsblk') return JSON.stringify({ blockdevices: [] });
      if (file.endsWith('powershell.exe')) {
        const script = encodedScript(args);
        if (script.includes('Win32_PhysicalMemory')) {
          assert.match(script, /Measure-Object -Property Capacity -Sum/);
          moduleQueries++;
          return JSON.stringify({ MemoryInstalled: installedBytes, GPUs: [] });
        }
      }
      throw Error('Unavailable');
    },
  }).initialize({ poll: false });
  const report = sanitizeHostReport(snapshot(telemetry.status()), clock);
  assert.equal(report.memory.installedBytes, installedBytes);
  assert.equal(report.memory.totalBytes, runtimeBytes);
  assert.equal(report.memory.usedBytes, runtimeBytes / 2);
  assert.equal(report.metricsScope, 'wsl');
  assert.equal(report.installedMemoryBytes, undefined);
  clock += 5000;
  await telemetry.sample();
  assert.equal(moduleQueries, 1);
  assert.equal(snapshot(telemetry.status()).memory.installedBytes, installedBytes);
  telemetry.stop();
});

test('unreported Windows module capacity is not guessed from available memory', () => {
  for (const MemoryInstalled of [null, undefined, 0, -1, '17179869184', NaN, Infinity])
    assert.equal(parseWindowsHardware({ MemoryInstalled }).installedMemoryBytes, undefined);
});
