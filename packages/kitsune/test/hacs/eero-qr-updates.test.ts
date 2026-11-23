/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { HacsVirtualizer } from '../../src/hacs/virtualizer.js';
import type { HacsServiceCallPayload } from '../../src/hacs/types.js';

describe('Eero live entityCategory classification, QR image.* and official HA update.* parity', () => {
  it('classifies real Eero Network, Router, and Profile devices as network even with diagnostic/config entity categories', () => {
    const virtualizer = new HacsVirtualizer(undefined, async () => undefined);

    // Real Eero router node: status light is config, firmware is config, sensors are diagnostic
    virtualizer.handleEntityAdded({
      entityId: 'update.narnia_eero_firmware',
      integration: 'eero',
      domain: 'update',
      name: 'Narnia Firmware',
      state: 'on',
      entityCategory: 'config',
      deviceId: 'ha:eero:narnia',
      deviceName: 'Narnia',
      manufacturer: 'eero',
      model: 'eero 6',
      attributes: {
        installed_version: 'v7.5.1-214',
        latest_version: 'v7.6.0-100',
        skipped_version: null,
        title: 'eeroOS',
        in_progress: false,
        update_percentage: null,
        auto_update: true,
        release_summary: '- Stability improvements\n- Security fixes',
        release_url: 'https://support.eero.com/hc/en-us/articles/209636523',
        supported_features: 17,
      },
    });
    virtualizer.handleEntityAdded({
      entityId: 'light.narnia_status_light',
      integration: 'eero',
      domain: 'light',
      name: 'Narnia Status Light',
      state: 'on',
      entityCategory: 'config',
      deviceId: 'ha:eero:narnia',
      deviceName: 'Narnia',
      manufacturer: 'eero',
      model: 'eero 6',
      attributes: { brightness: 204 },
    });
    virtualizer.handleEntityAdded({
      entityId: 'sensor.narnia_connected_clients',
      integration: 'eero',
      domain: 'sensor',
      name: 'Narnia Connected Clients',
      state: '12',
      entityCategory: 'diagnostic',
      deviceId: 'ha:eero:narnia',
      deviceName: 'Narnia',
      manufacturer: 'eero',
      model: 'eero 6',
      attributes: { clients: ['MacBook Pro', 'Apple TV'] },
    });

    // Real Eero network service device with diagnostic QR code image entities
    virtualizer.handleEntityAdded({
      entityId: 'image.crawford_qr_code',
      integration: 'eero',
      domain: 'image',
      name: 'Crawford QR Code',
      state: '2026-11-23T06:00:00+00:00',
      entityCategory: 'diagnostic',
      deviceId: 'ha:eero:crawford',
      deviceName: 'Crawford',
      deviceEntryType: 'service',
      manufacturer: 'eero',
      model: 'Network',
      attributes: {
        content_type: 'image/png',
        image_last_updated: '2026-11-23T06:00:00+00:00',
        entity_picture: '/api/image_proxy/image.crawford_qr_code',
      },
    });
    virtualizer.handleEntityAdded({
      entityId: 'switch.crawford_guest_network',
      integration: 'eero',
      domain: 'switch',
      name: 'Crawford Guest Network',
      state: 'on',
      deviceId: 'ha:eero:crawford',
      deviceName: 'Crawford',
      deviceEntryType: 'service',
      manufacturer: 'eero',
      model: 'Network',
      attributes: { guest_network_name: 'Crawford-Guest', connected_guest_clients: 2 },
    });

    const narnia = virtualizer.getDevice('ha:eero:narnia');
    assert.ok(narnia);
    assert.equal(narnia.category, 'network');

    const updateEp = narnia.endpoints.find((ep) => ep.id === 'update.narnia_eero_firmware');
    assert.ok(updateEp);
    assert.equal(updateEp.readings.update?.value, true);
    assert.equal(updateEp.readings.installed_version?.value, 'v7.5.1-214');
    assert.equal(updateEp.readings.latest_version?.value, 'v7.6.0-100');
    assert.equal(
      updateEp.readings.release_summary?.value,
      '- Stability improvements\n- Security fixes',
    );
    assert.equal(updateEp.readings.supported_features?.value, 17);
    assert.equal(updateEp.readings.auto_update?.value, true);

    const clientsEp = narnia.endpoints.find((ep) => ep.id === 'sensor.narnia_connected_clients');
    assert.deepEqual(clientsEp?.readings.clients?.value, ['MacBook Pro', 'Apple TV']);

    const crawford = virtualizer.getDevice('ha:eero:crawford');
    assert.ok(crawford);
    assert.equal(crawford.category, 'network');
    const qrEp = crawford.endpoints.find((ep) => ep.id === 'image.crawford_qr_code');
    assert.ok(qrEp);
    assert.equal(qrEp.readings.content_type?.value, 'image/png');
    assert.equal(qrEp.readings.image_last_updated?.value, '2026-11-23T06:00:00+00:00');
  });

  it('dispatches official HA update.install (with version/backup), update.skip, and update.clear_skipped', async () => {
    const serviceCalls: HacsServiceCallPayload[] = [];
    const virtualizer = new HacsVirtualizer(undefined, async (call) => {
      serviceCalls.push(call);
    });
    virtualizer.handleEntityAdded({
      entityId: 'update.narnia_eero_firmware',
      integration: 'eero',
      domain: 'update',
      name: 'Narnia Firmware',
      state: 'on',
      deviceId: 'ha:eero:narnia',
      attributes: { installed_version: 'v7.5.1', latest_version: 'v7.6.0', supported_features: 27 },
    });

    await virtualizer.executeCommand({
      deviceId: 'ha:eero:narnia',
      endpointId: 'update.narnia_eero_firmware',
      capability: 'update',
      operation: 'install',
      value: true,
      parameters: { version: 'v7.6.0', backup: true },
    });
    await virtualizer.executeCommand({
      deviceId: 'ha:eero:narnia',
      endpointId: 'update.narnia_eero_firmware',
      capability: 'update',
      operation: 'skip',
      value: null,
    });
    await virtualizer.executeCommand({
      deviceId: 'ha:eero:narnia',
      endpointId: 'update.narnia_eero_firmware',
      capability: 'update',
      operation: 'clear_skipped',
      value: null,
    });

    assert.deepEqual(serviceCalls, [
      {
        domain: 'update',
        service: 'install',
        serviceData: {
          entity_id: 'update.narnia_eero_firmware',
          version: 'v7.6.0',
          backup: true,
        },
      },
      {
        domain: 'update',
        service: 'skip',
        serviceData: { entity_id: 'update.narnia_eero_firmware' },
      },
      {
        domain: 'update',
        service: 'clear_skipped',
        serviceData: { entity_id: 'update.narnia_eero_firmware' },
      },
    ]);
  });
});
