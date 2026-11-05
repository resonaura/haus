/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { ResourceScope } from '@haus/core/lifecycle';
import { Addresses, IdentityRegistry } from '@haus/core/identity';
import { SessionOwnership } from '@haus/core/session';
import type { SessionOwner } from '@haus/core/session';
import type { Command } from '@haus/core/types';
import {
  EncryptedVault,
  openCatalog,
  openVault,
  OrmAddresses,
  OrmIdentities,
  OrmReceipts,
  OrmSessions,
  Transactions,
} from '../storage/index.js';
import { VaultLock } from '../storage/vault/entities.js';
import type { CredentialCodec } from '../storage/index.js';
import { PrivateFiles } from './files.js';
import { bindHost, type HostIdentity } from './identity.js';
import { loadKey } from './key.js';
import { Fingerprints } from './fingerprint.js';

export interface HostOptions extends HostIdentity {
  readonly directory: string;
}

/** Local composition with one fresh process incarnation. Restart does not silently adopt old grants. */
export class Host {
  readonly identities: IdentityRegistry;
  readonly addresses: Addresses;
  readonly sessions: OrmSessions;
  readonly ownership: SessionOwnership;
  readonly receipts: OrmReceipts;
  private readonly ownerValue: SessionOwner;
  private readonly fingerprints: Fingerprints;
  private closing?: Promise<void>;

  private constructor(
    readonly identity: HostIdentity,
    private readonly catalog: Transactions,
    private readonly vaultTransactions: Transactions,
    private readonly vaultSource: DataSource,
    private readonly key: Buffer,
    private readonly resources: ResourceScope,
    readonly files: PrivateFiles,
  ) {
    this.ownerValue = { hubId: identity.hubId, processId: randomUUID() };
    this.fingerprints = new Fingerprints(key, identity.homeId);
    this.identities = new IdentityRegistry(new OrmIdentities(catalog), randomUUID);
    this.addresses = new Addresses(new OrmAddresses(catalog));
    this.sessions = new OrmSessions(catalog);
    this.ownership = new SessionOwnership(this.sessions);
    this.receipts = new OrmReceipts(catalog);
  }

  static async open(options: HostOptions): Promise<Host> {
    const files = new PrivateFiles(join(options.directory, 'local'));
    await files.prepare();
    const identity = Object.freeze({ homeId: options.homeId, hubId: options.hubId });
    await bindHost(files, identity);
    const resources = new ResourceScope();
    try {
      const key = await loadKey(files);
      resources.defer(() => {
        key.fill(0);
      });
      const catalog = await openCatalog(join(options.directory, 'haus.sqlite'));
      resources.defer(async () => {
        if (catalog.isInitialized) await catalog.destroy();
      });
      const vault = await openVault(join(options.directory, 'local', 'vault.sqlite'));
      resources.defer(async () => {
        if (vault.isInitialized) await vault.destroy();
      });
      const host = new Host(
        identity,
        new Transactions(catalog),
        new Transactions(vault, { entity: VaultLock, version: 1 }),
        vault,
        key,
        resources,
        files,
      );
      let previousLease: { processId: string; pid: number } | undefined;
      const existing = await files.read('process');
      if (existing) {
        try {
          const parsed = JSON.parse(existing.toString('utf8'));
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.processId === 'string' &&
            typeof parsed.pid === 'number'
          ) {
            previousLease = { processId: parsed.processId, pid: parsed.pid };
          }
        } catch {
          // Ignored
        }
      }
      await files.publish(
        'process',
        Buffer.from(
          JSON.stringify({
            version: 1,
            hubId: identity.hubId,
            processId: host.owner.processId,
            pid: process.pid,
            startedAt: Date.now(),
            ...(previousLease ? { previous: previousLease } : {}),
          }),
        ),
      );
      return host;
    } catch (error) {
      try {
        await resources.close();
      } catch {
        throw Error('host_initialization_cleanup_failed');
      }
      throw error;
    }
  }

  get owner(): SessionOwner {
    return { ...this.ownerValue };
  }

  vault<Credential>(codec: CredentialCodec<Credential>): EncryptedVault<Credential> {
    if (this.closing) throw Error('host_closed');
    return new EncryptedVault(this.vaultSource, this.sessions, this.ownerValue, this.key, codec);
  }

  async fingerprint(intent: Omit<Command, 'id'>): Promise<string> {
    if (this.closing) throw Error('host_closed');
    return this.fingerprints.digest(intent);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    // Already-admitted catalog guards may still need the vault; drain in this order.
    this.closing = this.catalog
      .drain()
      .then(() => this.vaultTransactions.drain())
      .then(() => this.resources.close());
    return this.closing;
  }
}
