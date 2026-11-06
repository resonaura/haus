/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HapCharacteristicDefinition } from '../hap.js';
import { HAP_CHARACTERISTICS_PART1 } from './part1.js';
import { HAP_CHARACTERISTICS_PART2 } from './part2.js';
import { HAP_CHARACTERISTICS_PART3 } from './part3.js';
import { HAP_CHARACTERISTICS_PART4 } from './part4.js';
import { HAP_CHARACTERISTICS_PART5 } from './part5.js';

/** Complete HAP Characteristic Registry (252 characteristics). */
export const HAP_CHARACTERISTICS: Record<string, HapCharacteristicDefinition> = {
  ...HAP_CHARACTERISTICS_PART1,
  ...HAP_CHARACTERISTICS_PART2,
  ...HAP_CHARACTERISTICS_PART3,
  ...HAP_CHARACTERISTICS_PART4,
  ...HAP_CHARACTERISTICS_PART5,
};
