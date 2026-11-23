/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { translateService } from '../commands';
import { buildView } from '../entities';
import { parseDevices, parseStates } from '../types';

describe('Hub compat view for Eero QR image.*, firmware update.*, and network telemetry', () => {
  const devices = parseDevices({
    devices: [
      {
        id: 'ha:eero1:crawford',
        name: 'Crawford',
        category: 'network',
        deviceType: 'router',
        manufacturer: 'eero',
        model: 'Network',
        availability: 'online',
        endpoints: [
          {
            id: 'image.crawford_qr_code',
            name: 'Crawford QR Code',
            capabilities: [{ id: 'image', kind: 'event', operations: [] }],
            sourceRefs: [
              {
                protocol: 'vendor',
                domain: 'ha_entity',
                entityId: 'image.crawford_qr_code',
                externalId: 'crawford-qr',
                metadata: { platform: 'eero', entityDomain: 'image' },
              },
            ],
          },
          {
            id: 'update.crawford_firmware',
            name: 'Crawford Firmware',
            capabilities: [
              { id: 'update', kind: 'update', operations: ['install', 'skip', 'clear_skipped'] },
            ],
            sourceRefs: [
              {
                protocol: 'vendor',
                domain: 'ha_entity',
                entityId: 'update.crawford_firmware',
                externalId: 'crawford-fw',
                metadata: { platform: 'eero', entityDomain: 'update' },
              },
            ],
          },
          {
            id: 'sensor.crawford_connected_clients',
            name: 'Connected Clients',
            capabilities: [{ id: 'value', kind: 'numeric', operations: [] }],
            sourceRefs: [
              {
                protocol: 'vendor',
                domain: 'ha_entity',
                entityId: 'sensor.crawford_connected_clients',
                externalId: 'crawford-clients',
                metadata: { platform: 'eero', entityDomain: 'sensor' },
              },
            ],
          },
        ],
      },
    ],
  });

  const states = parseStates({
    states: {
      'image.crawford_qr_code': {
        image: '2026-11-23T06:00:00Z',
        content_type: 'image/png',
        image_last_updated: '2026-11-23T06:00:00Z',
      },
      'update.crawford_firmware': {
        update: true,
        installed_version: 'v7.5.1',
        latest_version: 'v7.6.0',
        title: 'eeroOS',
        in_progress: false,
        update_percentage: null,
        auto_update: true,
        release_summary: '- Bug fixes',
        release_url: 'https://support.eero.com/releases',
        supported_features: 17,
      },
      'sensor.crawford_connected_clients': {
        value: 14,
        clients: ['iPhone', 'MacBook'],
      },
    },
  });

  it('maps image.*, update.*, and connected client attributes faithfully', () => {
    const view = buildView(devices, states, 'now');

    const qr = view.states.find((s) => s.entity_id.startsWith('image.'));
    expect(qr).toBeDefined();
    expect(qr?.attributes.content_type).toBe('image/png');
    expect(qr?.attributes.haus_ha_entity_id).toBe('image.crawford_qr_code');

    const fw = view.states.find((s) => s.entity_id.startsWith('update.'));
    expect(fw).toMatchObject({
      state: 'on',
      attributes: {
        installed_version: 'v7.5.1',
        latest_version: 'v7.6.0',
        title: 'eeroOS',
        auto_update: true,
        release_summary: '- Bug fixes',
        release_url: 'https://support.eero.com/releases',
        supported_features: 17,
        haus_ha_entity_id: 'update.crawford_firmware',
      },
    });

    const clients = view.states.find((s) => s.entity_id.startsWith('sensor.'));
    expect(clients?.attributes.clients).toEqual(['iPhone', 'MacBook']);
  });

  it('translates update.install (version/backup), update.skip, and update.clear_skipped services', () => {
    const view = buildView(devices, states, 'now');
    const fw = view.states.find((s) => s.entity_id.startsWith('update.'))!;

    expect(
      translateService(
        view.bindings,
        {
          domain: 'update',
          service: 'install',
          target: { entity_id: fw.entity_id },
          service_data: { version: 'v7.6.0', backup: true },
        },
        () => true,
      ),
    ).toEqual([
      {
        deviceId: 'ha:eero1:crawford',
        endpointId: 'update.crawford_firmware',
        capability: 'update',
        command: 'install',
        parameters: { version: 'v7.6.0', backup: true },
      },
    ]);

    expect(
      translateService(
        view.bindings,
        { domain: 'update', service: 'skip', target: { entity_id: fw.entity_id } },
        () => true,
      ),
    ).toEqual([
      {
        deviceId: 'ha:eero1:crawford',
        endpointId: 'update.crawford_firmware',
        capability: 'update',
        command: 'skip',
      },
    ]);

    expect(
      translateService(
        view.bindings,
        { domain: 'update', service: 'clear_skipped', target: { entity_id: fw.entity_id } },
        () => false,
      ),
    ).toEqual([
      {
        deviceId: 'ha:eero1:crawford',
        endpointId: 'update.crawford_firmware',
        capability: 'update',
        command: 'clear_skipped',
      },
    ]);
  });
});
