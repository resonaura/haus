/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdtemp, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { runtimeConfig } from '../../src/runtime/config.js';
import { nvrIdentity } from '../../src/runtime/identity.js';
import { environment } from './support.js';

it('validates configuration before creating files and rejects ambiguous roots and unsafe origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-config-'));
  try {
    const env = environment(root);
    for (const change of [
      { HAUS_DATA_DIR: join(root, 'other') },
      { HAUS_NODE_KEY: 'short' },
      { HAUS_SOURCE_ORIGIN: 'https://user:secret@localhost' },
      { HAUS_MAX_STREAMS: '0' },
      { PORT: 'NaN' },
      { HAUS_BIND_ADDRESS: 'example.com' },
    ])
      await expect(runtimeConfig({ ...env, ...change })).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    expect(await runtimeConfig(env)).toMatchObject({
      root,
      port: 0,
      address: '127.0.0.1',
      nvr: { roles: [] },
    });
    expect((await runtimeConfig({ HAUS_DATA_DIR: root })).nvr).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('publishes one durable identity under concurrent startup and preserves malformed existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'haus-runtime-identity-'));
  try {
    const values = await Promise.all(Array.from({ length: 10 }, () => nvrIdentity(root)));
    expect(new Set(values).size).toBe(1);
    expect(await nvrIdentity(root)).toBe(values[0]);
    expect((await stat(join(root, 'instance-id'))).mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(['instance-id']);
    await writeFile(join(root, 'instance-id'), 'broken-existing-identity');
    await expect(nvrIdentity(root)).rejects.toThrow('invalid_nvr_identity');
    expect(await readFile(join(root, 'instance-id'), 'utf8')).toBe('broken-existing-identity');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
