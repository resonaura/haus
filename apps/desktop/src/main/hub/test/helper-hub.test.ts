/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import { HausHelper } from '../../helper.js';
import { NativeConnection, type NativeConnectionPort } from '../router.js';
import type { HubConnection } from '../connection.js';
import type { HomeAssistantConnection } from '../../connection.js';

describe('HausHelper and Hub integration', () => {
  it('reports Hub as available without requesting supervisor add-ons', async () => {
    const supervisorRequest = vi.fn();
    const fakeHubConnection: NativeConnectionPort = {
      isHub: true,
      connected: true,
      serverUrl: 'http://192.168.5.115:8790',
      credentialScope: 'http://192.168.5.115:8790',
      request: supervisorRequest,
      addonSurface: vi.fn().mockResolvedValue({
        url: 'http://192.168.5.115:8790/',
        token: 'hub-bearer-123',
        title: 'Haus Hub',
      }),
      getBearerToken: vi.fn().mockReturnValue('hub-bearer-123'),
      getSession: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      cachedHome: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      cameraLastSnapshot: vi.fn(),
      cameraSnapshot: vi.fn(),
      management: vi.fn(),
      brandIcon: vi.fn(),
      getSceneConfig: vi.fn(),
    };

    const helper = new HausHelper(fakeHubConnection);
    const avail = await helper.availability();

    expect(avail).toEqual({
      installed: true,
      slug: 'haus-hub',
      state: 'started',
      hub: true,
    });
    expect(supervisorRequest).not.toHaveBeenCalled();
    helper.clear();
  });

  it('routes hub port 8790 to hub connection and never falls back to Home Assistant OAuth', async () => {
    const fakeHa = {
      connected: false,
      connect: vi.fn().mockRejectedValue(new Error('Should never reach HA')),
      dispose: vi.fn(),
    } as unknown as HomeAssistantConnection;

    const fakeHub = {
      probe: vi.fn().mockResolvedValue(true),
      connect: vi.fn().mockResolvedValue({
        url: 'http://192.168.5.115:8790',
        name: 'Haus Hub',
        kind: 'haus-hub',
      }),
      startPairing: vi.fn().mockResolvedValue({ firstOnboarding: true }),
      dispose: vi.fn(),
    } as unknown as HubConnection;

    const router = new NativeConnection(fakeHa, fakeHub);

    // 1. beginPairing returns false on firstOnboarding so the client auto-claims
    const needsCode = await router.beginPairing('http://192.168.5.115:8790');
    expect(needsCode).toBe(false);

    // 2. connect directly completes without throwing or calling HA
    const session = await router.connect('http://192.168.5.115:8790');
    expect(session.kind).toBe('haus-hub');
    expect(router.isHub).toBe(true);
    expect(fakeHa.connect).not.toHaveBeenCalled();

    // 3. Subsequent device onboarding: startPairing returns firstOnboarding: false
    fakeHub.startPairing = vi.fn().mockResolvedValue({ firstOnboarding: false });
    const subNeedsCode = await router.beginPairing('http://192.168.5.115:8790');
    expect(subNeedsCode).toBe(true);
  });
});
