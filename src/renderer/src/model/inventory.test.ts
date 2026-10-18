import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome, type HassEntity } from './index';
import { buildInventory } from './inventory';
import { lightColor } from './light-color';

const entity = (
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({ entity_id, state, attributes, last_changed: '2026-10-17T18:00:00Z' });

describe('complete device inventory', () => {
  it('retains devices with no live state, no entities, or disabled entities without claiming they are online', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push(
      { id: 'empty', name: 'Bridge' },
      { id: 'disabled', name: 'Disabled plug' },
      { id: 'missing', name: 'Missing state' },
    );
    snapshot.entities.push(
      { entity_id: 'switch.disabled', device_id: 'disabled', disabled_by: 'user' },
      { entity_id: 'sensor.missing', device_id: 'missing' },
    );
    const inventory = buildInventory(snapshot, normalizeHome(snapshot).accessories);
    expect(inventory).toHaveLength(snapshot.devices.length);
    expect(inventory.find((d) => d.id === 'empty')?.status).toBe('no_entities');
    expect(inventory.find((d) => d.id === 'missing')?.status).toBe('no_entities');
    expect(inventory.find((d) => d.id === 'disabled')?.status).toBe('disabled');
  });

  it('keeps a diagnostic-only eero router, with status rather than reboot as its primary entity', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({
      id: 'router',
      name: 'Upstairs',
      manufacturer: 'eero',
      model: 'eero 6',
    });
    snapshot.entities.push(
      {
        entity_id: 'sensor.upstairs_status',
        device_id: 'router',
        platform: 'eero',
        entity_category: 'diagnostic',
      },
      {
        entity_id: 'button.upstairs_reboot',
        device_id: 'router',
        platform: 'eero',
        entity_category: 'config',
      },
    );
    snapshot.states.push(
      entity('sensor.upstairs_status', 'online'),
      entity('button.upstairs_reboot', 'unknown'),
    );
    const router = normalizeHome(snapshot).accessories.find((d) => d.deviceId === 'router');
    expect(router).toMatchObject({
      name: 'Upstairs',
      category: 'network',
      primaryEntityId: 'sensor.upstairs_status',
      capabilities: [],
    });
    expect(router?.entityIds).toContain('button.upstairs_reboot');
  });

  it('recognizes an IPP printer whose name does not contain the word printer and summarizes status, not ink', () => {
    const snapshot = createDemoSnapshot();
    snapshot.devices.push({ id: 'printer', name: 'XP-6100 Series', manufacturer: 'EPSON' });
    snapshot.entities.push(
      { entity_id: 'sensor.xp_6100', device_id: 'printer', platform: 'ipp' },
      { entity_id: 'sensor.xp_6100_black_ink', device_id: 'printer', platform: 'ipp' },
    );
    snapshot.states.push(
      entity('sensor.xp_6100', 'idle'),
      entity('sensor.xp_6100_black_ink', '70', { unit_of_measurement: '%' }),
    );
    expect(normalizeHome(snapshot).accessories.find((d) => d.deviceId === 'printer')).toMatchObject(
      { name: 'XP-6100 Series', category: 'printers', primaryEntityId: 'sensor.xp_6100' },
    );
  });

  it('does not issue a separate offline warning for every unavailable entity of the same device', () => {
    const snapshot = createDemoSnapshot();
    const lamp = snapshot.entities.find((e) => e.entity_id === 'light.corner_lamp')!;
    snapshot.entities.push({ entity_id: 'sensor.corner_extra', device_id: lamp.device_id });
    snapshot.states.push(entity('sensor.corner_extra', 'unavailable'));
    expect(
      normalizeHome(snapshot).attention.some((item) => item.entityId === 'sensor.corner_extra'),
    ).toBe(false);
    snapshot.states.find((e) => e.entity_id === 'light.corner_lamp')!.state = 'unavailable';
    expect(
      normalizeHome(snapshot).attention.filter((item) =>
        ['light.corner_lamp', 'sensor.corner_extra'].includes(item.entityId),
      ),
    ).toHaveLength(1);
  });
});

describe('factual light palette', () => {
  it('prioritizes the active temperature mode over a stale RGB value and does not invent a color for an on/off light', () => {
    expect(
      lightColor(
        entity('light.warm', 'on', {
          color_mode: 'color_temp',
          color_temp_kelvin: 2700,
          rgb_color: [0, 0, 255],
        }),
      ),
    ).toBe('rgb(255, 167, 87)');
    expect(lightColor(entity('light.relay', 'on'))).toBeUndefined();
    expect(lightColor(entity('switch.plug', 'on', { rgb_color: [255, 0, 0] }))).toBeUndefined();
  });
});
