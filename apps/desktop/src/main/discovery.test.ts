/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDiscoveryTask,
  createHausHubDiscoveryTask,
  parseDiscoveredHausHub,
  parseDiscoveredHomeAssistant,
} from './discovery.js';

afterEach(() => vi.useRealTimers());

describe('Haus Hub and Home Assistant network discovery', () => {
  describe('Haus Hub candidate parsing', () => {
    it('accepts valid haus-hub services on private addresses and protocol 1', () => {
      expect(
        parseDiscoveredHausHub({
          type: 'haus-hub',
          host: 'hub-living.local.',
          addresses: ['192.168.1.100'],
          name: 'Living Room Hub',
          port: 8443,
          txt: { protocol: '1', hubId: 'hub-100', homeId: 'home-sol' },
        }),
      ).toEqual({
        id: 'haus-hub:hub-100',
        name: 'Living Room Hub',
        url: 'http://192.168.1.100:8443',
        host: '192.168.1.100',
        port: 8443,
        kind: 'haus-hub',
      });
    });

    it('rejects public addresses, credentials in txt, and unversioned hub services', () => {
      const base = {
        type: 'haus-hub',
        name: 'Hub',
        host: 'hub.local',
        addresses: ['192.168.1.100'],
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-1' },
      };

      expect(
        parseDiscoveredHausHub({ ...base, addresses: ['8.8.8.8'], host: 'public.com' }),
      ).toBeUndefined();
      expect(
        parseDiscoveredHausHub({ ...base, txt: { ...base.txt, token: 'secret' } }),
      ).toBeUndefined();
      expect(parseDiscoveredHausHub({ ...base, txt: { hubId: 'hub-1' } })).toBeUndefined();
      expect(parseDiscoveredHausHub({ ...base, port: 80000 })).toBeUndefined();
    });
  });

  describe('Home Assistant candidate parsing', () => {
    it('accepts local advertised URLs and correctly brackets IPv6 fallback addresses', () => {
      expect(
        parseDiscoveredHomeAssistant({
          host: 'homeassistant.local.',
          name: 'HA',
          port: 8123,
          txt: { location_name: 'Narnia', uuid: 'home-id', version: '2026.11.0' },
        }),
      ).toMatchObject({
        id: 'home-id',
        name: 'Narnia',
        host: 'homeassistant.local',
        port: 8123,
        url: 'http://homeassistant.local:8123',
        version: '2026.11.0',
      });

      expect(
        parseDiscoveredHomeAssistant({
          host: 'fd12::44',
          name: 'IPv6 HA',
          port: 8123,
          txt: {},
        })?.url,
      ).toBe('http://[fd12::44]:8123');
    });

    it('rejects landing pages, remote/malformed URLs and invalid ports', () => {
      const base = { host: 'ha.local', name: 'HA', port: 8123, txt: {} };
      expect(
        parseDiscoveredHomeAssistant({ ...base, txt: { landingpage: 'true' } }),
      ).toBeUndefined();
      expect(
        parseDiscoveredHomeAssistant({
          ...base,
          txt: { internal_url: 'https://attacker.example/login' },
        }),
      ).toBeUndefined();
      expect(parseDiscoveredHomeAssistant({ ...base, port: 70000 })).toBeUndefined();
      expect(
        parseDiscoveredHomeAssistant({ ...base, txt: { internal_url: 'http://ha.local/path' } }),
      ).toBeUndefined();
    });
  });

  describe('Discovery target selection and filtering', () => {
    it('default discovery finds ONLY Haus Hubs and ignores Home Assistant services', async () => {
      const browse = vi.fn((onService: (service: any) => void) => {
        // Discovered Haus Hub
        onService({
          type: 'haus-hub',
          host: 'hub.local',
          addresses: ['192.168.1.50'],
          name: 'Main Haus Hub',
          port: 8443,
          txt: { protocol: '1', hubId: 'hub-main' },
        });
        // Discovered Home Assistant (must NOT be returned by default discovery)
        onService({
          type: 'home-assistant',
          host: 'ha.local',
          addresses: ['192.168.1.60'],
          name: 'Old Home Assistant',
          port: 8123,
          txt: { location_name: 'Home', protocol: '1' },
        });
        return () => undefined;
      });

      const task = createHausHubDiscoveryTask(50, undefined, browse);
      const results = await task.promise;

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'haus-hub:hub-main',
        name: 'Main Haus Hub',
        kind: 'haus-hub',
      });
    });

    it('explicit HA discovery finds Home Assistant services when explicitly requested', async () => {
      const task = createDiscoveryTask(5000, undefined, undefined, { explicitHa: true });
      // The task promise resolves to an array of DiscoveredServer with kind: 'home-assistant'
      expect(task).toBeDefined();
    });

    it('closes the multicast browser when canceled and retains manual discovery fallback', async () => {
      const stop = vi.fn();
      const controller = new AbortController();
      const browse = vi.fn((onService: (service: any) => void) => {
        onService({
          type: 'haus-hub',
          host: 'hub.local',
          addresses: ['192.168.1.20'],
          name: 'Living Hub',
          port: 8443,
          txt: { protocol: '1', hubId: 'hub-1' },
        });
        return stop;
      });
      const task = createHausHubDiscoveryTask(5000, controller.signal, browse);

      controller.abort();

      await expect(task.promise).resolves.toMatchObject([{ name: 'Living Hub', kind: 'haus-hub' }]);
      expect(stop).toHaveBeenCalledOnce();
    });

    it('stops scanning at the bounded discovery deadline', async () => {
      vi.useFakeTimers();
      const stop = vi.fn();
      const task = createHausHubDiscoveryTask(100, undefined, () => stop);
      await vi.advanceTimersByTimeAsync(100);
      await expect(task.promise).resolves.toEqual([]);
      expect(stop).toHaveBeenCalledOnce();
    });
  });
});
