/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import { parseLocalHausNvrService } from '../src/discovery/local-nvr-candidate';

describe('local Haus NVR candidate validation', () => {
  it('uses a private IPv4 address and ignores unrelated advertised data', () => {
    expect(
      parseLocalHausNvrService({
        name: 'Living room NVR',
        hostname: 'living-room.local.',
        ipv4: '192.168.1.20',
        ipv6: '2001:db8::1',
        port: 8098,
      }),
    ).toEqual({
      id: 'http://192.168.1.20:8098',
      name: 'Living room NVR',
      url: 'http://192.168.1.20:8098',
      host: '192.168.1.20',
      port: 8098,
    });
  });

  it('accepts a local hostname or unique-local IPv6 when no private IPv4 exists', () => {
    expect(
      parseLocalHausNvrService({ name: 'Haus NVR', hostname: 'haus-nvr.local.', port: 8098 })?.url,
    ).toBe('http://haus-nvr.local:8098');
    expect(
      parseLocalHausNvrService({ name: 'Haus NVR', ipv6: 'fd12:3456::5', port: 8098 })?.url,
    ).toBe('http://[fd12:3456::5]:8098');
  });

  it('rejects public, link-local, malformed and out-of-range endpoints', () => {
    for (const service of [
      { name: 'NVR', ipv4: '8.8.8.8', port: 8098 },
      { name: 'NVR', ipv4: '169.254.1.1', port: 8098 },
      { name: 'NVR', ipv6: 'fe80::1', port: 8098 },
      { name: 'NVR', hostname: 'example.com', port: 8098 },
      { name: 'NVR', hostname: 'haus-nvr.local', port: 70000 },
    ])
      expect(parseLocalHausNvrService(service)).toBeUndefined();
  });

  it('removes control characters from display names', () => {
    expect(
      parseLocalHausNvrService({
        name: '  Haus\u0000 NVR\n',
        hostname: 'haus-nvr.local',
        port: 8098,
      })?.name,
    ).toBe('Haus NVR');
  });
});
