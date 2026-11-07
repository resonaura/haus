/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostTelemetry } from '../../src/telemetry.js';
import { readHostFile } from '../../src/reading.js';
import { linuxInstalledMemory, deviceTreeInstalledMemory } from '../../src/memory.js';

test('the actual telemetry default preserves raw bytes and explicit text encodings', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-host-reading-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'input'),
    bytes = Buffer.from([17, 32, 0xff, 0x80, 0, 0x42]);
  await writeFile(file, bytes);
  const telemetry = new HostTelemetry(); // No initialize/sample: no host paths or tools are used.
  expect(await telemetry.read(file)).toEqual(bytes);
  expect(await telemetry.read(file, 'hex')).toBe(bytes.toString('hex'));
  expect(await readHostFile(file)).toEqual(bytes);
  expect(await readHostFile(file, 'utf8')).toBe(bytes.toString('utf8'));
  await expect(readHostFile(file, 'invalid-encoding')).rejects.toThrow(
    'invalid_host_file_encoding',
  );
});

test('DMI inventory receives buffers through the real default telemetry reader', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-dmi-reading-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'raw'),
    raw = Buffer.alloc(32);
  raw[0] = 17;
  raw[1] = 32;
  raw.writeUInt16LE(8192, 12);
  await writeFile(file, raw);
  const telemetry = new HostTelemetry();
  expect(
    await linuxInstalledMemory({
      list: async () => ['17-0', '17-1'],
      read: async (path, encoding) => {
        if (!/^\/sys\/firmware\/dmi\/entries\/17-[01]\/raw$/.test(path))
          throw Error('unexpected fixture path');
        return telemetry.read(file, encoding);
      },
    }),
  ).toBe(16 * 1024 ** 3);
});

test('device-tree cells remain binary through the actual default telemetry reader', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'haus-tree-reading-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const cells = Buffer.alloc(4);
  cells.writeUInt32BE(2);
  const bank = Buffer.alloc(16);
  bank.writeBigUInt64BE(4n * 1024n ** 3n, 8);
  await writeFile(join(root, '#address-cells'), cells);
  await writeFile(join(root, '#size-cells'), cells);
  await writeFile(join(root, 'bank'), bank);
  const telemetry = new HostTelemetry();
  expect(
    await deviceTreeInstalledMemory({
      root,
      list: async () => ['memory@0'],
      read: (path) => {
        if (path === root + '/memory@0/reg') return telemetry.read(join(root, 'bank'));
        if ([root + '/#address-cells', root + '/#size-cells'].includes(path))
          return telemetry.read(path);
        throw Error('unexpected fixture path');
      },
    }),
  ).toBe(4 * 1024 ** 3);
});
