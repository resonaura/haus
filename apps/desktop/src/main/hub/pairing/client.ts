/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import type { DesktopHubSessionManager } from '../../hub-session.js';
import { loadHubIdentity, postHubJson } from '../transport.js';
import { isGrant, isRecord } from '../types.js';

export const HUB_PAIRING_REQUIRED = 'pairing_code_required';

export class HubPairingClient {
  private pending?: {
    url: string;
    sessionId: string;
    hubId: string;
    homeId: string;
    name?: string;
  };
  private generation = 0;

  constructor(
    private readonly manager: Pick<DesktopHubSessionManager, 'onboard'>,
    private readonly fetchFn: typeof fetch,
  ) {}

  async begin(
    url: string,
  ): Promise<{ firstOnboarding: boolean; challengeCode?: string; name?: string }> {
    this.cancel();
    const generation = this.generation;
    const base = url.replace(/\/+$/, '');
    const identity = await loadHubIdentity(this.fetchFn, base);
    if (generation !== this.generation) throw new Error('Pairing was superseded. Start again.');
    const offer = await postHubJson(this.fetchFn, `${base}/api/auth/challenge`, {});
    if (generation !== this.generation) throw new Error('Pairing was superseded. Start again.');
    if (!isRecord(offer) || typeof offer.sessionId !== 'string' || !offer.sessionId)
      throw new Error('The Hub could not start pairing.');

    this.pending = {
      url: base,
      sessionId: offer.sessionId,
      hubId: identity.hubId,
      homeId: identity.homeId,
      name: identity.hubName,
    };
    const firstOnboarding = offer.firstOnboarding === true;
    return {
      firstOnboarding,
      challengeCode:
        firstOnboarding && typeof offer.challengeCode === 'string'
          ? offer.challengeCode
          : undefined,
      name: identity.hubName,
    };
  }

  async connect(url: string, code?: string): Promise<string | undefined> {
    const base = url.replace(/\/+$/, '');
    let effectiveCode = code?.replace(/[\s-]+/g, '').toUpperCase();
    if (!effectiveCode) {
      const offer = await this.begin(base);
      effectiveCode = offer.challengeCode?.replace(/[\s-]+/g, '').toUpperCase();
      if (!effectiveCode) throw new Error(HUB_PAIRING_REQUIRED);
    }

    const pending = this.pending;
    if (!pending || pending.url !== base) throw new Error('Start pairing again.');
    this.pending = undefined;
    const generation = this.generation;
    const client = {
      clientId: `desktop-${randomUUID()}`,
      clientName: 'Haus Desktop',
      role: 'admin',
    };
    const confirmed = await postHubJson(this.fetchFn, `${base}/api/auth/confirm`, {
      sessionId: pending.sessionId,
      challengeCode: effectiveCode,
      expectedHomeId: pending.homeId,
      client,
    });
    if (generation !== this.generation) throw new Error('Pairing was superseded. Start again.');
    const grant = isRecord(confirmed) ? confirmed.grant : undefined;
    if (!isGrant(grant)) throw new Error('The pairing code was not accepted.');
    if (
      grant.hubId !== pending.hubId ||
      grant.homeId !== pending.homeId ||
      grant.clientId !== client.clientId
    )
      throw new Error('The Hub identity changed during pairing. Start again.');
    await this.manager.onboard(base, grant);
    return pending.name;
  }

  cancel(): void {
    this.pending = undefined;
    this.generation++;
  }
}
