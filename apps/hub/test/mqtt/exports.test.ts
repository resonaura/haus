/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import type { HausDevice } from '@haus/core';
import { onOffCapability } from '@haus/core/device';
import { MqttExportsController } from '../../src/mqtt/exports.js';
import type { IPreferencesService } from '../../src/preferences/preferences.module.js';

const admin = { user: { clientId: 'admin-test', clientRole: 'admin' } };
const guest = { user: { clientId: 'guest-test', clientRole: 'guest' } };
const outlet: HausDevice = {
  id: 'outlet',
  name: 'Outlet',
  category: 'power',
  source: { instanceId: 'native', externalId: 'outlet' },
  connectivity: { protocol: 'virtual' },
  availability: 'online',
  endpoints: [{ id: 'power', name: 'Power', capabilities: [onOffCapability], readings: {} }],
};

describe('per device HA export', () => {
  it('reconciles revision conflicts and only changes the selected device', async () => {
    let current = { value: { mqttExportDevices: ['other'] }, revision: '1', updatedAt: 1 };
    const preferences: IPreferencesService = {
      async get() { return current; },
      async patch(revision, patch) {
        if (revision === '1') {
          current = { ...current, value: { mqttExportDevices: ['other', 'concurrent'] }, revision: '2' };
          return { ...current, conflict: true };
        }
        const ids = patch.mqttExportDevices;
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string'))
          throw Error('invalid test patch');
        current = { ...current, value: { mqttExportDevices: ids }, revision: '3' };
        return current;
      },
    };
    const controller = new MqttExportsController({ getDevice: (id) => id === outlet.id ? outlet : undefined }, preferences);
    expect(await controller.get(guest, outlet.id)).toEqual({ eligible: true, enabled: false });
    await expect(controller.set(guest, outlet.id, { enabled: true })).rejects.toMatchObject({ status: 403 });
    expect(await controller.set(admin, outlet.id, { enabled: true })).toEqual({ eligible: true, enabled: true });
    expect(current.value.mqttExportDevices).toEqual(['other', 'concurrent', 'outlet']);
    expect(await controller.set(admin, outlet.id, { enabled: false })).toEqual({ eligible: true, enabled: false });
    expect(current.value.mqttExportDevices).toEqual(['other', 'concurrent']);
  });

  it('prevents re-exporting an MQTT import', async () => {
    const imported: HausDevice = { ...outlet, connectivity: { protocol: 'mqtt' } };
    const controller = new MqttExportsController({ getDevice: () => imported }, {
      async get() { return { revision: '0', value: {}, updatedAt: 0 }; },
      async patch() { throw Error('ineligible device must not be persisted'); },
    });
    expect(await controller.get(guest, imported.id)).toEqual({ eligible: false, enabled: false });
    await expect(controller.set(admin, imported.id, { enabled: true })).rejects.toMatchObject({ status: 400 });
  });
});
