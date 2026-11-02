/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { deviceDisplayName } from './device-name';
import type { HausAccessory } from './types';

/** Domain names are a last resort: a router's primary entity is often a sensor. */
export function accessoryDisplayName(accessory: HausAccessory, room?: string) {
  const domain = accessory.primaryEntityId.split('.')[0];
  const fallback =
    accessory.category === 'network'
      ? [accessory.manufacturer, accessory.model]
          .filter(Boolean)
          .join(' ')
          .replace(/\beero\s+eero\b/gi, 'eero') || 'Router'
      : domain.charAt(0).toUpperCase() + domain.slice(1).replaceAll('_', ' ');
  return deviceDisplayName(accessory.name, room, fallback);
}
