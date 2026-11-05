/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  parseLocalHausHubService,
  parseLocalHomeAssistantService,
} from '../src/discovery/local-home-candidate.js';

describe('mobile local network discovery candidate parsing', () => {
  describe('Haus Hub parsing', () => {
    it('accepts valid haus-hub services on private addresses', () => {
      const candidate = parseLocalHausHubService({
        name: 'Main Haus Hub',
        hostname: 'hub.local',
        ipv4: '192.168.1.50',
        port: 8443,
      });

      expect(candidate).toEqual({
        id: 'haus-hub:http://192.168.1.50:8443',
        name: 'Main Haus Hub',
        url: 'http://192.168.1.50:8443',
        host: '192.168.1.50',
        port: 8443,
        kind: 'haus-hub',
      });
    });

    it('rejects public IPs, non-local domains, and invalid ports', () => {
      // Public IPv4
      expect(
        parseLocalHausHubService({
          name: 'Public Hub',
          ipv4: '8.8.8.8',
          port: 8443,
        }),
      ).toBeUndefined();

      // Public IPv6
      expect(
        parseLocalHausHubService({
          name: 'Public Hub',
          ipv6: '2001:db8::1',
          port: 8443,
        }),
      ).toBeUndefined();

      // Remote domain
      expect(
        parseLocalHausHubService({
          name: 'Remote Hub',
          hostname: 'attacker.example.com',
          port: 8443,
        }),
      ).toBeUndefined();

      // Invalid port
      expect(
        parseLocalHausHubService({
          name: 'Bad Port Hub',
          ipv4: '192.168.1.50',
          port: 70000,
        }),
      ).toBeUndefined();
    });
  });

  describe('Home Assistant parsing for explicit import', () => {
    it('accepts local HA endpoints and marks kind as home-assistant', () => {
      const candidate = parseLocalHomeAssistantService({
        name: 'Home Assistant',
        hostname: 'homeassistant.local',
        ipv4: '192.168.1.100',
        port: 8123,
      });

      expect(candidate).toEqual({
        id: 'http://192.168.1.100:8123',
        name: 'Home Assistant',
        url: 'http://192.168.1.100:8123',
        host: '192.168.1.100',
        port: 8123,
        kind: 'home-assistant',
      });
    });

    it('rejects non-local HA endpoints', () => {
      expect(
        parseLocalHomeAssistantService({
          name: 'Remote HA',
          hostname: 'attacker.example.com',
          port: 8123,
        }),
      ).toBeUndefined();
    });
  });
});
