/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { decodeCachedHomeSnapshot } from '@haus/core/hub';
import type { Snapshot } from './types.js';

/** Cached topology is readable context, never proof that a device is online. */
export function cachedHomeSnapshot(value: unknown): Snapshot | undefined {
  return decodeCachedHomeSnapshot<Snapshot>(value);
}
