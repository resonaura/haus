/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  cameraPtzButtonIds as coreCameraPtzButtonIds,
  cameraPtzButtons as coreCameraPtzButtons,
  isHiddenCameraControl as coreIsHiddenCameraControl,
  type CameraPtzButtons as CoreCameraPtzButtons,
} from '@haus/core/transport';
import type { HassEntity } from '../../model';

export type CameraPtzButtons = CoreCameraPtzButtons<HassEntity>;

export function cameraPtzButtons(entities: HassEntity[]): CameraPtzButtons | undefined {
  return coreCameraPtzButtons(entities);
}

export function cameraPtzButtonIds(entities: HassEntity[]): Set<string> {
  return coreCameraPtzButtonIds(entities);
}

/** Hides internal transport/unsupported Aqara controls from the camera settings drawer. */
export function isHiddenCameraControl(entity: HassEntity): boolean {
  return coreIsHiddenCameraControl(entity);
}
