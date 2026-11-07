/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { encodedScript, snapshot } from '../support/report.js';

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  HostTelemetry,
  sanitizeHostReport,
  linuxBattery,
  parseMacBattery,
  parseWindowsBattery,
  windowsBattery,
} from '../../src/index.js';

import { sample } from './support.js';
test('host battery telemetry is read-only and normalized on Linux and macOS', async () => {
  const linux = await linuxBattery({
    list: async () => [{ name: 'BAT0' }, { name: 'AC' }],
    read: async (file) => {
      if (file.endsWith('/capacity')) return '42\n';
      if (file.endsWith('/status')) return 'Charging\n';
      throw new Error('unsupported optional battery field');
    },
  });
  assert.deepEqual(linux, { level: 42, charging: true });
  assert.deepEqual(
    await linuxBattery({
      list: async () => ['BAT0', 'AC'],
      read: async (file) => {
        if (file.endsWith('BAT0/capacity')) return '100\n';
        if (file.endsWith('BAT0/status')) return 'Full\n';
        if (file.endsWith('AC/type')) return 'Mains\n';
        if (file.endsWith('AC/online')) return '1\n';
        throw new Error('unreported');
      },
    }),
    { level: 100, charging: false, powerConnected: true },
  );
  assert.deepEqual(
    parseMacBattery(
      "Now drawing from 'AC Power'\n-InternalBattery-0 (id=1) 84%; charging; 0:22 remaining",
    ),
    {
      level: 84,
      charging: true,
      powerConnected: true,
    },
  );
  assert.deepEqual(parseMacBattery('-InternalBattery-0 100%; charged; 0:00 remaining'), {
    level: 100,
    charging: false,
  });
});
test('Windows battery charging uses the native charging flag and WSL interop', async () => {
  assert.deepEqual(
    parseWindowsBattery({
      Battery: [{ EstimatedChargeRemaining: 64, BatteryStatus: 2 }],
      BatteryStatus: [
        {
          Active: true,
          Charging: true,
          Discharging: false,
          RemainingCapacity: 6400,
        },
      ],
    }),
    { level: 64, charging: true, powerConnected: true },
  );
  assert.deepEqual(
    parseWindowsBattery({
      Battery: [{ EstimatedChargeRemaining: 55, BatteryStatus: 2 }],
    }),
    { level: 55, charging: null, powerConnected: true },
  );
  assert.deepEqual(
    parseWindowsBattery({
      Battery: [{ EstimatedChargeRemaining: 50, BatteryStatus: 6 }],
      BatteryStatus: [{ Active: true, Charging: false, Discharging: true }],
    }),
    { level: 50, charging: false },
  );

  const full = parseWindowsBattery({
    Battery: [{ EstimatedChargeRemaining: 100, BatteryStatus: 2 }],
    BatteryStatus: [{ Active: true, Charging: false, Discharging: false, PowerOnline: true }],
  });
  assert.deepEqual(full, { level: 100, charging: false, powerConnected: true });
  assert.deepEqual(sanitizeHostReport({ ...sample(), battery: full }).battery, full);
  assert.deepEqual(
    parseWindowsBattery({
      Battery: [{ EstimatedChargeRemaining: 77, BatteryStatus: 1 }],
      BatteryStatus: [
        {
          Active: true,
          Charging: false,
          Discharging: true,
          PowerOnline: false,
        },
      ],
    }),
    { level: 77, charging: false, powerConnected: false },
  );

  let batteryQueries = 0;
  const run = async (file: string, args: string[]) => {
    assert.equal(file, '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
    const script = encodedScript(args);
    assert.match(script, /-Namespace root\\wmi -ClassName BatteryStatus/);
    assert.match(script, /Select-Object[^;]*Charging,Discharging/);
    batteryQueries++;
    return JSON.stringify({
      Battery: [{ EstimatedChargeRemaining: 64, BatteryStatus: 2 }],
      BatteryStatus: [{ Active: true, Charging: true, Discharging: false }],
    });
  };
  assert.deepEqual(await windowsBattery({ run, wsl: true }), {
    level: 64,
    charging: true,
    powerConnected: true,
  });
  assert.equal(batteryQueries, 1);
});
test('WSL host telemetry samples Windows battery state and throttles interop', async (t) => {
  let now = 1_000_000;
  let batteryQueries = 0;
  const system = {
    cpus: () => [{ model: 'CPU', times: { user: 1, idle: 9 } }],
    totalmem: () => 1024,
    freemem: () => 512,
    release: () => '5.15.167.4-microsoft-standard-WSL2',
    hostname: () => 'black-laptop',
    arch: () => 'x64',
    uptime: () => 100,
    loadavg: () => [0, 0, 0],
  };
  const telemetry = await new HostTelemetry({
    platform: 'linux',
    system,
    container: false,
    nativeServices: false,
    now: () => now,
    read: async (file) => {
      if (file === '/proc/meminfo')
        return 'MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n';
      if (file === '/etc/os-release') return 'ID=ubuntu\nPRETTY_NAME="Ubuntu"\n';
      if (file === '/proc/self/mounts') return '';
      throw new Error('unavailable');
    },
    list: async () => [],
    run: async (file, args = []) => {
      if (file === 'lsblk') throw new Error('unavailable');
      if (file === '/usr/bin/wslpath') throw new Error('unavailable');
      if (file.includes('powershell.exe') && args.includes('-EncodedCommand')) {
        const script = encodedScript(args);
        if (script.includes('-ClassName BatteryStatus')) {
          batteryQueries++;
          return JSON.stringify({
            Battery: [{ EstimatedChargeRemaining: 64, BatteryStatus: 2 }],
            BatteryStatus: [{ Active: true, Charging: true, Discharging: false }],
          });
        }
      }
      throw new Error('unsupported command');
    },
  }).initialize({ poll: false });
  t.onTestFinished(() => telemetry.stop());
  assert.deepEqual(snapshot(telemetry.status()).battery, {
    level: 64,
    charging: true,
    powerConnected: true,
  });
  assert.equal(snapshot(telemetry.status()).metricsScope, 'wsl');
  assert.equal(batteryQueries, 1);
  now += 5000;
  await telemetry.sample();
  assert.equal(batteryQueries, 1);
  now += 5000;
  await telemetry.sample();
  await telemetry.inventoryRefresh;
  assert.equal(batteryQueries, 2);
});
test('missing Linux battery capacity falls back to energy while absent readings stay unknown', async () => {
  const collect = (values: Record<string, string>) =>
    linuxBattery({
      list: async () => ['BAT0'],
      read: async (file) => {
        const field = file.split('/').at(-1);
        if (!field || !Object.hasOwn(values, field)) throw new Error('unsupported reading');
        return values[field];
      },
    });
  for (const capacity of [undefined, '', ' \n', 'not-a-number'])
    assert.deepEqual(
      await collect({
        ...(capacity === undefined ? {} : { capacity }),
        energy_now: '40000\n',
        energy_full: '80000\n',
        status: 'Discharging\n',
      }),
      { level: 50, charging: false },
    );
  assert.deepEqual(await collect({ energy_full: '80000', status: 'Charging' }), {
    level: null,
    charging: true,
  });
  assert.deepEqual(await collect({}), { level: null, charging: null });
  assert.deepEqual(await collect({ capacity: '0', energy_now: '40000', energy_full: '80000' }), {
    level: 0,
    charging: null,
  });
});
