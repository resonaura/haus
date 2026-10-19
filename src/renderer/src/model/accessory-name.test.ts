import { expect, it } from 'vitest';
import { accessoryDisplayName } from './accessory-name';
import type { HausAccessory } from './types';
it('uses the physical router model when its name is only the room', () => {
  const router = {
    name: 'Narnia',
    category: 'network',
    primaryEntityId: 'sensor.narnia_status',
    manufacturer: 'eero',
    model: 'eero 6',
  } as HausAccessory;
  expect(accessoryDisplayName(router, 'Narnia')).toBe('eero 6');
  expect(accessoryDisplayName({ ...router, name: 'Narnia Gateway' }, 'Narnia')).toBe('Gateway');
  expect(accessoryDisplayName({ ...router, manufacturer: null, model: null }, 'Narnia')).toBe(
    'Router',
  );
});
