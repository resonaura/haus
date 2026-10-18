import { describe, expect, it } from 'vitest';
import { createDemoSnapshot, normalizeHome } from './index';
import { homeControls, stableQuickControls } from './home-controls';

function homeWithLampPower() {
  const snapshot = createDemoSnapshot();
  const lampEntry = snapshot.entities.find((item) => item.entity_id === 'light.corner_lamp')!;
  snapshot.entities.push({
    entity_id: 'light.corner_lamp_power_switch',
    device_id: lampEntry.device_id,
  });
  snapshot.states.push({
    entity_id: 'light.corner_lamp_power_switch',
    state: 'on',
    attributes: { friendly_name: 'Corner lamp power switch', supported_color_modes: ['onoff'] },
    last_changed: '',
  });
  return normalizeHome(snapshot);
}

describe('home quick controls stay grouped by device', () => {
  it('keeps visible quick controls in place as use counts change, while filling a removed tile', () => {
    const model = homeWithLampPower();
    const a = model.accessories.find((item) => item.primaryEntityId === 'light.corner_lamp')!;
    const b = model.accessories.find((item) => item.primaryEntityId === 'switch.reading_nook')!;
    expect(stableQuickControls([a.id, b.id], [b, a], [a, b]).map((item) => item.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(stableQuickControls([a.id, b.id], [b], [b]).map((item) => item.id)).toEqual([b.id]);
  });
  it('shows a lamp once when both its light and power control have history', () => {
    const model = homeWithLampPower();
    const result = homeControls(model.accessories, [], {
      'light.corner_lamp': { count: 3, lastUsed: 10 },
      'light.corner_lamp_power_switch': { count: 8, lastUsed: 20 },
    });
    expect(result.controls.map((item) => item.primaryEntityId)).toEqual(['light.corner_lamp']);
    expect(result.controls[0].secondaryEntities.map((item) => item.entity_id)).toContain(
      'light.corner_lamp_power_switch',
    );
    expect(result.controls[0]).toBe(
      model.accessories.find((item) => item.primaryEntityId === 'light.corner_lamp'),
    );
  });

  it('counts secondary-control use toward the parent device ranking', () => {
    const model = homeWithLampPower();
    const result = homeControls(model.accessories, [], {
      'light.corner_lamp_power_switch': { count: 8, lastUsed: 20 },
      'switch.reading_nook': { count: 5, lastUsed: 30 },
    });
    expect(result.controls.map((item) => item.primaryEntityId)).toEqual([
      'light.corner_lamp',
      'switch.reading_nook',
    ]);
  });

  it('resolves a pinned secondary control to the whole device', () => {
    const model = homeWithLampPower();
    const result = homeControls(
      model.accessories,
      ['light.corner_lamp', 'light.corner_lamp_power_switch'],
      {},
    );
    expect(result.usingFavorites).toBe(true);
    expect(result.controls.map((item) => item.primaryEntityId)).toEqual(['light.corner_lamp']);
  });
});
