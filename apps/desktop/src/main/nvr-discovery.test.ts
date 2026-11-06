/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNvrDiscoveryTask, parseDiscoveredHausNvr } from './nvr-discovery';

afterEach(() => vi.useRealTimers());

describe('Haus NVR network discovery', () => {
  it('accepts only the versioned Haus NVR service and uses its private address', () => {
    expect(
      parseDiscoveredHausNvr({
        type: 'haus-nvr',
        host: 'haus-nvr-123.local.',
        addresses: ['8.8.8.8', '192.168.1.20'],
        name: 'Haus NVR',
        port: 8098,
        txt: { protocol: '1', node_key: 'must-not-be-used' },
      }),
    ).toEqual({
      id: 'haus-nvr:http://192.168.1.20:8098',
      name: 'Haus NVR',
      url: 'http://192.168.1.20:8098',
      host: '192.168.1.20',
      port: 8098,
    });
  });

  it('rejects unversioned, remote, credential-shaped and malformed service data', () => {
    const base = {
      type: 'haus-nvr',
      host: 'haus-nvr.local',
      addresses: ['203.0.113.8'],
      name: 'Haus NVR',
      port: 8098,
      txt: { protocol: '1' },
    };
    expect(parseDiscoveredHausNvr({ ...base, type: 'http' })).toBeUndefined();
    expect(parseDiscoveredHausNvr({ ...base, txt: {} })).toBeUndefined();
    expect(parseDiscoveredHausNvr({ ...base, host: 'public.example' })).toBeUndefined();
    expect(parseDiscoveredHausNvr({ ...base, port: 70000 })).toBeUndefined();
    expect(
      parseDiscoveredHausNvr({ ...base, host: 'haus-nvr.local', txt: { protocol: '1' } })?.url,
    ).toBe('http://haus-nvr.local:8098');
  });

  it('cancels the native browser and keeps discovered nodes as pairing hints', async () => {
    const stop = vi.fn();
    const controller = new AbortController();
    const browse = vi.fn((onService: (service: never) => void) => {
      onService({
        type: 'haus-nvr',
        host: 'haus-nvr.local',
        addresses: ['192.168.1.20'],
        name: 'Haus NVR',
        port: 8098,
        txt: { protocol: '1' },
      } as never);
      return stop;
    });
    const task = createNvrDiscoveryTask(5000, controller.signal, browse);
    controller.abort();

    await expect(task.promise).resolves.toMatchObject([{ url: 'http://192.168.1.20:8098' }]);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('stops scanning at the bounded deadline', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const task = createNvrDiscoveryTask(100, undefined, () => stop);
    await vi.advanceTimersByTimeAsync(100);
    await expect(task.promise).resolves.toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
  });
});
