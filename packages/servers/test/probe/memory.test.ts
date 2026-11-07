/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test, expect, type TestContext } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryProbe, readProbeFile } from '../../src/probe/memory.js';
import { linuxInstalledMemory } from '../../src/memory.js';

const bootId = '12345678-1234-1234-1234-123456789abc';
const now = new Date('2026-11-07T08:00:00.000Z');
const module = Buffer.alloc(64);
module[0] = 17;
module[1] = 32;
module.writeUInt16LE(8192, 12);
module.write('private-DIMM-serial', 32);
const io = {
  list: async () => ['17-0', '17-1', '../untrusted', '16-0'],
  read: async (path: string) => Buffer.from(path.endsWith('/boot_id') ? bootId : module),
  now: () => now,
};
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'haus-memory-probe-'));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'installed-memory.json');
  await writeFile(output, 'previous report');
  return { root, output };
}

test('exports only a fresh boot-bound capacity report accepted by the existing collector', async (context) => {
  const { root, output } = await fixture(context);
  await new MemoryProbe(io).write(output);
  const contents = await readFile(output, 'utf8');
  const value: unknown = JSON.parse(contents);
  expect(value).toEqual({
    version: 1,
    installedBytes: 16 * 1024 ** 3,
    bootId,
    sampledAt: now.toISOString(),
  });
  expect(contents).not.toContain('private-DIMM');
  expect((await stat(output)).mode & 0o777).toBe(0o644);
  expect(await readdir(root)).toEqual(['installed-memory.json']);
  expect(
    await linuxInstalledMemory({
      list: async () => [],
      hardwareFile: output,
      now: () => now.getTime(),
      read: async (path) => {
        if (path === output) return readFile(output, 'utf8');
        if (path.endsWith('/boot_id')) return bootId;
        throw Error('fixture unavailable');
      },
    }),
  ).toBe(16 * 1024 ** 3);
});

for (const failure of ['missing', 'partial', 'truncated', 'too-many', 'boot'])
  test(`keeps the previous report when firmware is ${failure}`, async (context) => {
    const { root, output } = await fixture(context);
    const probe = new MemoryProbe({
      ...io,
      list: async () =>
        failure === 'missing'
          ? []
          : failure === 'too-many'
            ? Array.from({ length: 129 }, (_, index) => '17-' + index.toString(16))
            : ['17-0', '17-1'],
      read: async (path) => {
        if (failure === 'partial' && path.includes('17-1')) throw Error('denied');
        if (failure === 'truncated') return Buffer.from([17, 32]);
        if (failure === 'boot' && path.endsWith('/boot_id')) return Buffer.from('invalid boot');
        return io.read(path);
      },
    });
    await expect(probe.write(output)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('previous report');
    expect(await readdir(root)).toEqual(['installed-memory.json']);
  });

test('bounds firmware reads and rejects symlinks without following them', async (context) => {
  const { root, output } = await fixture(context);
  await writeFile(output, Buffer.alloc(4096));
  expect((await readProbeFile(output, 4096)).length).toBe(4096);
  await writeFile(output, Buffer.alloc(4097));
  await expect(readProbeFile(output, 4096)).rejects.toThrow('hardware_probe_input_limit');
  const link = join(root, 'link');
  await symlink(output, link);
  await expect(readProbeFile(link, 4096)).rejects.toThrow();
});

test('rejects relative output before reading any host paths', async () => {
  let reads = 0;
  const probe = new MemoryProbe({
    ...io,
    list: async () => {
      reads++;
      return [];
    },
  });
  await expect(probe.write('relative.json')).rejects.toThrow('absolute_output_required');
  expect(reads).toBe(0);
});
