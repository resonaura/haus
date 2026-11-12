/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DiscoveredProviderBridge } from '../../src/providers/discovery.js';
import {
  connectDiscoveredProvider,
  connectManagedProvider,
} from '../../src/providers/managed.js';

describe('connectManagedProvider', () => {
  it('keeps managed pairing code local and requires Supervisor proof plus matching local identity', async () => {
    const id = randomUUID();
    const code = 'a'.repeat(48);
    const paths: string[] = [];
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'aqara',
      name: 'Aqara Bridge',
      url: 'http://172.30.32.1:8580',
      source: 'supervisor',
      managed: true,
      paired: false,
    };
    let added: { url: string; code: string; allowHttp: boolean } | undefined;
    const options = {
      discover: async () => [hint],
      local: async (port: number, path: string) => {
        expect(port).toBe(8580);
        paths.push(path);
        return path.endsWith('/info') ? { version: 2, bridgeId: id, provider: 'aqara' } : { code };
      },
    };
    const providers = {
      add: async (input: { url: string; code: string; allowHttp: boolean }) => {
        added = input;
        return { id };
      },
    };
    expect(await connectManagedProvider({ token: 'ha-private' }, providers, id, options)).toEqual({
      id,
    });
    expect(added).toEqual({ url: hint.url, code, allowHttp: true });
    expect(paths).toEqual(['/api/haus/v2/info', '/api/haus/v2/pairing']);

    paths.length = 0;
    await expect(
      connectManagedProvider({ token: 'private' }, providers, id, {
        ...options,
        discover: async () => [{ ...hint, source: 'mdns' }],
      }),
    ).rejects.toThrow(/unavailable/);
    expect(paths).toEqual([]);

    paths.length = 0;
    await expect(
      connectManagedProvider({ token: 'private' }, providers, id, {
        ...options,
        local: async (_port: number, path: string) => {
          paths.push(path);
          return { version: 2, bridgeId: randomUUID(), provider: 'aqara' };
        },
      }),
    ).rejects.toThrow(/identity/);
    expect(paths).toEqual(['/api/haus/v2/info']);
  });

  it('pairs a selected same-host mDNS bridge without returning its one-use code', async () => {
    const id = randomUUID();
    const code = 'b'.repeat(48);
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'aqara',
      name: 'Aqara Bridge',
      url: 'http://192.168.5.117:8580',
      source: 'mdns',
      paired: false,
    };
    const paths: string[] = [];
    let added: { url: string; code: string; allowHttp: boolean } | undefined;
    const providers = {
      add: async (input: { url: string; code: string; allowHttp: boolean }) => {
        added = input;
        return { id };
      },
    };

    const result = await connectDiscoveredProvider({ standalone: true }, providers, id, {
      discover: async () => [hint],
      isLocalAddress: (address) => address === '192.168.5.117',
      local: async (port, path) => {
        expect(port).toBe(8580);
        paths.push(path);
        return path.endsWith('/info')
          ? { version: 2, bridgeId: id, provider: 'aqara' }
          : { code };
      },
    });

    expect(result).toEqual({ id });
    expect(added).toEqual({ url: hint.url, code, allowHttp: true });
    expect(paths).toEqual(['/api/haus/v2/info', '/api/haus/v2/pairing']);
  });

  it('requires manual pairing when loopback identity does not match the selected mDNS bridge', async () => {
    const id = randomUUID();
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'aqara',
      name: 'Aqara Bridge',
      url: 'http://192.168.5.117:8580',
      source: 'mdns',
      paired: false,
    };
    const paths: string[] = [];
    let added = false;

    const result = await connectDiscoveredProvider(
      { standalone: true },
      {
        add: async () => {
          added = true;
          return { id };
        },
      },
      id,
      {
        discover: async () => [hint],
        isLocalAddress: (address) => address === '192.168.5.117',
        local: async (_port, path) => {
          paths.push(path);
          return { version: 2, bridgeId: randomUUID(), provider: 'aqara' };
        },
      },
    );

    expect(result).toBeUndefined();
    expect(paths).toEqual(['/api/haus/v2/info']);
    expect(added).toBe(false);
  });

  it('requires manual pairing when the local bridge protocol version is unsupported', async () => {
    const id = randomUUID();
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'aqara',
      name: 'Aqara Bridge',
      url: 'http://192.168.5.117:8580',
      source: 'mdns',
      paired: false,
    };
    const paths: string[] = [];
    let added = false;

    const result = await connectDiscoveredProvider(
      { standalone: true },
      {
        add: async () => {
          added = true;
          return { id };
        },
      },
      id,
      {
        discover: async () => [hint],
        isLocalAddress: () => true,
        local: async (_port, path) => {
          paths.push(path);
          return { version: 3, bridgeId: id, provider: 'aqara' };
        },
      },
    );

    expect(result).toBeUndefined();
    expect(paths).toEqual(['/api/haus/v2/info']);
    expect(added).toBe(false);
  });

  it('does not probe loopback for an mDNS bridge hosted on another machine', async () => {
    const id = randomUUID();
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'tuya',
      name: 'Tuya Bridge',
      url: 'http://192.168.5.117:8580',
      source: 'mdns',
      paired: false,
    };
    let localRequests = 0;
    let added = false;

    const result = await connectDiscoveredProvider(
      { standalone: true },
      {
        add: async () => {
          added = true;
          return { id };
        },
      },
      id,
      {
        discover: async () => [hint],
        isLocalAddress: () => false,
        local: async () => {
          localRequests += 1;
          return {};
        },
      },
    );

    expect(result).toBeUndefined();
    expect(localRequests).toBe(0);
    expect(added).toBe(false);
  });

  it('falls back to manual pairing when the local bridge does not provide an automatic code', async () => {
    const id = randomUUID();
    const hint: DiscoveredProviderBridge = {
      bridgeId: id,
      provider: 'tuya',
      name: 'Tuya Bridge',
      url: 'http://192.168.5.117:8580',
      source: 'mdns',
      paired: false,
    };
    const paths: string[] = [];
    let added = false;

    const result = await connectDiscoveredProvider(
      { standalone: true },
      {
        add: async () => {
          added = true;
          return { id };
        },
      },
      id,
      {
        discover: async () => [hint],
        isLocalAddress: () => true,
        local: async (_port, path) => {
          paths.push(path);
          if (path.endsWith('/info')) return { version: 2, bridgeId: id, provider: 'tuya' };
          throw new Error('pairing_not_available');
        },
      },
    );

    expect(result).toBeUndefined();
    expect(paths).toEqual(['/api/haus/v2/info', '/api/haus/v2/pairing']);
    expect(added).toBe(false);
  });
});
