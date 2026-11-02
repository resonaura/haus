/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

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
