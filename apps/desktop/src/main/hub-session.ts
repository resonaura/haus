/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { ClientSessionCredentials, ClientSessionView } from '@haus/core/auth';
import {
  isSessionExpired,
  sanitizeSessionForRenderer,
  validateSessionCredentials,
} from '@haus/core/auth';
import { orderClusterCandidateUrls, type PairingGrant } from '@haus/core/pairing';

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

interface AuthenticatedClusterPayload {
  readonly coordinatorUrl?: string;
  readonly endpoints?: readonly { readonly url?: string }[];
}

function extractClusterUrls(
  reachedUrl: string,
  existingUrls: readonly string[] | undefined,
  cluster: unknown,
): { readonly primaryUrl: string; readonly clusterUrls?: readonly string[] } {
  const cleanReached = reachedUrl.replace(/\/+$/, '');
  if (!cluster || typeof cluster !== 'object') {
    const merged = orderClusterCandidateUrls(cleanReached, existingUrls);
    return {
      primaryUrl: cleanReached,
      ...(merged.length > 1 ? { clusterUrls: merged } : {}),
    };
  }
  const typed = cluster as AuthenticatedClusterPayload;
  const endpointUrls = Array.isArray(typed.endpoints)
    ? typed.endpoints
        .map((ep) => (typeof ep?.url === 'string' ? ep.url.trim() : ''))
        .filter(Boolean)
    : [];
  const merged = orderClusterCandidateUrls(
    cleanReached,
    [...(existingUrls ?? []), ...endpointUrls],
    typeof typed.coordinatorUrl === 'string' ? typed.coordinatorUrl : undefined,
  );
  return {
    primaryUrl: cleanReached,
    ...(merged.length > 1 ? { clusterUrls: merged } : {}),
  };
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

  /** Updates known peer Hub URLs for the Home network and switches active coordinator when reachable. */
  async syncClusterEndpoints(
    memberUrls: readonly string[],
    preferredCoordinatorUrl?: string,
  ): Promise<void> {
    const current = this.credentials;
    if (!current) return;
    const ordered = orderClusterCandidateUrls(
      current.hubUrl,
      [...(current.clusterUrls ?? []), ...memberUrls],
      preferredCoordinatorUrl,
    );
    if (ordered.length === 0) return;
    const targetPrimary = ordered[0]!;
    let nextHubUrl = current.hubUrl;
    if (targetPrimary !== current.hubUrl && preferredCoordinatorUrl) {
      const reachable = await this.probeSessionOnPeer(current, targetPrimary);
      if (reachable) nextHubUrl = targetPrimary;
    }
    const nextClusterUrls = ordered.length > 1 ? ordered : undefined;
    const prevKey = JSON.stringify([current.hubUrl, current.clusterUrls ?? []]);
    const nextKey = JSON.stringify([nextHubUrl, nextClusterUrls ?? []]);
    if (prevKey === nextKey) return;
    const updated: ClientSessionCredentials = {
      ...current,
      hubUrl: nextHubUrl,
      ...(nextClusterUrls ? { clusterUrls: nextClusterUrls } : {}),
    };
    this.credentials = updated;
    await this.store.saveHubSession(updated).catch(() => undefined);
  }

  private async probeSessionOnPeer(
    creds: ClientSessionCredentials,
    candidateUrl: string,
  ): Promise<boolean> {
    try {
      const res = await this.fetch(`${candidateUrl.replace(/\/+$/, '')}/api/auth/resume`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.sessionToken}`,
        },
        body: JSON.stringify({ sessionId: creds.sessionId }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { status?: string; session?: ClientSessionView };
      return Boolean(
        data.status === 'active' &&
        data.session?.sessionId === creds.sessionId &&
        data.session.homeId === creds.homeId &&
        data.session.clientId === creds.clientId,
      );
    } catch {
      return false;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.catch(() => undefined).then(operation);
    this.operations = task;
    return task;
  }

  onboard(
    hubUrl: string,
    grant: PairingGrant,
    clusterUrls?: readonly string[],
  ): Promise<ClientSessionView> {
    return this.enqueue(async () => {
      try {
        return await this.onboardOnce(hubUrl, grant, clusterUrls);
      } catch (error) {
        this.setStatus('disconnected', 'onboarding_failed');
        throw error;
      }
    });
  }

  private async onboardOnce(
    hubUrl: string,
    grant: PairingGrant,
    hintClusterUrls?: readonly string[],
  ): Promise<ClientSessionView> {
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
      cluster?: unknown;
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

    const extracted = extractClusterUrls(cleanHubUrl, hintClusterUrls, payload.cluster);
    const credentials: ClientSessionCredentials = {
      ...received,
      hubUrl: extracted.primaryUrl,
      ...(extracted.clusterUrls ? { clusterUrls: extracted.clusterUrls } : {}),
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

    const candidateUrls = orderClusterCandidateUrls(creds.hubUrl, creds.clusterUrls);
    let lastStatusError: string | undefined;

    for (let idx = 0; idx < candidateUrls.length; idx++) {
      const targetUrl = candidateUrls[idx]!;
      try {
        const url = `${targetUrl}/api/auth/resume`;
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
          if (!(error instanceof TypeError) || idx > 0) throw error;
          // Resume only verifies an existing session, so retrying it cannot duplicate an action.
          res = await this.fetch(url, request);
        }

        if (res.ok) {
          const data = (await res.json()) as {
            status: string;
            session: ClientSessionView;
            cluster?: unknown;
          };
          const sameHubOrFailover =
            targetUrl === creds.hubUrl ? data.session?.hubId === creds.hubId : true;
          if (
            data.status === 'active' &&
            data.session?.sessionId === creds.sessionId &&
            sameHubOrFailover &&
            data.session.homeId === creds.homeId &&
            data.session.clientId === creds.clientId
          ) {
            const extracted = extractClusterUrls(targetUrl, creds.clusterUrls, data.cluster);
            let nextUrl = targetUrl;
            const preferredCoord =
              data.cluster &&
              typeof data.cluster === 'object' &&
              typeof (data.cluster as AuthenticatedClusterPayload).coordinatorUrl === 'string'
                ? (data.cluster as AuthenticatedClusterPayload).coordinatorUrl!.replace(/\/+$/, '')
                : undefined;
            if (
              preferredCoord &&
              preferredCoord !== targetUrl &&
              !preferredCoord.includes('://127.0.0.1') &&
              (await this.probeSessionOnPeer(creds, preferredCoord))
            ) {
              nextUrl = preferredCoord;
            }
            if (
              nextUrl !== creds.hubUrl ||
              JSON.stringify(extracted.clusterUrls ?? []) !==
                JSON.stringify(creds.clusterUrls ?? [])
            ) {
              const updated: ClientSessionCredentials = {
                ...creds,
                hubUrl: nextUrl,
                ...(extracted.clusterUrls ? { clusterUrls: extracted.clusterUrls } : {}),
              };
              this.credentials = updated;
              await this.store.saveHubSession(updated).catch(() => undefined);
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
            await this.store.clearHubSession();
            this.credentials = null;
          }
          this.setStatus('reauth-required', errorData.error ?? 'session_invalid');
          return null;
        }

        lastStatusError = `http_${res.status}`;
      } catch {
        // Try next Hub in the Home cluster before reporting offline.
      }
    }

    this.setStatus('disconnected', lastStatusError ?? 'hub_unreachable');
    return null;
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
    this.credentials = null;
    try {
      await this.store.clearHubSession();
    } finally {
      if (creds) await this.revokeSession(creds).catch(() => undefined);
      this.setStatus('disconnected');
    }
  }

  private async revokeSession(creds: ClientSessionCredentials): Promise<void> {
    const response = await this.fetch(`${creds.hubUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.sessionToken}`,
      },
    });
    if (!response.ok && response.status !== 401) {
      throw new Error(`Logout failed: HTTP ${response.status}`);
    }
  }

  private async reauth(creds: ClientSessionCredentials): Promise<ClientSessionView | null> {
    if (!creds.refreshToken) {
      this.setStatus('reauth-required', 'missing_refresh_token');
      return null;
    }
    const candidateUrls = orderClusterCandidateUrls(creds.hubUrl, creds.clusterUrls);
    let anyNetworkAttemptFailed = false;
    for (const targetUrl of candidateUrls) {
      try {
        const reachedHubUrl = targetUrl.replace(/\/+$/, '');
        const res = await this.fetch(`${reachedHubUrl}/api/auth/refresh`, {
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
          const renewed = validateSessionCredentials(data?.credentials);
          const sameHubOrFailover =
            reachedHubUrl === creds.hubUrl.replace(/\/+$/, '')
              ? renewed?.hubId === creds.hubId
              : true;
          if (
            data.status === 'renewed' &&
            renewed &&
            renewed.sessionId === creds.sessionId &&
            sameHubOrFailover &&
            renewed.homeId === creds.homeId &&
            renewed.clientId === creds.clientId
          ) {
            const nextCredentials: ClientSessionCredentials = {
              ...renewed,
              hubUrl: reachedHubUrl,
              ...(creds.clusterUrls ? { clusterUrls: creds.clusterUrls } : {}),
            };
            await this.store.saveHubSession(nextCredentials);
            this.credentials = nextCredentials;
            const view = sanitizeSessionForRenderer(nextCredentials, this.now());
            this.setStatus('connected', undefined, view);
            return view;
          }
        }

        if (res.status === 401) {
          this.setStatus('reauth-required', 'reauth_failed');
          return null;
        }
      } catch {
        anyNetworkAttemptFailed = true;
      }
    }

    this.setStatus(
      anyNetworkAttemptFailed ? 'disconnected' : 'reauth-required',
      anyNetworkAttemptFailed ? 'hub_unreachable' : 'reauth_failed',
    );
    return null;
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
      session: view,
      error,
    });
  }
}
