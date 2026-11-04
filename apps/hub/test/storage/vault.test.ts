/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { SessionOwnership, TokenRefresh } from '@haus/core/session';
import type { IntegrationRef, RefreshProvider, RefreshResult } from '@haus/core/session';
import {
  EncryptedVault,
  openCatalog,
  openVault,
  OrmSessions,
  Transactions,
} from '../../src/storage/index.js';
import type { CredentialCodec } from '../../src/storage/index.js';
import { VaultEntity, VaultLock } from '../../src/storage/vault/entities.js';

const sources: DataSource[] = [],
  roots: string[] = [];
afterEach(async () => {
  for (const source of sources.splice(0)) if (source.isInitialized) await source.destroy();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const resource: IntegrationRef = { homeId: 'house', kind: 'integration', id: 'camera-provider' };
const owner = { hubId: 'hub', processId: 'boot-one' };
const original = 'private-original-rotating-token-fixture';
const replacement = 'private-replacement-rotating-token-fixture';
const codec: CredentialCodec<string> = {
  encode: (credential) => new TextEncoder().encode(credential),
  decode: (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
};

async function open(root: string, key: Buffer) {
  const catalog = await openCatalog(join(root, 'catalog.sqlite'));
  sources.push(catalog);
  const secret = await openVault(join(root, 'vault.sqlite'));
  sources.push(secret);
  const sessions = new OrmSessions(new Transactions(catalog)),
    ownership = new SessionOwnership(sessions);
  return {
    catalog,
    secret,
    sessions,
    ownership,
    vault: new EncryptedVault(secret, sessions, owner, key, codec),
  };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'haus-vault-'));
  roots.push(root);
  const key = randomBytes(32),
    test = await open(root, key);
  const grant = await test.ownership.acquire(resource, owner);
  await test.vault.install(grant, original);
  await test.ownership.connected(grant);
  return { ...test, root, key, grant };
}

it('keeps all credentials encrypted in SQLite, WAL and the separate catalog across restart', async () => {
  const test = await setup();
  expect(await test.vault.read(resource)).toBe(original);
  const initial = await test.secret.manager.findOneByOrFail(VaultEntity, { home: 'house' });
  expect((await test.vault.begin(test.grant, 'attempt-one')).status).toBe('ready');
  await expect(test.vault.read(resource)).rejects.toThrow('integration_credentials_unavailable');
  expect(await test.vault.complete(test.grant, 'attempt-one', replacement)).toBe(true);
  const current = await test.secret.manager.findOneByOrFail(VaultEntity, { home: 'house' });
  expect(current.iv.equals(initial.iv)).toBe(false);
  expect(current.ciphertext.equals(initial.ciphertext)).toBe(false);
  for (const name of await readdir(test.root)) {
    const bytes = await readFile(join(test.root, name));
    expect(bytes.includes(Buffer.from(original))).toBe(false);
    expect(bytes.includes(Buffer.from(replacement))).toBe(false);
    expect(bytes.includes(test.key)).toBe(false);
  }
  await test.secret.destroy();
  await test.catalog.destroy();
  const reopened = await open(test.root, test.key);
  expect(await reopened.vault.read(resource)).toBe(replacement);
  expect(await reopened.catalog.createQueryRunner().hasTable('haus-vault-credentials')).toBe(false);
});

it('retains an interrupted reservation after reopen and never calls the refresh provider again', async () => {
  const test = await setup();
  await test.vault.begin(test.grant, 'interrupted');
  await test.secret.destroy();
  await test.catalog.destroy();
  const reopened = await open(test.root, test.key),
    refresh = vi.fn<RefreshProvider<string>['refresh']>(async () => ({
      status: 'renewed',
      credential: replacement,
    }));
  const service = new TokenRefresh(
    reopened.ownership,
    reopened.vault,
    { refresh },
    () => 'new-attempt',
  );
  await expect(service.refresh(test.grant)).rejects.toMatchObject({ code: 'refresh_busy' });
  await expect(reopened.vault.read(resource)).rejects.toThrow(
    'integration_credentials_unavailable',
  );
  const foreign = new EncryptedVault(
    reopened.secret,
    reopened.sessions,
    { ...owner, processId: 'new-boot' },
    test.key,
    codec,
  );
  await expect(foreign.read(resource)).rejects.toThrow('integration_credentials_wrong_owner');
  expect(refresh).not.toHaveBeenCalled();
});

it('reserves only one refresh across simultaneous DataSources', async () => {
  const test = await setup(),
    other = await open(test.root, test.key);
  const starts = await Promise.all(
    Array.from({ length: 12 }, (_value, index) =>
      (index % 2 ? test : other).vault.begin(test.grant, `attempt-${index}`),
    ),
  );
  expect(starts.filter((start) => start.status === 'ready')).toHaveLength(1);
  expect(starts.filter((start) => start.status === 'busy')).toHaveLength(11);
  expect(await test.secret.manager.count(VaultEntity)).toBe(1);
});

it('fences an active refresh, rejects late completion and requires a new sign-in for a new owner', async () => {
  const test = await setup();
  let finish = (_value: RefreshResult<string>) => {};
  const refresh = vi.fn<RefreshProvider<string>['refresh']>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const service = new TokenRefresh(test.ownership, test.vault, { refresh }, () => 'in-flight');
  const pending = service.refresh(test.grant),
    rejected = expect(pending).rejects.toMatchObject({ code: 'refresh_owner_changed' });
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await test.ownership.revoke(test.grant, () => service.fence(test.grant));
  await rejected;
  const nextOwner = { ...owner, processId: 'new-boot' },
    grant = await test.ownership.acquire(resource, nextOwner);
  const next = new EncryptedVault(test.secret, test.sessions, nextOwner, test.key, codec);
  await expect(next.read(resource)).rejects.toThrow('integration_credentials_unavailable');
  await expect(test.vault.complete(test.grant, 'in-flight', 'late-secret')).rejects.toThrow(
    'integration_owner_unavailable',
  );
  await next.install(grant, replacement);
  await test.ownership.connected(grant);
  finish({ status: 'renewed', credential: 'late-secret' });
  expect(await next.read(resource)).toBe(replacement);
});

it('blocks uncertain tokens until explicit reauthorization and cannot overwrite a fresh sign-in', async () => {
  const test = await setup();
  await test.vault.begin(test.grant, 'old-attempt');
  expect(await test.vault.block(test.grant, 'old-attempt')).toBe(true);
  expect(await test.vault.complete(test.grant, 'old-attempt', 'late-secret')).toBe(false);
  expect(await test.vault.begin(test.grant, 'retry')).toEqual({ status: 'reauth-required' });
  await test.ownership.requireReauthorization(test.grant);
  await test.vault.install(test.grant, replacement);
  await test.ownership.reconnect(test.grant);
  await test.ownership.connected(test.grant);
  expect(await test.vault.complete(test.grant, 'old-attempt', 'late-secret')).toBe(false);
  expect(await test.vault.read(resource)).toBe(replacement);
});

it.each(['state', 'attempt'] as const)(
  'authenticates %s metadata rather than trusting an edited refresh marker',
  async (field) => {
    const test = await setup();
    await test.vault.begin(test.grant, 'original-attempt');
    await test.secret.manager.update(
      VaultEntity,
      { home: 'house' },
      field === 'state' ? { state: 'ready' } : { attempt: 'forged-attempt' },
    );
    if (field === 'state')
      await expect(test.vault.read(resource)).rejects.toThrow('vault_credentials_unavailable');
    else
      await expect(test.vault.complete(test.grant, 'forged-attempt', replacement)).rejects.toThrow(
        'vault_credentials_unavailable',
      );
  },
);

it('rejects ciphertext copied from another integration without revealing provider secrets', async () => {
  const test = await setup(),
    other = { ...resource, id: 'other-provider' };
  const grant = await test.ownership.acquire(other, owner);
  await test.vault.install(grant, 'another-private-token');
  const row = await test.secret.manager.findOneByOrFail(VaultEntity, { integration: other.id });
  await test.secret.manager.update(
    VaultEntity,
    { integration: resource.id },
    { iv: row.iv, ciphertext: row.ciphertext, tag: row.tag },
  );
  const failure = await test.vault.read(resource).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject({ message: 'vault_credentials_unavailable' });
  expect(failure).not.toHaveProperty('cause');
});

it('retains the pending attempt if encrypting a replacement fails', async () => {
  const test = await setup();
  const broken = new EncryptedVault(test.secret, test.sessions, owner, test.key, {
    ...codec,
    encode: (credential: string) => {
      if (credential === replacement) throw Error('private-codec-details');
      return codec.encode(credential);
    },
  });
  await broken.begin(test.grant, 'attempt');
  await expect(broken.complete(test.grant, 'attempt', replacement)).rejects.toThrow(
    'vault_credentials_unavailable',
  );
  expect((await test.secret.manager.findOneByOrFail(VaultEntity, { home: 'house' })).state).toBe(
    'pending',
  );
  expect(await test.vault.begin(test.grant, 'retry')).toEqual({ status: 'busy' });
  expect(await test.vault.block(test.grant, 'attempt')).toBe(true);
});

it('rejects the wrong local key and incompatible schema without resetting credentials', async () => {
  const test = await setup();
  const wrong = new EncryptedVault(test.secret, test.sessions, owner, randomBytes(32), codec);
  await expect(wrong.read(resource)).rejects.toThrow('vault_credentials_unavailable');
  expect(await test.vault.read(resource)).toBe(original);
  await test.secret.manager.update(VaultLock, { id: 1 }, { version: 999 });
  await test.secret.destroy();
  await expect(openVault(join(test.root, 'vault.sqlite'))).rejects.toThrow(
    'unsupported_vault_storage_version',
  );
});

it('refuses to put secrets and the replicable catalog in the same SQLite file', async () => {
  const test = await setup();
  await expect(openVault(join(test.root, 'catalog.sqlite'))).rejects.toThrow(
    'vault_requires_separate_database',
  );
  await expect(openCatalog(join(test.root, 'vault.sqlite'))).rejects.toThrow(
    'catalog_requires_separate_database',
  );
  expect(await test.vault.read(resource)).toBe(original);
});
