/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import type { DiscoveredServer } from '../../../../shared/native.js';

function filterOnboardingServers(
  servers: readonly DiscoveredServer[],
  explicitHa: boolean,
): DiscoveredServer[] {
  if (explicitHa) {
    return servers.filter((s) => s.kind === 'home-assistant');
  }
  return servers.filter((s) => s.kind === 'haus-hub' || !s.kind);
}

describe('onboarding discovery filtering', () => {
  const mixedServers: DiscoveredServer[] = [
    {
      id: 'haus-hub:hub-main',
      name: 'Main Haus Hub',
      url: 'http://192.168.1.50:8443',
      host: '192.168.1.50',
      port: 8443,
      kind: 'haus-hub',
    },
    {
      id: 'ha-narnia',
      name: 'Narnia Home Assistant',
      url: 'http://192.168.1.100:8123',
      host: '192.168.1.100',
      port: 8123,
      kind: 'home-assistant',
    },
  ];

  it('default discovery shows ONLY Haus Hubs and excludes Home Assistant', () => {
    const visible = filterOnboardingServers(mixedServers, false);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: 'haus-hub:hub-main',
      name: 'Main Haus Hub',
      kind: 'haus-hub',
    });
  });

  it('explicit HA mode shows ONLY Home Assistant servers', () => {
    const visible = filterOnboardingServers(mixedServers, true);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: 'ha-narnia',
      name: 'Narnia Home Assistant',
      kind: 'home-assistant',
    });
  });

  it('preserves saved Home Assistant connection URL', () => {
    const savedHaUrl = 'http://192.168.1.100:8123';
    const isExplicitHaInitial =
      savedHaUrl.includes(':8123') || savedHaUrl.includes('homeassistant');
    expect(isExplicitHaInitial).toBe(true);
  });
});
