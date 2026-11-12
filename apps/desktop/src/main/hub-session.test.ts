/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { DesktopHubSessionManager, type HubSessionEvent } from './hub-session';
import type { ClientSessionCredentials } from '@haus/core/auth';
import type { PairingGrant } from '@haus/core/pairing';

describe('DesktopHubSessionManager', () => {
  const hubUrl = 'http://127.0.0.1:8443';
  const secretSessionToken = 'secret-session-token-desktop-999';
  const secretRefreshToken = 'secret-refresh-token-desktop-888';

  const testGrant: PairingGrant = {
    grantId: 'grant-desktop-1',
    hubId: 'hub-desktop-1',
    homeId: 'home-oak-1',
    clientId: 'client-mac-app',
    clientRole: 'admin',
    clientName: 'My Mac',
    issuedAt: 1_000_000,
    expiresAt: 2_000_000,
    revoked: false,
  };

  const initialCreds: ClientSessionCredentials = {
    hubUrl,
    sessionId: 'sess-desktop-1',
    sessionToken: secretSessionToken,
    refreshToken: secretRefreshToken,
    hubId: 'hub-desktop-1',
    homeId: 'home-oak-1',
    clientId: 'client-mac-app',
    clientName: 'My Mac',
    clientRole: 'admin',
    expiresAt: 5_000_000,
  };

  function createFixture(initialStoreCreds: ClientSessionCredentials | null = null) {
    let savedCreds: ClientSessionCredentials | null = initialStoreCreds;
    const events: HubSessionEvent[] = [];

    const store = {
      assertAvailable: vi.fn(),
      loadHubSession: vi.fn(async () => savedCreds),
      saveHubSession: vi.fn(async (creds: ClientSessionCredentials) => {
        savedCreds = creds;
      }),
      clearHubSession: vi.fn(async () => {
        savedCreds = null;
      }),
    };

    return {
      store,
      events,
      getSavedCreds: () => savedCreds,
    };
  }

  it('onboards with Hub, stores credentials securely, and emits safe session view', async () => {
    const fixture = createFixture();

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${hubUrl}/api/auth/pair`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            sessionId: 'sess-desktop-1',
            hubId: 'hub-desktop-1',
            homeId: 'home-oak-1',
            clientId: 'client-mac-app',
            clientRole: 'admin',
            clientName: 'My Mac',
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
          credentials: initialCreds,
        }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_000_000,
    });

    const view = await manager.onboard(hubUrl, testGrant);
    expect(view.sessionId).toBe('sess-desktop-1');
    expect(view.state).toBe('active');
    expect(manager.status).toBe('connected');
    expect(fixture.getSavedCreds()).toEqual(initialCreds);

    // Verify token redaction in emitted events
    const serializedEvents = JSON.stringify(fixture.events);
    expect(serializedEvents).not.toContain(secretSessionToken);
    expect(serializedEvents).not.toContain(secretRefreshToken);
  });

  it('keeps the reached Hub address when its credentials contain an internal loopback URL', async () => {
    const fixture = createFixture();
    const externalHubUrl = 'http://192.168.5.117:8790';
    const mockFetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            session: {
              sessionId: 'sess-desktop-1',
              hubId: 'hub-desktop-1',
              homeId: 'home-oak-1',
              clientId: 'client-mac-app',
              clientRole: 'admin',
              clientName: 'My Mac',
              issuedAt: 1_000_000,
              expiresAt: 5_000_000,
              state: 'active',
            },
            credentials: { ...initialCreds, hubUrl: 'http://127.0.0.1:8124' },
          }),
        }) as Response,
    );
    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_000_000,
    });

    await manager.onboard(externalHubUrl, testGrant);

    expect(manager.bearer()).toMatchObject({ url: externalHubUrl });
    expect(fixture.getSavedCreds()).toMatchObject({ hubUrl: externalHubUrl });
  });

  it('resumes active session on app startup', async () => {
    const fixture = createFixture(initialCreds);

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${hubUrl}/api/auth/resume`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'active',
          session: {
            sessionId: 'sess-desktop-1',
            hubId: 'hub-desktop-1',
            homeId: 'home-oak-1',
            clientId: 'client-mac-app',
            clientRole: 'admin',
            clientName: 'My Mac',
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
        }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000,
    });

    const session = await manager.resume();
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('sess-desktop-1');
    expect(manager.status).toBe('connected');

    const lastEvent = fixture.events[fixture.events.length - 1];
    expect(lastEvent.status).toBe('connected');
    expect(lastEvent.session?.sessionId).toBe('sess-desktop-1');
    expect(JSON.stringify(fixture.events)).not.toContain(secretSessionToken);
  });

  it('retries a transient network failure while verifying a saved session', async () => {
    const fixture = createFixture(initialCreds);
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'active',
          session: {
            sessionId: 'sess-desktop-1',
            hubId: 'hub-desktop-1',
            homeId: 'home-oak-1',
            clientId: 'client-mac-app',
            clientRole: 'admin',
            clientName: 'My Mac',
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
        }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000,
    });

    await expect(manager.resume()).resolves.toMatchObject({ sessionId: 'sess-desktop-1' });
    expect(attempts).toBe(2);
    expect(manager.status).toBe('connected');
  });

  it('handles session revocation from Hub by clearing secure store and marking reauth-required', async () => {
    const fixture = createFixture(initialCreds);

    const mockFetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'session_revoked' }),
        }) as Response,
    );

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000,
    });

    const session = await manager.resume();
    expect(session).toBeNull();
    expect(manager.status).toBe('reauth-required');
    expect(fixture.getSavedCreds()).toBeNull(); // Store cleared!
    expect(fixture.store.clearHubSession).toHaveBeenCalled();

    const lastEvent = fixture.events[fixture.events.length - 1];
    expect(lastEvent.status).toBe('reauth-required');
    expect(lastEvent.error).toBe('session_revoked');
    expect(JSON.stringify(fixture.events)).not.toContain(secretSessionToken);
  });

  it('survives network disconnect and reconnects once connectivity is restored', async () => {
    const fixture = createFixture(initialCreds);
    let isOffline = true;

    const mockFetch = vi.fn(async () => {
      if (isOffline) {
        throw new Error('fetch failed: network offline');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'active',
          session: {
            sessionId: 'sess-desktop-1',
            hubId: 'hub-desktop-1',
            homeId: 'home-oak-1',
            clientId: 'client-mac-app',
            clientRole: 'admin',
            clientName: 'My Mac',
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
        }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000,
    });

    // 1. Initial attempt fails due to network outage
    const offlineResult = await manager.resume();
    expect(offlineResult).toBeNull();
    expect(manager.status).toBe('disconnected');
    expect(fixture.getSavedCreds()).not.toBeNull(); // Credentials preserved in store

    // 2. Connectivity restored
    isOffline = false;
    const reconnected = await manager.reconnect();
    expect(reconnected).toBe(true);
    expect(manager.status).toBe('connected');
    expect(manager.getSession()?.sessionId).toBe('sess-desktop-1');
  });

  it('automatically refreshes an expired session using the refresh token', async () => {
    const expiredCreds: ClientSessionCredentials = {
      ...initialCreds,
      expiresAt: 1_000_000,
    };
    const fixture = createFixture(expiredCreds);

    const renewedToken = 'new-session-token-777';
    const renewedRefresh = 'new-refresh-token-666';

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${hubUrl}/api/auth/refresh`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'renewed',
          credentials: {
            ...expiredCreds,
            sessionToken: renewedToken,
            refreshToken: renewedRefresh,
            expiresAt: 6_000_000,
          },
        }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000, // Now is past 1_000_000
    });

    const session = await manager.resume();
    expect(session).not.toBeNull();
    expect(session?.state).toBe('active');
    expect(manager.status).toBe('connected');
    expect(fixture.getSavedCreds()?.sessionToken).toBe(renewedToken);
    expect(fixture.getSavedCreds()?.refreshToken).toBe(renewedRefresh);

    // Verify token redaction
    const serializedEvents = JSON.stringify(fixture.events);
    expect(serializedEvents).not.toContain(renewedToken);
    expect(serializedEvents).not.toContain(renewedRefresh);
  });

  it('logs out and revokes credentials locally and remotely', async () => {
    const fixture = createFixture(initialCreds);

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/auth/resume')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'active',
            session: {
              sessionId: 'sess-desktop-1',
              hubId: 'hub-desktop-1',
              homeId: 'home-oak-1',
              clientId: 'client-mac-app',
              clientRole: 'admin',
              clientName: 'My Mac',
              issuedAt: 1_000_000,
              expiresAt: 5_000_000,
              state: 'active',
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'logged_out' }),
      } as Response;
    });

    const manager = new DesktopHubSessionManager({
      store: fixture.store,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as typeof fetch,
      now: () => 1_500_000,
    });

    // Populate credentials
    await manager.resume();
    expect(manager.status).toBe('connected');

    await manager.logout();
    expect(mockFetch).toHaveBeenCalled();
    expect(fixture.getSavedCreds()).toBeNull();
    expect(manager.status).toBe('disconnected');
    expect(manager.getSession()).toBeNull();

    const lastEvent = fixture.events[fixture.events.length - 1];
    expect(lastEvent.status).toBe('disconnected');
    expect(lastEvent.session).toBeNull();
  });
});
