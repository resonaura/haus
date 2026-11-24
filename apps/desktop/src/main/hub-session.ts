/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ClientSessionCredentials, ClientSessionView } from '@haus/core/auth';
import {
  isSessionExpired,
  sanitizeSessionForRenderer,
  validateSessionCredentials,
} from '@haus/core/auth';
import type { PairingGrant } from '@haus/core/pairing';

export type HubSessionStatus = 'disconnected' | 'connecting' | 'connected' | 'reauth-required';

export interface HubSessionEvent {
  readonly type: 'hub-session';
  readonly status: HubSessionStatus;
  readonly session: ClientSessionView | null;
  readonly error?: string;
}

export interface HubSessionManagerDependencies {
  readonly store: {
    assertAvailable(): void;
    loadHubSession(): Promise<ClientSessionCredentials | null>;
    saveHubSession(credentials: ClientSessionCredentials): Promise<void>;
    clearHubSession(): Promise<void>;
  };
  readonly emit: (event: HubSessionEvent) => void;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
}

export class HubCredentialSaveError extends Error {
  constructor(revoked: boolean) {
    super(
      revoked
        ? 'The Hub session could not be saved in the system credential store.'
        : 'The Hub session could not be saved or closed. Revoke it on the Hub before pairing again.',
    );
  }
}

export class DesktopHubSessionManager {
  private currentStatus: HubSessionStatus = 'disconnected';
  private credentials: ClientSessionCredentials | null = null;
  private readonly store: HubSessionManagerDependencies['store'];
  private readonly emit: (event: HubSessionEvent) => void;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private operations: Promise<unknown> = Promise.resolve();
  private resuming?: Promise<ClientSessionView | null>;

  constructor(dependencies: HubSessionManagerDependencies) {
    this.store = dependencies.store;
    this.emit = dependencies.emit;
    this.fetch = dependencies.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? (() => Date.now());
  }

  get status(): HubSessionStatus {
    return this.currentStatus;
  }

  /** Main-process only: the Hub origin and bearer for REST calls. Never crosses IPC. */
  bearer(): { url: string; token: string } | null {
    return this.credentials
      ? { url: this.credentials.hubUrl.replace(/\/+$/, ''), token: this.credentials.sessionToken }
      : null;
  }

  getSession(): ClientSessionView | null {
    if (!this.credentials) return null;
    return sanitizeSessionForRenderer(this.credentials, this.now());
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.catch(() => undefined).then(operation);
    this.operations = task;
    return task;
  }

  onboard(hubUrl: string, grant: PairingGrant): Promise<ClientSessionView> {
    return this.enqueue(async () => {
      try {
        return await this.onboardOnce(hubUrl, grant);
      } catch (error) {
        this.setStatus('disconnected', 'onboarding_failed');
        throw error;
      }
    });
  }

  private async onboardOnce(hubUrl: string, grant: PairingGrant): Promise<ClientSessionView> {
    this.store.assertAvailable();
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

    const received = validateSessionCredentials(payload?.credentials);
    if (
      !received ||
      !payload?.session ||
      received.hubId !== grant.hubId ||
      received.homeId !== grant.homeId ||
      received.clientId !== grant.clientId ||
      payload.session.sessionId !== received.sessionId
    ) {
      this.setStatus('disconnected', 'invalid_onboarding_response');
      throw new Error('Invalid onboarding payload from Hub.');
    }

    // The client reached the Hub at this address; an internal server default such
    // as 127.0.0.1 is not reachable from the desktop and must not replace it.
    const credentials: ClientSessionCredentials = {
      ...received,
      hubUrl: cleanHubUrl,
    };
    try {
      await this.store.saveHubSession(credentials);
    } catch {
      const revoked = await this.revokeSession(credentials).then(
        () => true,
        () => false,
      );
      throw new HubCredentialSaveError(revoked);
    }
    this.credentials = credentials;
    const view = sanitizeSessionForRenderer(payload.session, this.now());
    this.setStatus('connected', undefined, view);
    return view;
  }

  resume(): Promise<ClientSessionView | null> {
    this.resuming ??= this.enqueue(() => this.resumeOnce()).finally(() => {
      this.resuming = undefined;
    });
    return this.resuming;
  }

  private async resumeOnce(): Promise<ClientSessionView | null> {
    this.store.assertAvailable();
    let creds: ClientSessionCredentials | null = null;

    try {
      creds = await this.store.loadHubSession();
    } catch {
      this.credentials = null;
      this.setStatus('reauth-required', 'session_unreadable');
      return null;
    }

    if (!creds) {
      this.credentials = null;
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
      const url = `${creds.hubUrl}/api/auth/resume`;
      const request: RequestInit = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: creds.sessionId }),
      };
      let res: Response;
      try {
        res = await this.fetch(url, request);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        // Resume only verifies an existing session, so retrying it cannot duplicate an action.
        res = await this.fetch(url, request);
      }

      if (res.ok) {
        const data = (await res.json()) as { status: string; session: ClientSessionView };
        if (
          data.status === 'active' &&
          data.session?.sessionId === creds.sessionId &&
          data.session.hubId === creds.hubId &&
          data.session.homeId === creds.homeId &&
          data.session.clientId === creds.clientId
        ) {
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
          await this.store.clearHubSession();
          this.credentials = null;
        }
        this.setStatus('reauth-required', errorData.error ?? 'session_invalid');
        return null;
      }

      this.setStatus('disconnected', `http_${res.status}`);
      return null;
    } catch {
      // Network outage / Hub offline
      this.setStatus('disconnected', 'hub_unreachable');
      return null;
    }
  }

  async reconnect(): Promise<boolean> {
    if (!this.credentials) return false;
    const view = await this.resume();
    return view !== null;
  }

  logout(): Promise<void> {
    return this.enqueue(() => this.logoutOnce());
  }

  private async logoutOnce(): Promise<void> {
    const creds = this.credentials;
    if (creds) {
      try {
        await this.revokeSession(creds);
      } catch {
        // Best effort logout on Hub
      }
    }

    await this.store.clearHubSession();
    this.credentials = null;
    this.setStatus('disconnected');
  }

  private async revokeSession(creds: ClientSessionCredentials): Promise<void> {
    const response = await this.fetch(`${creds.hubUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.sessionToken}` },
    });
    if (!response.ok) throw new Error('The Hub could not close the session.');
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
          const received = validateSessionCredentials({
            ...data.credentials,
            hubUrl: creds.hubUrl,
          });
          if (
            !received ||
            received.sessionId !== creds.sessionId ||
            received.clientId !== creds.clientId ||
            received.hubId !== creds.hubId ||
            received.homeId !== creds.homeId
          ) {
            this.setStatus('reauth-required', 'invalid_refresh_response');
            return null;
          }
          const credentials = received;
          await this.store.saveHubSession(credentials);
          this.credentials = credentials;
          const view = sanitizeSessionForRenderer(credentials, this.now());
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
    status: HubSessionStatus,
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
