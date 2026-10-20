import { describe, expect, it } from 'vitest';
import { normalizeHome } from './index';
import { deviceTelemetryRegistry } from './device-telemetry';
import type { Snapshot } from './types';
import { kettleIdentityFixture } from './kettle.fixture';

describe('physical kettle identity', () => {
  it('groups the bridge with its exact Xiaomi source, retaining the room and every legacy entity without writes', () => {
    const snapshot = kettleIdentityFixture();
    const before = structuredClone(snapshot);
    const home = normalizeHome(snapshot);
    expect(home.accessories).toHaveLength(1);
    expect(home.accessories[0]).toMatchObject({
      deviceId: 'original',
      primaryEntityId: 'water_heater.bridge',
      areaId: 'kitchen',
    });
    expect(home.accessories[0].entityIds).toContain('water_heater.original');
    expect(snapshot).toEqual(before);
    snapshot.states[2].state = 'unavailable';
    expect(normalizeHome(snapshot).accessories[0].primaryEntityId).toBe('water_heater.bridge');
  });
  it('does not merge a similar name, different DID, conflicting explicit room or ambiguous device', () => {
    for (const change of [
      (s: Snapshot) => {
        s.devices[1].identifiers = [['mqtt', 'haus_kettle_456']];
      },
      (s: Snapshot) => {
        s.devices[1].area_id = 'living';
      },
      (s: Snapshot) => {
        s.entities[2].area_id = 'living';
      },
      (s: Snapshot) => {
        s.devices.push({ ...s.devices[1], id: 'another' });
      },
    ]) {
      const snapshot = kettleIdentityFixture();
      change(snapshot);
      expect(deviceTelemetryRegistry(snapshot).get('water_heater.bridge')?.device_id).toBe(
        'bridge',
      );
    }
  });
});
