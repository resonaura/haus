/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatHostBatteryStatus,
  formatHostMetricsScope,
  formatHostOperatingSystem,
} from '@haus/core/transport';
import type { ServerHost } from './types';

export function hostOperatingSystem(host: ServerHost | null) {
  return formatHostOperatingSystem(host);
}

export function hostMetricsScope(host: ServerHost | null) {
  return formatHostMetricsScope(host);
}

export function hostBatteryStatus(battery: ServerHost['battery']) {
  return formatHostBatteryStatus(battery);
}
