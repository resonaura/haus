/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ClientSessionCredentials, ClientSessionView } from '@haus/core/auth';
import { isSessionExpired, sanitizeSessionForRenderer } from '@haus/core/auth';
import type { PairingGrant } from '@haus/core/pairing';
import type { MobilePersistence } from '../storage/mobile-persistence.js';

export type MobileHubSessionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reauth-required';

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

export class MobileHubSessionManager {
  private currentStatus: MobileHubSessionStatus = 'disconnected';
  private credentials: ClientSessionCredentials | null = null;
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

  getSession(): ClientSessionView | null {
    if (!this.credentials) return null;
    return sanitizeSessionForRenderer(this.credentials, this.now());
  }

  async onboard(hubUrl: string, grant: PairingGrant): Promise<ClientSessionView> {
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
    };

    if (!payload?.credentials || !payload?.session) {
      this.setStatus('disconnected', 'invalid_onboarding_response');
      throw new Error('Invalid onboarding payload from Hub.');
    }

    this.credentials = payload.credentials;
    await this.storage.saveHubSession(payload.credentials);
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

    try {
      const res = await this.fetch(`${creds.hubUrl}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: creds.sessionId }),
      });

      if (res.ok) {
        const data = (await res.json()) as { status: string; session: ClientSessionView };
        if (data.status === 'active' && data.session) {
          const view = sanitizeSessionForRenderer(data.session, this.now());
          this.setStatus('connected', undefined, view);
          return view;
        }
      }

      if (res.status === 401) {
        const errorData = (await res.json().catch(() => ({}))) as { error?: string };
        if (errorData.error === 'session_expired' && creds.refreshToken) {
          return this.reauth(creds);
        }
        if (errorData.error === 'session_revoked') {
          await this.storage.clearHubSession();
          this.credentials = null;
        }
        this.setStatus('reauth-required', errorData.error ?? 'session_invalid');
        return null;
      }

      this.setStatus('disconnected', `http_${res.status}`);
      return null;
    } catch {
      // Hub offline / network disconnected
      this.setStatus('disconnected', 'hub_unreachable');
      return null;
    }
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

    try {
      const res = await this.fetch(`${creds.hubUrl}/api/auth/refresh`, {
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
          this.credentials = data.credentials;
          await this.storage.saveHubSession(data.credentials);
          const view = sanitizeSessionForRenderer(data.credentials, this.now());
          this.setStatus('connected', undefined, view);
          return view;
        }
      }

      this.setStatus('reauth-required', 'reauth_failed');
      return null;
    } catch {
      this.setStatus('disconnected', 'hub_unreachable');
      return null;
    }
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
      session: status === 'connected' ? view : null,
      error,
    });
  }
}
