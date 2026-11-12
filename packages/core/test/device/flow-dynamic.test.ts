/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  IntegrationFlowEngine,
  type FlowCatalogManifest,
  type FlowCatalogResolver,
} from '../../src/commissioning/index.js';

class MockCatalogResolver implements FlowCatalogResolver {
  private readonly manifests = new Map<string, FlowCatalogManifest>();

  constructor(manifestList: FlowCatalogManifest[] = []) {
    for (const m of manifestList) {
      this.manifests.set(m.domain, m);
    }
  }

  hasDomain(domain: string): boolean {
    return this.manifests.has(domain);
  }

  getManifest(domain: string): FlowCatalogManifest | undefined {
    return this.manifests.get(domain);
  }

  getAllDomains(): readonly string[] {
    return Array.from(this.manifests.keys());
  }
}

describe('Universal Dynamic Config Flow Engine', () => {
  const resolver = new MockCatalogResolver([
    {
      domain: 'xiaomi_ble',
      name: 'Xiaomi Bluetooth',
      iot_class: 'local_push',
      config_flow: true,
      bluetooth: [{ service_data_uuid: '0000fe95-0000-1000-8000-00805f9b34fb' }],
    },
    {
      domain: 'somfy_cloud',
      name: 'Somfy Cloud Gateway',
      iot_class: 'cloud_push',
      config_flow: true,
    },
    {
      domain: 'custom_iot_plug',
      name: 'Custom IoT Plug',
      iot_class: 'local_polling',
      config_flow: true,
    },
    {
      domain: 'sun',
      name: 'Sun Calculation',
      iot_class: 'calculated',
      config_flow: false,
    },
  ]);

  it('resolves Bluetooth integration dynamically with MAC and bindkey fields without aborting', async () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);

    const step = await engine.startFlow({
      domain: 'xiaomi_ble',
      homeId: 'home-1',
      userId: 'user-1',
      manualAddress: { host: 'F8:24:41:C5:7D:98' },
    });

    expect(step.type).toBe('form');
    expect(step.title).toBe('Configure Xiaomi Bluetooth');
    expect(step.dataSchema).toBeDefined();

    const macField = step.dataSchema?.find((f) => f.name === 'address');
    expect(macField?.defaultValue).toBe('F8:24:41:C5:7D:98');
    expect(macField?.required).toBe(true);

    const bindkeyField = step.dataSchema?.find((f) => f.name === 'bindkey');
    expect(bindkeyField?.type).toBe('pin');
    expect(bindkeyField?.required).toBe(false);

    // Submit step with bindkey
    const result = await engine.submitStep({
      flowId: step.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      values: {
        address: 'F8:24:41:C5:7D:98',
        bindkey: 'eb8dea5be36d8f96d86bbc4a',
      },
    });

    expect(result.type).toBe('create_entry');
    expect(result.result?.title).toBe('Configure Xiaomi Bluetooth');
    expect(result.result?.entryId).toBeDefined();
  });

  it('resolves cloud integration dynamically with credential schema', async () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);

    const step = await engine.startFlow({
      domain: 'somfy_cloud',
      homeId: 'home-1',
      userId: 'user-1',
    });

    expect(step.type).toBe('form');
    expect(step.title).toBe('Configure Somfy Cloud Gateway');
    expect(step.dataSchema?.some((f) => f.name === 'username')).toBe(true);
    expect(step.dataSchema?.some((f) => f.name === 'password')).toBe(true);

    const result = await engine.submitStep({
      flowId: step.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      values: {
        username: 'user@example.com',
        password: 'secretPassword123',
      },
    });

    expect(result.type).toBe('create_entry');
    expect(result.result?.title).toBe('Configure Somfy Cloud Gateway');
  });

  it('resolves local network integration dynamically with host and port', async () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);

    const step = await engine.startFlow({
      domain: 'custom_iot_plug',
      homeId: 'home-1',
      userId: 'user-1',
      manualAddress: { host: '192.168.1.100', port: 8080 },
    });

    expect(step.type).toBe('form');
    expect(step.title).toBe('Configure Custom IoT Plug');
    const hostField = step.dataSchema?.find((f) => f.name === 'host');
    expect(hostField?.defaultValue).toBe('192.168.1.100');
  });

  it('resolves zero-config calculated integrations immediately into create_entry', async () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);

    const step = await engine.startFlow({
      domain: 'sun',
      homeId: 'home-1',
      userId: 'user-1',
    });

    expect(step.type).toBe('create_entry');
    expect(step.result?.title).toBe('Sun Calculation');
    expect(step.result?.entryId).toContain('sun_');
  });

  it('truthfully aborts unknown integrations not found in catalog or native handlers', async () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);

    const step = await engine.startFlow({
      domain: 'completely_unknown_device_vendor',
      homeId: 'home-1',
      userId: 'user-1',
    });

    expect(step.type).toBe('abort');
    expect(step.title).toContain('Unsupported Integration');
  });

  it('exposes combined catalog and known domains via getAvailableDomains', () => {
    const engine = new IntegrationFlowEngine(undefined, resolver);
    const domains = engine.getAvailableDomains();

    expect(domains).toContain('homekit_controller');
    expect(domains).toContain('matter');
    expect(domains).toContain('xiaomi_ble');
    expect(domains).toContain('somfy_cloud');
    expect(domains).toContain('sun');
  });
});
