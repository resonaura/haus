import { expect, it } from 'vitest';
import { securityIcon } from './security-icon';
const state = (kind: string, value: string) => ({
  entity_id: 'binary_sensor.test',
  state: value,
  attributes: { device_class: kind },
  last_changed: '',
});
it('communicates open contacts, detected hazards and unknown states distinctly', () => {
  for (const kind of ['door', 'window', 'motion', 'vibration', 'moisture', 'smoke', 'tamper'])
    expect(securityIcon(state(kind, 'on'))).not.toBe(securityIcon(state(kind, 'off')));
  expect(securityIcon(state('door', 'on'))).toBe('door-open');
  expect(securityIcon(state('door', 'off'))).toBe('door-closed');
  expect(securityIcon(state('door', 'unavailable'))).toBe('unknown');
  expect(securityIcon({ ...state('', 'unlocked'), entity_id: 'lock.front' })).toBe('unlocked');
  expect(securityIcon({ ...state('', 'triggered'), entity_id: 'alarm_control_panel.home' })).toBe(
    'alert',
  );
});
