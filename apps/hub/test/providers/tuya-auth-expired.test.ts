/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { NativeProviders, type NativeProviderCatalogPort } from '../../src/providers/native.js';

function createCatalog(connection: Record<string, unknown>): { native: NativeProviderCatalogPort } {
  const providers = [{ id: String(connection.bridgeId), connection: JSON.stringify(connection) }];
  return {
    native: {
      controllerId: 'ctrl-1',
      providers: () => providers,
      addProvider: async () => undefined,
      removeProvider: async () => undefined,
      identities: () => [],
      addIdentity: async () => undefined,
    } as unknown as NativeProviderCatalogPort,
  };
}

describe('Tuya bridge session expiry tracking in NativeProviders', () => {
  it('exposes loggedIn=false and authExpired=true when Tuya bridge auth expires and clears after login', async () => {
    let loggedIn = false;
    const bridgeId = '75399349-a61d-4104-841d-0280196deb09';
    const providers = new NativeProviders({
      catalog: createCatalog({
        bridgeId,
        provider: 'tuya',
        endpoint: { url: 'http://192.168.4.44:6766', allowHttp: true },
      }),
      client: (connection) => ({
        connection,
        inventory: async () => ({
          version: 2,
          bridgeId,
          provider: 'tuya',
          revision: 'rev-1',
          cameras: [],
        }),
        revoke: async () => undefined,
      }),
      checkTuyaAuth: async () => loggedIn,
    });

    await providers.refresh(bridgeId);
    expect(providers.list()).toEqual([
      expect.objectContaining({
        id: bridgeId,
        provider: 'tuya',
        available: true,
        loggedIn: false,
        authExpired: true,
      }),
    ]);
    expect(providers.authStatus(bridgeId)).toEqual({ loggedIn: false, authExpired: true });

    loggedIn = true;
    await providers.refresh(bridgeId);
    expect(providers.list()).toEqual([
      expect.objectContaining({
        id: bridgeId,
        provider: 'tuya',
        loggedIn: true,
        authExpired: false,
      }),
    ]);
  });
});
