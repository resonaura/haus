/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SessionOwnership } from './ownership.js';
import type { CredentialVault, SessionGrant, SessionOwner } from './types.js';

/** Internal adapter boundary: secrets never form part of replicated state or client responses. */
export class OwnedCredentials<Credential> {
  constructor(
    private readonly owner: SessionOwner,
    private readonly ownership: SessionOwnership,
    private readonly vault: CredentialVault<Credential>,
  ) {}

  async use<Result>(
    grant: SessionGrant,
    operation: (credential: Credential) => Promise<Result>,
  ): Promise<Result> {
    this.assert(grant);
    let credential: Credential;
    try {
      credential = await this.vault.read(grant.resource);
    } catch {
      throw Error('integration_credentials_unavailable');
    }
    // A revocation may have happened while secure storage was being unlocked.
    this.assert(grant);
    const result = await operation(credential);
    this.assert(grant);
    return result;
  }

  private assert(grant: SessionGrant): void {
    if (this.owner.hubId !== grant.owner.hubId || this.owner.processId !== grant.owner.processId)
      throw Error('integration_credentials_wrong_owner');
    this.ownership.assert(grant, ['connecting', 'connected']);
  }
}
