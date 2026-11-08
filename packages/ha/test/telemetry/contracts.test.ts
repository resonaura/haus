/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, test, vi } from 'vitest';
import {
  HostTelemetry,
  parseHostCpuModel,
  parseHostProc,
  type HostProcParsed,
} from '@haus/ha/node/host-telemetry';
import * as shared from '@haus/servers/os';

test('keeps the public HA parser bindings identical to their neutral OS owner', () => {
  expect(parseHostCpuModel).toBe(shared.parseHostCpuModel);
  expect(parseHostProc).toBe(shared.parseHostProc);
  const sample: HostProcParsed = parseHostProc('', '', '');
  expect(sample.uptimeSeconds).toBeNull();
});

test.each([undefined, null, 17, {}, Buffer.from('processor : fixture')])(
  'keeps unknown CPU model inputs unavailable (%j)',
  (input) => {
    expect(parseHostCpuModel(input)).toBeNull();
  },
);

test('uses Supervisor boot time when the injected proc uptime is missing', async (t) => {
  const files = new Map([
    ['/proc/stat', 'cpu 100 0 0 100 0 0 0 0\ncpu0 100 0 0 100 0 0 0 0\n'],
    ['/proc/meminfo', 'MemTotal: 100 kB\nMemAvailable: 50 kB\n'],
    ['/proc/uptime', ''],
  ]);
  const stop = vi.fn();
  const telemetry = new HostTelemetry(
    { standalone: false, token: 'isolated-token', media: '/fixture-media' },
    {
      fetcher: async (input) => {
        const url = new URL(input instanceof Request ? input.url : input);
        return Response.json({
          result: 'ok',
          data: url.pathname === '/host/info' ? { boot_timestamp: 5000000 } : {},
        });
      },
      read: async (path) => files.get(path) ?? null,
      list: async () => [],
      filesystem: async () => null,
      serviceCounters: { collect: async () => null, snapshot: () => null, stop },
    },
  );
  t.onTestFinished(() => telemetry.stop());
  const sample = await telemetry.collect(10000);
  expect(sample.uptimeSeconds).toBe(5);
  expect(sample.cpu.logicalCores).toBe(1);
  expect(sample.memory.totalBytes).toBe(102400);
});
