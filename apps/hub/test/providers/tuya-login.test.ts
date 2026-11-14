/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { discoverProviderBridges } from '../../src/providers/discovery.js';
import { createLocalAppBridgeHints } from '../../src/providers/local-hints.js';
import { connectDiscoveredProvider } from '../../src/providers/managed.js';
import {
  getTuyaBridgeLoginState,
  pollTuyaBridgeQrLogin,
  startTuyaBridgeQrLogin,
} from '../../src/providers/tuya-login.js';

const BRIDGE_ID = '11111111-1111-4111-8111-111111111111';

describe('Standalone Tuya bridge hints, discovery & login proxy', () => {
  it('builds app hints for running tuya-rtsp-bridge preferring non-docker interface', async () => {
    const hintsFn = createLocalAppBridgeHints(
      {
        listApps: vi.fn(async () => ({
          apps: [
            {
              id: 'tuya-rtsp-bridge',
              name: 'Tuya Camera Bridge',
              source: {
                externalId: 'tuya-rtsp-bridge',
                driverId: 'standalone-local',
                instanceId: 'standalone-local',
              },
              state: 'running' as const,
              version: '2.2.12',
              available: true,
              managed: true,
              actions: ['stop' as const, 'restart' as const],
            },
          ],
          drivers: [],
          partial: false,
          errors: [],
        })),
      },
      () => ({
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8',
          },
        ],
        docker0: [
          {
            address: '172.17.0.1',
            netmask: '255.255.0.0',
            family: 'IPv4',
            mac: '02:42:00:00:00:01',
            internal: false,
            cidr: '172.17.0.1/16',
          },
        ],
        eth0: [
          {
            address: '172.23.68.150',
            netmask: '255.255.240.0',
            family: 'IPv4',
            mac: '00:15:5d:00:00:01',
            internal: false,
            cidr: '172.23.68.150/20',
          },
        ],
      }),
    );

    const hints = await hintsFn();
    expect(hints).toEqual([
      {
        url: 'http://172.23.68.150:6766',
        provider: 'tuya',
        source: 'app',
        addonSlug: 'tuya-rtsp-bridge',
        managed: true,
      },
      {
        url: 'http://172.17.0.1:6766',
        provider: 'tuya',
        source: 'app',
        addonSlug: 'tuya-rtsp-bridge',
        managed: true,
      },
    ]);
  });

  it('discovers and connects app-hinted tuya bridge over loopback pairing', async () => {
    const config = {
      standalone: true,
      localBridgeHints: async () => [
        {
          url: 'http://172.23.68.150:6766',
          provider: 'tuya',
          source: 'app' as const,
          addonSlug: 'tuya-rtsp-bridge',
          managed: true,
        },
      ],
    };

    const discover = () =>
      discoverProviderBridges(config, {
        scan: () => () => {},
        duration: 10,
        endpoint: async (url) => ({ url }),
        request: async () => ({
          version: 2,
          bridgeId: BRIDGE_ID,
          provider: 'tuya',
          name: 'Tuya Camera Bridge',
        }),
      });

    const bridges = await discover();
    expect(bridges).toHaveLength(1);
    expect(bridges[0]?.source).toBe('app');
    expect(bridges[0]?.managed).toBe(true);

    const added: Array<{ url: string; code: string; allowHttp: boolean }> = [];
    const enrolled = await connectDiscoveredProvider(
      config,
      {
        add: async (input) => {
          added.push(input);
          return { id: BRIDGE_ID, provider: 'tuya' };
        },
      },
      BRIDGE_ID,
      {
        discover,
        isLocalAddress: (addr) => addr === '172.23.68.150',
        local: async (_port, path) => {
          if (path === '/api/haus/v2/info') {
            return { version: 2, bridgeId: BRIDGE_ID, provider: 'tuya' };
          }
          return { code: 'a'.repeat(48) };
        },
      },
    );

    expect(enrolled).toEqual({ id: BRIDGE_ID, provider: 'tuya' });
    expect(added).toEqual([
      { url: 'http://172.23.68.150:6766', code: 'a'.repeat(48), allowHttp: true },
    ]);
  });

  it('proxies Tuya login state, QR start, and QR poll -> refreshes bridge & Hub inventory', async () => {
    const refreshMock = vi.fn(async () => ({
      bridgeId: BRIDGE_ID,
      provider: 'tuya',
      revision: 'rev-1',
      cameras: [],
    }));
    const providers = {
      connections: () => [
        {
          id: BRIDGE_ID,
          connection: {
            version: 2 as const,
            provider: 'tuya',
            bridgeId: BRIDGE_ID,
            endpoint: { url: 'http://192.168.5.115:6766', allowHttp: true },
            clientId: 'haus-client',
            token: 'secret-token',
          },
        },
      ],
      refresh: refreshMock,
    };

    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}${new URL(url).search}`);
      if (url.endsWith('/api/auth/state')) {
        return new Response(
          JSON.stringify({
            loggedIn: false,
            region: 'eu',
            regions: [{ id: 'eu', name: 'Western Europe' }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/auth/qr/start')) {
        return new Response(
          JSON.stringify({
            token: 'qr-tok-123',
            qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            qrPayload: 'tuyaSmart--qrLogin?token=qr-tok-123',
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/auth/qr/poll?token=qr-tok-123')) {
        return new Response(JSON.stringify({ loggedIn: true }), { status: 200 });
      }
      if (url.endsWith('/api/cameras/refresh')) {
        return new Response(JSON.stringify({ success: true, cameras: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const state = await getTuyaBridgeLoginState(
      providers,
      BRIDGE_ID,
      fetchMock as unknown as typeof fetch,
    );
    expect(state).toEqual({
      loggedIn: false,
      region: 'eu',
      regions: [{ id: 'eu', name: 'Western Europe' }],
    });

    const qr = await startTuyaBridgeQrLogin(
      providers,
      BRIDGE_ID,
      'eu',
      fetchMock as unknown as typeof fetch,
    );
    expect(qr).toEqual({
      token: 'qr-tok-123',
      qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      qrPayload: 'tuyaSmart--qrLogin?token=qr-tok-123',
    });

    const poll = await pollTuyaBridgeQrLogin(
      providers,
      BRIDGE_ID,
      'qr-tok-123',
      fetchMock as unknown as typeof fetch,
    );
    expect(poll).toEqual({ loggedIn: true });
    expect(calls).toContain('POST /api/cameras/refresh');
    expect(refreshMock).toHaveBeenCalledWith(BRIDGE_ID);
  });

  it('rejects invalid region, invalid token, and non-tuya providers', async () => {
    const providers = {
      connections: () => [
        {
          id: BRIDGE_ID,
          connection: {
            version: 2 as const,
            provider: 'aqara',
            bridgeId: BRIDGE_ID,
            endpoint: { url: 'http://192.168.5.115:8795', allowHttp: true },
            clientId: 'haus-client',
            token: 'secret-token',
          },
        },
      ],
      refresh: vi.fn(),
    };

    await expect(getTuyaBridgeLoginState(providers, BRIDGE_ID)).rejects.toThrow(
      'provider_login_unsupported',
    );
    await expect(startTuyaBridgeQrLogin(providers, BRIDGE_ID, 'mars')).rejects.toThrow(
      'invalid_tuya_region',
    );
    await expect(pollTuyaBridgeQrLogin(providers, BRIDGE_ID, 'bad token\n')).rejects.toThrow(
      'invalid_qr_token',
    );
  });
});
