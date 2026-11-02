/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { expect, it } from 'vitest';
import { deviceDisplayName } from './device-name';
it('removes assigned room prefixes without changing other words or emptying a title', () => {
  expect(deviceDisplayName('Bedroom Bed Lamp', 'Bedroom')).toBe('Bed Lamp');
  expect(deviceDisplayName('bedroom — Ceiling Lamp 2', 'Bedroom')).toBe('Ceiling Lamp 2');
  expect(deviceDisplayName('Bedroom Bedroom Temperature', 'Bedroom')).toBe('Temperature');
  expect(deviceDisplayName('Hallway Light', 'Hall')).toBe('Hallway Light');
  expect(deviceDisplayName('Office (2): Printer', 'Office (2)')).toBe('Printer');
  expect(deviceDisplayName('Bedroom', 'Bedroom', 'Light')).toBe('Light');
  expect(deviceDisplayName('Sonos — Living Room', 'Living Room')).toBe('Sonos');
  expect(deviceDisplayName('Outdoor Camera', 'Bedroom')).toBe('Outdoor Camera');
  expect(deviceDisplayName('Guinea Pigs (hue)', 'Guinea Pigs', 'Light')).toBe('Room');
  expect(deviceDisplayName('(HuE)', undefined, 'Light')).toBe('Room');
  expect(deviceDisplayName('Bedroom (hue) Bed Lamp', 'Bedroom')).toBe('Bed Lamp');
});
