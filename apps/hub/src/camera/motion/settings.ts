/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

// Includes inference and cluster polling; retain matching pre-event ring media.
export const MAX_ASSIST_DELAY_MS = 30_000;

export type MotionDetectionMode = 'objects' | 'motion';

export interface MotionDetectionSettings {
  enabled: boolean;
  mode: MotionDetectionMode;
}

export function motionSettings(value: unknown): MotionDetectionSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_motion_detection');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !['enabled', 'mode'].includes(key)) ||
    typeof record.enabled !== 'boolean' ||
    (record.mode !== 'objects' && record.mode !== 'motion')
  ) {
    throw new Error('invalid_motion_detection');
  }
  return { enabled: record.enabled, mode: record.mode };
}
