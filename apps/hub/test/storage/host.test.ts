/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Host } from '../../src/control/index.js';
import type { HostOptions } from '../../src/control/index.js';
import { PrivateFiles } from '../../src/control/files.js';
import { loadKey } from '../../src/control/key.js';
import { openVault } from '../../src/storage/index.js';
import { VaultEntity } from '../../src/storage/vault/entities.js';
import type { CommandEntry } from '@haus/core/command';
import type { IdentityRef } from '@haus/core/identity';
import type { IntegrationRef } from '@haus/core/session';

const hosts: Host[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function options(): Promise<HostOptions> {
  const directory = await mkdtemp(join(tmpdir(), 'haus-host-'));
  roots.push(directory);
  return { directory, homeId: 'house', hubId: 'hub' };
}
async function open(settings: HostOptions) {
  const host = await Host.open(settings);
  hosts.push(host);
  return host;
}
const codec = {
  encode: (credential: string) => new TextEncoder().encode(credential),
  decode: (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
};
const resource: IntegrationRef = { kind: 'integration', homeId: 'house', id: 'provider' };
const camera: IdentityRef = {
  kind: 'camera',
  homeId: 'house',
  source: { instanceId: 'provider', externalId: 'serial' },
};
const entry: CommandEntry = {
  scope: { homeId: 'house', actorId: 'user', idempotencyKey: 'intent' },
  fingerprint: 'fixture-keyed-digest',
  outcome: {
    schema: 'haus.receipt',
    version: 1,
    commandId: 'command',
    correlationId: 'command',
    ownerGeneration: 1,
    status: 'unknown',
    reason: 'dispatch-pending',
  },
};

it('composes persistent identities, aliases, pending credentials and receipts with a fresh process on reopen', async () => {
  const settings = await options(),
    first = await open(settings);
  const key = await readFile(join(settings.directory, 'local', 'key'));
  expect(key.length).toBe(32);
  expect((await stat(join(settings.directory, 'local'))).mode & 0o077).toBe(0);
  expect((await stat(join(settings.directory, 'local', 'key'))).mode & 0o077).toBe(0);
  await first.identities.adopt(camera, 'installed-camera-id');
  await first.addresses.assign('house', 'installed-camera-id', 'camera::outdoor:front');
  await first.addresses.rename('house', 'installed-camera-id', 'camera::garden:front');
  const grant = await first.ownership.acquire(resource, first.owner),
    vault = first.vault(codec);
  await vault.install(grant, 'private-fixture-token');
  await first.ownership.connected(grant);
  await vault.begin(grant, 'interrupted-refresh');
  await first.receipts.reserve(entry);
  await first.close();
  const next = await open(settings);
  expect(next.owner.hubId).toBe(first.owner.hubId);
  expect(next.owner.processId).not.toBe(first.owner.processId);
  expect(await readFile(join(settings.directory, 'local', 'key'))).toEqual(key);
  expect(await next.identities.resolve(camera)).toBe('installed-camera-id');
  expect(await next.addresses.resolve('house', 'camera::outdoor:front')).toBe(
    'installed-camera-id',
  );
  expect(await next.addresses.resolve('house', 'camera::garden:front')).toBe('installed-camera-id');
  expect((await next.receipts.reserve(entry)).entry.outcome).toEqual(entry.outcome);
  await expect(next.ownership.acquire(resource, next.owner)).rejects.toThrow(
    'integration_already_owned',
  );
  await expect(next.vault(codec).read(resource)).rejects.toThrow(
    'integration_credentials_wrong_owner',
  );
  const inspection = await openVault(join(settings.directory, 'local', 'vault.sqlite'));
  try {
    expect((await inspection.manager.findOneByOrFail(VaultEntity, { home: 'house' })).state).toBe(
      'pending',
    );
  } finally {
    await inspection.destroy();
  }
});

it.each(['homeId', 'hubId'] as const)(
  'rejects a changed %s without rewriting local identity or key',
  async (field) => {
    const settings = await options(),
      first = await open(settings);
    await first.close();
    const identity = await readFile(join(settings.directory, 'local', 'identity'));
    const key = await readFile(join(settings.directory, 'local', 'key'));
    await expect(Host.open({ ...settings, [field]: 'foreign' })).rejects.toThrow(
      'host_identity_mismatch',
    );
    expect(await readFile(join(settings.directory, 'local', 'identity'))).toEqual(identity);
    expect(await readFile(join(settings.directory, 'local', 'key'))).toEqual(key);
    await open(settings);
  },
);

it('never creates a replacement key beside an existing credential database', async () => {
  const settings = await options(),
    first = await open(settings);
  await first.close();
  const keyPath = join(settings.directory, 'local', 'key');
  await rm(keyPath);
  await expect(Host.open(settings)).rejects.toThrow('vault_key_missing');
  await expect(readFile(keyPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects missing/corrupt local identity rather than rebinding an existing vault', async () => {
  const settings = await options(),
    first = await open(settings);
  await first.close();
  const path = join(settings.directory, 'local', 'identity');
  await writeFile(path, '{broken');
  await expect(Host.open(settings)).rejects.toThrow('host_identity_invalid');
  await rm(path);
  await expect(Host.open(settings)).rejects.toThrow('host_identity_missing');
});

it('rejects malformed or accessible key files without overwriting them', async () => {
  const settings = await options(),
    first = await open(settings);
  await first.close();
  const path = join(settings.directory, 'local', 'key');
  await writeFile(path, 'invalid-key');
  await expect(Host.open(settings)).rejects.toThrow('vault_key_invalid');
  expect((await readFile(path)).toString()).toBe('invalid-key');
  await chmod(path, 0o644);
  await expect(Host.open(settings)).rejects.toThrow('private_file_unavailable');
});

it('rejects a linked or accessible private directory', async () => {
  const settings = await options(),
    first = await open(settings);
  await first.close();
  const directory = join(settings.directory, 'local');
  await chmod(directory, 0o755);
  await expect(Host.open(settings)).rejects.toThrow('private_storage_permissions');
  await chmod(directory, 0o700);
  await rm(directory, { recursive: true });
  const target = await mkdtemp(join(tmpdir(), 'haus-private-target-'));
  roots.push(target);
  await symlink(target, directory);
  await expect(Host.open(settings)).rejects.toThrow('private_storage_permissions');
});

it('publishes one complete key under concurrent provisioning without replacing it', async () => {
  const settings = await options(),
    files = new PrivateFiles(join(settings.directory, 'local'));
  await files.prepare();
  const keys = await Promise.all(Array.from({ length: 12 }, () => loadKey(files)));
  expect(keys.every((key) => key.equals(keys[0]) && key.length === 32)).toBe(true);
  expect(await loadKey(files)).toEqual(keys[0]);
});

it('stops repository admission on close and drains in-progress local vault guards before releasing SQLite', async () => {
  const settings = await options(),
    host = await open(settings);
  const grant = await host.ownership.acquire(resource, host.owner);
  await host.ownership.connected(grant);
  let finish = () => {};
  const operation = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = host.sessions.guard(grant, ['connected'], operation);
  await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
  const closing = host.close();
  expect(host.close()).toBe(closing);
  expect(() => host.vault(codec)).toThrow('host_closed');
  await expect(host.identities.resolve(camera)).rejects.toThrow('storage_closed');
  finish();
  await pending;
  await closing;
  await expect(host.sessions.read(resource)).rejects.toThrow('storage_closed');
  const next = await open(settings);
  expect(await next.sessions.read(resource)).toMatchObject({ generation: 1, state: 'connected' });
});

it('loads the compiled control export in separate Node processes without changing persistent identity', async () => {
  const settings = await options();
  const program = `
    import { Host } from '@haus/hub/control';
    const host = await Host.open({ directory: process.argv[1], homeId: 'house', hubId: 'hub' });
    try { process.stdout.write(await host.identities.resolve(${JSON.stringify(camera)})); }
    finally { await host.close(); }
  `;
  const run = promisify(execFile),
    config = { cwd: resolve('apps/hub'), timeout: 15_000, maxBuffer: 64 * 1024 };
  const first = await run(
    process.execPath,
    ['--input-type=module', '-e', program, settings.directory],
    config,
  );
  const second = await run(
    process.execPath,
    ['--input-type=module', '-e', program, settings.directory],
    config,
  );
  expect(first.stdout).toMatch(/^[a-f0-9-]{36}$/);
  expect(second.stdout).toBe(first.stdout);
});
