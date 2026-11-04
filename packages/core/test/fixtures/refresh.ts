/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SessionGrant, RefreshStart, RefreshVault } from '../../src/session/types.js';
import type { SessionOwnership } from '../../src/session/ownership.js';

/** Durable-state fixture: a recreated refresher sees the same pending/blocked marker. */
export class RefreshDatabase implements RefreshVault<string> {
  credential = 'original-private-token';
  state: 'ready' | 'pending' | 'blocked' = 'ready';
  private attempt?: string;
  private grant?: string;
  constructor(private readonly ownership: SessionOwnership) {}

  async begin(grant: SessionGrant, attempt: string): Promise<RefreshStart<string>> {
    this.ownership.assert(grant, ['connecting', 'connected']);
    if (this.state === 'blocked') return { status: 'reauth-required' };
    if (this.state === 'pending') return { status: 'busy' };
    this.state = 'pending';
    this.attempt = attempt;
    this.grant = JSON.stringify(grant);
    return { status: 'ready', credential: this.credential };
  }

  async complete(grant: SessionGrant, attempt: string, credential: string): Promise<boolean> {
    this.ownership.assert(grant, ['connecting', 'connected']);
    if (!this.matches(grant, attempt)) return false;
    this.credential = credential;
    this.state = 'ready';
    this.attempt = undefined;
    return true;
  }

  async block(grant: SessionGrant, attempt: string): Promise<boolean> {
    if (!this.matches(grant, attempt)) return false;
    this.state = 'blocked';
    return true;
  }

  private matches(grant: SessionGrant, attempt: string): boolean {
    return (
      this.state === 'pending' && this.attempt === attempt && this.grant === JSON.stringify(grant)
    );
  }
}
