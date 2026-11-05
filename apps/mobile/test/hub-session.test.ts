/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it, vi } from 'vitest';
import { MobileHubSessionManager, type MobileHubSessionEvent } from '../src/auth/hub-session';
import type { ClientSessionCredentials } from '@haus/core/auth';
import type { PairingGrant } from '@haus/core/pairing';

describe('MobileHubSessionManager', () => {
  const hubUrl = 'http://192.168.1.100:8443';
  const secretMobileToken = 'secret-mobile-session-token-111';
  const secretMobileRefresh = 'secret-mobile-refresh-token-222';

  const testGrant: PairingGrant = {
    grantId: 'grant-mobile-1',
    hubId: 'hub-living-room',
    homeId: 'home-elm-9',
    clientId: 'client-iphone-16',
    clientRole: 'admin',
    clientName: "User's iPhone",
    issuedAt: 1_000_000,
    expiresAt: 2_000_000,
    revoked: false,
  };

  const initialCreds: ClientSessionCredentials = {
    hubUrl,
    sessionId: 'sess-mobile-1',
    sessionToken: secretMobileToken,
    refreshToken: secretMobileRefresh,
    hubId: 'hub-living-room',
    homeId: 'home-elm-9',
    clientId: 'client-iphone-16',
    clientName: "User's iPhone",
    clientRole: 'admin',
    expiresAt: 5_000_000,
  };

  function createFixture(initialStoredCreds: ClientSessionCredentials | null = null) {
    let savedCreds: ClientSessionCredentials | null = initialStoredCreds;
    const events: MobileHubSessionEvent[] = [];

    const storage = {
      loadHubSession: vi.fn(async () => savedCreds),
      saveHubSession: vi.fn(async (creds: ClientSessionCredentials) => {
        savedCreds = creds;
      }),
      clearHubSession: vi.fn(async () => {
        savedCreds = null;
      }),
    };

    return {
      storage,
      events,
      getSavedCreds: () => savedCreds,
    };
  }

  it('onboards with Hub, saves credentials in secure storage, and emits safe view', async () => {
    const fixture = createFixture();

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${hubUrl}/api/auth/pair`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: {
            sessionId: 'sess-mobile-1',
            hubId: 'hub-living-room',
            homeId: 'home-elm-9',
            clientId: 'client-iphone-16',
            clientRole: 'admin',
            clientName: "User's iPhone",
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
          credentials: initialCreds,
        }),
      } as Response;
    });

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_000_000,
    });

    const view = await manager.onboard(hubUrl, testGrant);
    expect(view.sessionId).toBe('sess-mobile-1');
    expect(view.state).toBe('active');
    expect(manager.status).toBe('connected');
    expect(fixture.getSavedCreds()).toEqual(initialCreds);

    // Verify token redaction in emitted events
    const serializedEvents = JSON.stringify(fixture.events);
    expect(serializedEvents).not.toContain(secretMobileToken);
    expect(serializedEvents).not.toContain(secretMobileRefresh);
  });

  it('resumes active session on app launch without prompting user', async () => {
    const fixture = createFixture(initialCreds);

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${hubUrl}/api/auth/resume`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'active',
          session: {
            sessionId: 'sess-mobile-1',
            hubId: 'hub-living-room',
            homeId: 'home-elm-9',
            clientId: 'client-iphone-16',
            clientRole: 'admin',
            clientName: "User's iPhone",
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
        }),
      } as Response;
    });

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_500_000,
    });

    const session = await manager.resume();
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('sess-mobile-1');
    expect(manager.status).toBe('connected');

    const lastEvent = fixture.events[fixture.events.length - 1];
    expect(lastEvent.status).toBe('connected');
    expect(lastEvent.session?.sessionId).toBe('sess-mobile-1');
    expect(JSON.stringify(fixture.events)).not.toContain(secretMobileToken);
  });

  it('handles remote revocation by Hub by clearing credentials and marking reauth-required', async () => {
    const fixture = createFixture(initialCreds);

    const mockFetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'session_revoked' }),
        }) as Response,
    );

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_500_000,
    });

    const session = await manager.resume();
    expect(session).toBeNull();
    expect(manager.status).toBe('reauth-required');
    expect(fixture.getSavedCreds()).toBeNull();
    expect(fixture.storage.clearHubSession).toHaveBeenCalled();

    const lastEvent = fixture.events[fixture.events.length - 1];
    expect(lastEvent.status).toBe('reauth-required');
    expect(lastEvent.error).toBe('session_revoked');
    expect(JSON.stringify(fixture.events)).not.toContain(secretMobileToken);
  });

  it('survives network partition and reconnects on recovery', async () => {
    const fixture = createFixture(initialCreds);
    let offline = true;

    const mockFetch = vi.fn(async () => {
      if (offline) throw new Error('Network request failed');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'active',
          session: {
            sessionId: 'sess-mobile-1',
            hubId: 'hub-living-room',
            homeId: 'home-elm-9',
            clientId: 'client-iphone-16',
            clientRole: 'admin',
            clientName: "User's iPhone",
            issuedAt: 1_000_000,
            expiresAt: 5_000_000,
            state: 'active',
          },
        }),
      } as Response;
    });

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_500_000,
    });

    // 1. Initial attempt fails while network is down
    const disconnectedResult = await manager.resume();
    expect(disconnectedResult).toBeNull();
    expect(manager.status).toBe('disconnected');
    expect(fixture.getSavedCreds()).not.toBeNull();

    // 2. Recovery
    offline = false;
    const reconnected = await manager.reconnect();
    expect(reconnected).toBe(true);
    expect(manager.status).toBe('connected');
  });

  it('rotates credentials on refresh when session expires', async () => {
    const expiredCreds: ClientSessionCredentials = {
      ...initialCreds,
      expiresAt: 1_000_000,
    };
    const fixture = createFixture(expiredCreds);

    const renewedToken = 'new-mobile-session-token-333';
    const renewedRefresh = 'new-mobile-refresh-token-444';

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

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_500_000,
    });

    const session = await manager.resume();
    expect(session).not.toBeNull();
    expect(session?.state).toBe('active');
    expect(manager.status).toBe('connected');
    expect(fixture.getSavedCreds()?.sessionToken).toBe(renewedToken);
    expect(fixture.getSavedCreds()?.refreshToken).toBe(renewedRefresh);

    const serializedEvents = JSON.stringify(fixture.events);
    expect(serializedEvents).not.toContain(renewedToken);
    expect(serializedEvents).not.toContain(renewedRefresh);
  });

  it('logs out and clears secure storage', async () => {
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
              sessionId: 'sess-mobile-1',
              hubId: 'hub-living-room',
              homeId: 'home-elm-9',
              clientId: 'client-iphone-16',
              clientRole: 'admin',
              clientName: "User's iPhone",
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

    const manager = new MobileHubSessionManager({
      storage: fixture.storage,
      emit: fixture.events.push.bind(fixture.events),
      fetchFn: mockFetch as any,
      now: () => 1_500_000,
    });

    await manager.resume();
    expect(manager.status).toBe('connected');

    await manager.logout();
    expect(fixture.getSavedCreds()).toBeNull();
    expect(manager.status).toBe('disconnected');
    expect(manager.getSession()).toBeNull();
  });
});
