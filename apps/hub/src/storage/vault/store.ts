/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { DataSource, EntityManager } from 'typeorm';
import { sessionKey } from '@haus/core/session';
import type {
  CredentialVault,
  IntegrationRef,
  RefreshStart,
  RefreshVault,
  SessionGrant,
  SessionOwner,
  SessionState,
} from '@haus/core/session';
import type { OrmSessions } from '../session.js';
import { Transactions } from '../transactions.js';
import { VaultEntity, VaultLock } from './entities.js';
import { VaultCipher } from './cipher.js';
import type { CredentialCodec, VaultMetadata, VaultRow, VaultState } from './types.js';

const active: readonly SessionState[] = ['connecting', 'connected'];
const selector = (resource: IntegrationRef) => ({
  home: resource.homeId,
  integration: resource.id,
});
const matches = (row: VaultRow, grant: SessionGrant) =>
  row.home === grant.resource.homeId &&
  row.integration === grant.resource.id &&
  row.hub === grant.owner.hubId &&
  row.process === grant.owner.processId &&
  row.generation === grant.generation;

/** Internal provider facility. An explicit sign-in may install; ordinary refresh cannot reset a pending attempt. */
export class EncryptedVault<Credential>
  implements CredentialVault<Credential>, RefreshVault<Credential>
{
  private readonly transactions: Transactions;
  private readonly cipher: VaultCipher<Credential>;
  private readonly owner: SessionOwner;

  constructor(
    source: DataSource,
    private readonly sessions: OrmSessions,
    owner: SessionOwner,
    key: Uint8Array,
    codec: CredentialCodec<Credential>,
  ) {
    this.transactions = new Transactions(source, { entity: VaultLock, version: 1 });
    if (sessions.shares(this.transactions)) throw Error('vault_requires_separate_database');
    if (!source.hasMetadata(VaultEntity) || !source.hasMetadata(VaultLock))
      throw Error('invalid_vault_source');
    this.owner = { ...owner };
    this.cipher = new VaultCipher(key, codec);
  }

  install(grant: SessionGrant, credential: Credential): Promise<void> {
    return this.guarded(grant, ['connecting', 'reauth-required'], async (manager, grant) => {
      const metadata = this.metadata(grant, 'ready', null);
      await manager.upsert(
        VaultEntity,
        { ...metadata, ...this.cipher.seal(metadata, credential) },
        ['home', 'integration'],
      );
    });
  }

  async read(resource: IntegrationRef): Promise<Credential> {
    const current = await this.sessions.read(resource);
    if (!current) throw Error('integration_credentials_unavailable');
    return this.guarded(current, active, async (manager, grant) => {
      const row = await manager.findOneBy(VaultEntity, selector(grant.resource));
      if (!row || !matches(row, grant) || row.state !== 'ready')
        throw Error('integration_credentials_unavailable');
      return this.cipher.open(row);
    });
  }

  begin(grant: SessionGrant, attemptId: string): Promise<RefreshStart<Credential>> {
    if (typeof attemptId !== 'string' || !attemptId.trim() || attemptId.length > 4096)
      return Promise.reject(Error('invalid_refresh_attempt'));
    return this.guarded(grant, active, async (manager, grant) => {
      const row = await manager.findOneBy(VaultEntity, selector(grant.resource));
      if (!row || !matches(row, grant)) return { status: 'reauth-required' };
      const credential = this.cipher.open(row);
      if (row.state === 'pending') return { status: 'busy' };
      if (row.state === 'blocked') return { status: 'reauth-required' };
      if (row.state !== 'ready') throw Error('invalid_vault_state');
      await this.write(manager, grant, 'pending', attemptId, credential);
      return { status: 'ready', credential };
    });
  }

  complete(grant: SessionGrant, attemptId: string, credential: Credential): Promise<boolean> {
    return this.guarded(grant, active, async (manager, grant) => {
      const row = await this.pending(manager, grant, attemptId);
      if (!row) return false;
      this.cipher.open(row);
      await this.write(manager, grant, 'ready', null, credential);
      return true;
    });
  }

  block(grant: SessionGrant, attemptId: string): Promise<boolean> {
    return this.guarded(
      grant,
      [...active, 'reauth-required', 'revoking'],
      async (manager, grant) => {
        const row = await this.pending(manager, grant, attemptId);
        if (!row) return false;
        await this.write(manager, grant, 'blocked', attemptId, this.cipher.open(row));
        return true;
      },
    );
  }

  private guarded<T>(
    grant: SessionGrant,
    allowed: readonly SessionState[],
    operation: (manager: EntityManager, grant: SessionGrant) => Promise<T>,
  ): Promise<T> {
    grant = structuredClone(grant);
    sessionKey(grant.resource);
    if (grant.owner.hubId !== this.owner.hubId || grant.owner.processId !== this.owner.processId)
      return Promise.reject(Error('integration_credentials_wrong_owner'));
    return this.sessions.guard(grant, allowed, () =>
      this.transactions.run((manager) => operation(manager, grant)),
    );
  }

  private async pending(
    manager: EntityManager,
    grant: SessionGrant,
    attempt: string,
  ): Promise<VaultRow | undefined> {
    const row = await manager.findOneBy(VaultEntity, selector(grant.resource));
    return row && matches(row, grant) && row.state === 'pending' && row.attempt === attempt
      ? row
      : undefined;
  }

  private metadata(grant: SessionGrant, state: VaultState, attempt: string | null): VaultMetadata {
    return {
      ...selector(grant.resource),
      hub: grant.owner.hubId,
      process: grant.owner.processId,
      generation: grant.generation,
      state,
      attempt,
    };
  }

  private async write(
    manager: EntityManager,
    grant: SessionGrant,
    state: VaultState,
    attempt: string | null,
    credential: Credential,
  ): Promise<void> {
    const metadata = this.metadata(grant, state, attempt);
    await manager.update(VaultEntity, selector(grant.resource), {
      ...metadata,
      ...this.cipher.seal(metadata, credential),
    });
  }
}
