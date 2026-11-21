/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it, vi } from 'vitest';
import { DiscoveryRegistry, IntegrationFlowEngine } from '@haus/core';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import {
  HubNetworkDeviceService,
  networkDeviceIdForEntry,
  networkEndpointIdForEntry,
} from '../../src/commissioning/network/service.js';
import {
  GENERIC_NETWORK_DOMAIN,
  normalizeNetworkDeviceTarget,
} from '../../src/commissioning/network/types.js';

describe('Generic Network Device integration', () => {
  describe('normalizeNetworkDeviceTarget', () => {
    it('normalizes IPv4, ports, hostnames, IPv6, and explicit URLs', () => {
      const ipv4 = normalizeNetworkDeviceTarget({ host: '192.168.4.1', scheme: 'http' });
      expect(ipv4).toEqual({
        ok: true,
        target: {
          scheme: 'http',
          host: '192.168.4.1',
          probePort: 80,
          managementUrl: 'http://192.168.4.1/',
        },
      });

      const httpsPort = normalizeNetworkDeviceTarget({
        host: '10.0.0.2',
        scheme: 'https',
        port: 8443,
      });
      expect(httpsPort).toEqual({
        ok: true,
        target: {
          scheme: 'https',
          host: '10.0.0.2',
          port: 8443,
          probePort: 8443,
          managementUrl: 'https://10.0.0.2:8443/',
        },
      });

      const explicitUrl = normalizeNetworkDeviceTarget({
        host: 'https://switch.local:9443/admin',
        scheme: 'http',
      });
      expect(explicitUrl).toEqual({
        ok: true,
        target: {
          scheme: 'https',
          host: 'switch.local',
          port: 9443,
          probePort: 9443,
          managementUrl: 'https://switch.local:9443/admin',
        },
      });

      const ipv6 = normalizeNetworkDeviceTarget({ host: 'fd00::1', scheme: 'http', port: 8080 });
      expect(ipv6).toEqual({
        ok: true,
        target: {
          scheme: 'http',
          host: 'fd00::1',
          port: 8080,
          probePort: 8080,
          managementUrl: 'http://[fd00::1]:8080/',
        },
      });
    });

    it('rejects credentials, non-http schemes, whitespace, and invalid ports', () => {
      expect(
        normalizeNetworkDeviceTarget({ host: 'http://admin:secret@192.168.4.1/' }),
      ).toMatchObject({ ok: false, field: 'host', error: 'invalid_host' });
      expect(normalizeNetworkDeviceTarget({ host: 'file:///etc/passwd' })).toMatchObject({
        ok: false,
        field: 'host',
        error: 'invalid_host',
      });
      expect(normalizeNetworkDeviceTarget({ host: '192.168.4.1 foo' })).toMatchObject({
        ok: false,
        field: 'host',
        error: 'invalid_host',
      });
      expect(normalizeNetworkDeviceTarget({ host: '192.168.4.1', port: 70000 })).toMatchObject({
        ok: false,
        field: 'port',
        error: 'invalid_port',
      });
      expect(normalizeNetworkDeviceTarget({ host: '192.168.4.1', port: 0 })).toMatchObject({
        ok: false,
        field: 'port',
        error: 'invalid_port',
      });
    });
  });

  it('creates, probes, reconfigures, disables, and deletes generic network devices', async () => {
    const home = new StandaloneHomeService();
    const probe = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    const networkService = new HubNetworkDeviceService(home);
    networkService.setProbeForTesting(probe);

    const entries = new HubIntegrationEntryService(
      home,
      undefined,
      undefined,
      undefined,
      undefined,
      networkService,
    );
    const engine = new IntegrationFlowEngine(new DiscoveryRegistry());
    entries.registerDynamicDomains(engine);

    const meta = await entries.listIntegrationMetadata();
    const networkMeta = meta.find((item) => item.domain === GENERIC_NETWORK_DOMAIN);
    expect(networkMeta?.name).toBe('Generic Network Device');
    expect(networkMeta?.supportsMultiple).toBe(true);

    // Start flow and verify inline validation on bad host
    const startStep = await entries.startFlowWithPersistence(
      engine,
      { domain: GENERIC_NETWORK_DOMAIN, homeId: 'home-1', userId: 'user-1' },
      () => undefined,
    );
    expect(startStep.type).toBe('form');
    expect(startStep.dataSchema?.map((f) => f.name)).toEqual([
      'name',
      'device_type',
      'host',
      'scheme',
      'port',
    ]);

    const invalidStep = await entries.submitFlowWithPersistence(
      engine,
      {
        flowId: startStep.flowId,
        homeId: 'home-1',
        userId: 'user-1',
        values: {
          name: 'Core Switch',
          device_type: 'network_switch',
          host: 'http://user:pass@192.168.4.2',
          scheme: 'http',
        },
      },
      () => undefined,
    );
    expect(invalidStep.type).toBe('form');
    expect(invalidStep.errors?.host).toBe('invalid_host');

    // Submit valid values
    const created = await entries.submitFlowWithPersistence(
      engine,
      {
        flowId: startStep.flowId,
        homeId: 'home-1',
        userId: 'user-1',
        values: {
          name: 'Core Switch',
          device_type: 'network_switch',
          host: '192.168.4.2',
          scheme: 'https',
          port: 8443,
        },
      },
      () => undefined,
    );
    expect(created.type).toBe('create_entry');
    const entryId = created.result?.entryId;
    expect(entryId).toBeTruthy();

    const deviceId = networkDeviceIdForEntry(entryId!);
    const endpointId = networkEndpointIdForEntry(entryId!);
    const device = home.getDevice(deviceId);
    expect(device).toBeDefined();
    expect(device?.category).toBe('network');
    expect(device?.deviceType).toBe('network_switch');
    expect(device?.model).toBe('Switch');
    expect(device?.connectivity).toEqual({ protocol: 'local_ip', address: '192.168.4.2' });
    expect(device?.opaqueMetadata?.managementUrl).toBe('https://192.168.4.2:8443/');
    expect(
      (device?.opaqueMetadata?.presentation as { managementUrl?: string } | undefined)
        ?.managementUrl,
    ).toBe('https://192.168.4.2:8443/');
    expect(probe).toHaveBeenCalledWith('192.168.4.2', 8443);
    expect(home.getEndpointState(endpointId)).toMatchObject({
      connectivity: true,
      state: 'on',
      ip: '192.168.4.2',
      url: 'https://192.168.4.2:8443/',
    });

    // Reconfigure preserves room assignment and updates type/URL/probe
    home.registerDevice({ ...device!, roomId: 'office' });
    probe.mockResolvedValueOnce(false);
    const reconfigStart = await entries.startFlowWithPersistence(
      engine,
      {
        domain: GENERIC_NETWORK_DOMAIN,
        homeId: 'home-1',
        userId: 'user-1',
        source: 'reconfigure',
        entryId: entryId!,
      },
      () => undefined,
    );
    expect(reconfigStart.dataSchema?.find((f) => f.name === 'host')?.defaultValue).toBe(
      '192.168.4.2',
    );
    const reconfigured = await entries.submitFlowWithPersistence(
      engine,
      {
        flowId: reconfigStart.flowId,
        homeId: 'home-1',
        userId: 'user-1',
        values: {
          name: 'Hallway Repeater',
          device_type: 'repeater',
          host: '192.168.4.10',
          scheme: 'http',
        },
      },
      () => undefined,
    );
    expect(reconfigured.type).toBe('create_entry');

    const updatedDevice = home.getDevice(deviceId);
    expect(updatedDevice?.name).toBe('Hallway Repeater');
    expect(updatedDevice?.deviceType).toBe('repeater');
    expect(updatedDevice?.model).toBe('Repeater');
    expect(updatedDevice?.roomId).toBe('office');
    expect(updatedDevice?.opaqueMetadata?.managementUrl).toBe('http://192.168.4.10/');
    expect(home.getEndpointState(endpointId)).toMatchObject({
      connectivity: false,
      state: 'off',
      ip: '192.168.4.10',
    });

    // Disable marks device offline; delete removes it completely
    await entries.setDisabled(entryId!, true);
    expect(home.getDevice(deviceId)?.availability).toBe('offline');

    await entries.deleteEntry(entryId!);
    expect(home.getDevice(deviceId)).toBeUndefined();

    entries.onModuleDestroy();
    await home.onModuleDestroy();
  });
});
