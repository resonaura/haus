/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ClientSessionCredentials, ClientSessionView } from '@haus/core/auth';
import { isSessionExpired, sanitizeSessionForRenderer } from '@haus/core/auth';
import { orderClusterCandidateUrls, type PairingGrant } from '@haus/core/pairing';
import type { MobilePersistence } from '../storage/mobile-persistence.js';

export type MobileHubSessionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reauth-required';

export const MOBILE_HUB_PAIRING_REQUIRED = 'pairing_code_required';

export interface MobileHubSessionEvent {
  readonly type: 'hub-session';
  readonly status: MobileHubSessionStatus;
  readonly session: ClientSessionView | null;
  readonly error?: string;
}

export interface MobileHubSessionDependencies {
  readonly storage: Pick<
    MobilePersistence,
    'loadHubSession' | 'saveHubSession' | 'clearHubSession'
  >;
  readonly emit?: (event: MobileHubSessionEvent) => void;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

interface MobileClusterPayload {
  readonly homeName?: string;
  readonly coordinatorUrl?: string;
  readonly endpoints?: readonly { readonly url?: string }[];
}

function mergeMobileClusterUrls(
  reachedUrl: string,
  existing: readonly string[] | undefined,
  cluster: unknown,
): readonly string[] | undefined {
  const cleanReached = reachedUrl.replace(/\/+$/, '');
  const typed =
    cluster && typeof cluster === 'object' ? (cluster as MobileClusterPayload) : undefined;
  const endpointUrls = Array.isArray(typed?.endpoints)
    ? typed.endpoints
        .map((ep) => (typeof ep?.url === 'string' ? ep.url.trim() : ''))
        .filter(Boolean)
    : [];
  const merged = orderClusterCandidateUrls(
    cleanReached,
    [...(existing ?? []), ...endpointUrls],
    typeof typed?.coordinatorUrl === 'string' ? typed.coordinatorUrl : undefined,
  );
  return merged.length > 1 ? merged : undefined;
}

export class MobileHubSessionManager {
  private currentStatus: MobileHubSessionStatus = 'disconnected';
  private credentials: ClientSessionCredentials | null = null;
  private pendingChallenge?: {
    readonly url: string;
    readonly sessionId: string;
    readonly hubId: string;
    readonly homeId: string;
    readonly hubName?: string;
  };
  private readonly storage: MobileHubSessionDependencies['storage'];
  private readonly emit: (event: MobileHubSessionEvent) => void;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(dependencies: MobileHubSessionDependencies) {
    this.storage = dependencies.storage;
    this.emit = dependencies.emit ?? (() => {});
    this.fetch = dependencies.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? (() => Date.now());
  }

  get status(): MobileHubSessionStatus {
    return this.currentStatus;
  }

  bearer(): { url: string; token: string; clusterUrls?: readonly string[] } | null {
    return this.credentials
      ? {
          url: this.credentials.hubUrl.replace(/\/+$/, ''),
          token: this.credentials.sessionToken,
          ...(this.credentials.clusterUrls ? { clusterUrls: this.credentials.clusterUrls } : {}),
        }
      : null;
  }

  getSession(): ClientSessionView | null {
    if (!this.credentials) return null;
    return sanitizeSessionForRenderer(this.credentials, this.now());
  }

  cancelPairing(): void {
    this.pendingChallenge = undefined;
  }

  async pairWithHub(
    hubUrl: string,
    code?: string,
    hintClusterUrls?: readonly string[],
  ): Promise<{ session: ClientSessionView; hubName?: string }> {
    const base = hubUrl.trim().replace(/\/+$/, '');
    let effectiveCode = code?.replace(/[\s-]+/g, '').toUpperCase();
    if (!effectiveCode || !this.pendingChallenge || this.pendingChallenge.url !== base) {
      const idRes = await this.fetch(`${base}/api/auth/identity`);
      const idBody = (await idRes.json().catch(() => ({}))) as {
        hub?: { hubId?: string; homeId?: string; name?: string; homeName?: string };
      };
      const hub = idBody?.hub;
      if (!idRes.ok || !hub?.hubId || !hub?.homeId) {
        throw new Error('That address is not a Haus Hub.');
      }
      const chRes = await this.fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const offer = (await chRes.json().catch(() => ({}))) as {
        sessionId?: string;
        challengeCode?: string;
        firstOnboarding?: boolean;
      };
      if (!chRes.ok || !offer.sessionId) {
        throw new Error('The Hub could not start pairing.');
      }
      this.pendingChallenge = {
        url: base,
        sessionId: offer.sessionId,
        hubId: hub.hubId,
        homeId: hub.homeId,
        hubName: hub.homeName || hub.name,
      };
      if (!effectiveCode) {
        if (offer.firstOnboarding && offer.challengeCode) {
          effectiveCode = offer.challengeCode.replace(/[\s-]+/g, '').toUpperCase();
        } else {
          throw new Error(MOBILE_HUB_PAIRING_REQUIRED);
        }
      }
    }

    const pending = this.pendingChallenge!;
    this.pendingChallenge = undefined;
    const clientId = `mobile-${Math.random().toString(36).slice(2, 12)}`;
    const confRes = await this.fetch(`${base}/api/auth/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: pending.sessionId,
        challengeCode: effectiveCode,
        expectedHomeId: pending.homeId,
        client: { clientId, clientName: 'Haus Mobile', role: 'admin' },
      }),
    });
    const confBody = (await confRes.json().catch(() => ({}))) as {
      grant?: PairingGrant;
      error?: string;
    };
    if (!confRes.ok || !confBody.grant) {
      throw new Error(
        confBody.error === 'invalid_pairing_code'
          ? 'That pairing code is not correct. Start again.'
          : 'The pairing code was not accepted.',
      );
    }
    const session = await this.onboard(base, confBody.grant, hintClusterUrls);
    return { session, hubName: pending.hubName };
  }

  async onboard(
    hubUrl: string,
    grant: PairingGrant,
    hintClusterUrls?: readonly string[],
  ): Promise<ClientSessionView> {
    this.setStatus('connecting');

    const cleanHubUrl = hubUrl.replace(/\/+$/, '');
    const res = await this.fetch(`${cleanHubUrl}/api/auth/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant }),
    });

    if (!res.ok) {
      this.setStatus('disconnected', 'onboarding_failed');
      throw new Error(`Onboarding failed: HTTP ${res.status}`);
    }

    const payload = (await res.json()) as {
      session: ClientSessionView;
      credentials: ClientSessionCredentials;
      cluster?: unknown;
    };

    if (!payload?.credentials || !payload?.session) {
      this.setStatus('disconnected', 'invalid_onboarding_response');
      throw new Error('Invalid onboarding payload from Hub.');
    }

    const clusterUrls = mergeMobileClusterUrls(cleanHubUrl, hintClusterUrls, payload.cluster);
    const stored: ClientSessionCredentials = {
      ...payload.credentials,
      hubUrl:
        payload.credentials.hubUrl.includes('://127.0.0.1') && !cleanHubUrl.includes('://127.0.0.1')
          ? cleanHubUrl
          : payload.credentials.hubUrl,
      ...(clusterUrls ? { clusterUrls } : {}),
    };
    this.credentials = stored;
    await this.storage.saveHubSession(stored);
    const view = sanitizeSessionForRenderer(payload.session, this.now());
    this.setStatus('connected', undefined, view);
    return view;
  }

  async resume(): Promise<ClientSessionView | null> {
    let creds: ClientSessionCredentials | null = null;

    try {
      creds = await this.storage.loadHubSession();
    } catch {
      this.setStatus('reauth-required', 'session_unreadable');
      return null;
    }

    if (!creds) {
      this.setStatus('disconnected');
      return null;
    }

    this.credentials = creds;

    if (isSessionExpired(creds, this.now())) {
      if (creds.refreshToken) {
        return this.reauth(creds);
      }
      this.setStatus('reauth-required', 'session_expired');
      return null;
    }

    this.setStatus('connecting');

    const candidateUrls = orderClusterCandidateUrls(creds.hubUrl, creds.clusterUrls);
    let lastHttpError: string | undefined;

    for (const targetUrl of candidateUrls) {
      try {
        const res = await this.fetch(`${targetUrl}/api/auth/resume`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${creds.sessionToken}`,
          },
          body: JSON.stringify({ sessionId: creds.sessionId }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            session: ClientSessionView;
            cluster?: unknown;
          };
          if (data.status === 'active' && data.session) {
            const clusterUrls = mergeMobileClusterUrls(targetUrl, creds.clusterUrls, data.cluster);
            if (
              targetUrl !== creds.hubUrl ||
              JSON.stringify(clusterUrls ?? []) !== JSON.stringify(creds.clusterUrls ?? [])
            ) {
              const updated: ClientSessionCredentials = {
                ...creds,
                hubUrl: targetUrl,
                ...(clusterUrls ? { clusterUrls } : {}),
              };
              this.credentials = updated;
              await this.storage.saveHubSession(updated).catch(() => undefined);
            }
            const view = sanitizeSessionForRenderer(data.session, this.now());
            this.setStatus('connected', undefined, view);
            return view;
          }
        }

        if (res.status === 401) {
          const errorData = (await res.json().catch(() => ({}))) as { error?: string };
          if (errorData.error === 'session_expired' && creds.refreshToken) {
            return this.reauth({ ...creds, hubUrl: targetUrl });
          }
          if (errorData.error === 'session_revoked') {
            await this.storage.clearHubSession();
            this.credentials = null;
          }
          this.setStatus('reauth-required', errorData.error ?? 'session_invalid');
          return null;
        }

        lastHttpError = `http_${res.status}`;
      } catch {
        // Try next Hub in the Home cluster before reporting offline.
      }
    }

    this.setStatus('disconnected', lastHttpError ?? 'hub_unreachable');
    return null;
  }

  async reconnect(): Promise<boolean> {
    if (!this.credentials) return false;
    const view = await this.resume();
    return view !== null;
  }

  async logout(): Promise<void> {
    const creds = this.credentials;
    if (creds) {
      try {
        await this.fetch(`${creds.hubUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${creds.sessionToken}`,
          },
        });
      } catch {
        // Best effort
      }
    }

    await this.storage.clearHubSession().catch(() => {});
    this.credentials = null;
    this.setStatus('disconnected');
  }

  private async reauth(creds: ClientSessionCredentials): Promise<ClientSessionView | null> {
    if (!creds.refreshToken) {
      this.setStatus('reauth-required', 'missing_refresh_token');
      return null;
    }

    const candidateUrls = orderClusterCandidateUrls(creds.hubUrl, creds.clusterUrls);
    let anyNetworkFailure = false;

    for (const targetUrl of candidateUrls) {
      try {
        const res = await this.fetch(`${targetUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId: creds.sessionId,
            refreshToken: creds.refreshToken,
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            credentials: ClientSessionCredentials;
          };
          if (data.status === 'renewed' && data.credentials) {
            const nextCreds: ClientSessionCredentials = {
              ...data.credentials,
              hubUrl: targetUrl,
              ...(creds.clusterUrls ? { clusterUrls: creds.clusterUrls } : {}),
            };
            this.credentials = nextCreds;
            await this.storage.saveHubSession(nextCreds);
            const view = sanitizeSessionForRenderer(nextCreds, this.now());
            this.setStatus('connected', undefined, view);
            return view;
          }
        }

        if (res.status === 401) {
          this.setStatus('reauth-required', 'reauth_failed');
          return null;
        }
      } catch {
        anyNetworkFailure = true;
      }
    }

    this.setStatus(
      anyNetworkFailure ? 'disconnected' : 'reauth-required',
      anyNetworkFailure ? 'hub_unreachable' : 'reauth_failed',
    );
    return null;
  }

  private setStatus(
    status: MobileHubSessionStatus,
    error?: string,
    view: ClientSessionView | null = this.getSession(),
  ): void {
    this.currentStatus = status;
    this.emit({
      type: 'hub-session',
      status,
      session: view,
      error,
    });
  }
}
