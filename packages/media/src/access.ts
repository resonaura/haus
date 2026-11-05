/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHmac } from 'node:crypto';

export const cameraAccessKey = (
  key: string,
  id: string,
  camera: string,
  expiresAt: string | number,
) =>
  createHmac('sha256', key)
    .update(['camera-access-v1', id, camera, String(expiresAt)].join('\n'))
    .digest('hex');
