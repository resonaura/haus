/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DiscoveredProviderBridge } from '../../src/providers/discovery.js';
import { connectManagedProvider } from '../../src/providers/managed.js';

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
});
