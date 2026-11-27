/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCameraMovePreferencePatch,
  CAMERA_ORDER_SCOPE,
  cameraOrderPatch,
  moveCamera,
  orderCameras,
} from '../src/view/room-devices.js';
import { defaults } from '../src/view/preferences.js';

describe('Hub-synced camera dashboard ordering', () => {
  it('orders cameras by saved order and appends newly discovered cameras cleanly', () => {
    const cameras = [
      { id: 'camera.front_door' },
      { id: 'camera.living_room' },
      { id: 'camera.outdoor_side' },
    ];
    const ordered = orderCameras(cameras, ['camera.outdoor_side', 'camera.front_door']);
    expect(ordered.map((c) => c.id)).toEqual([
      'camera.outdoor_side',
      'camera.front_door',
      'camera.living_room',
    ]);
  });

  it('moves visible cameras without disturbing hidden cameras and produces Hub preference patches', () => {
    const allIds = ['camera.a', 'camera.hidden', 'camera.b', 'camera.c'];
    const visibleIds = ['camera.a', 'camera.b', 'camera.c'];

    const reorderedVisible = moveCamera(visibleIds, 'camera.c', 'camera.b');
    expect(cameraOrderPatch([], allIds, reorderedVisible)).toEqual([
      'camera.a',
      'camera.hidden',
      'camera.c',
      'camera.b',
    ]);

    const patch = buildCameraMovePreferencePatch(defaults, allIds, visibleIds, 'camera.a', 1);
    expect(patch?.deviceOrder?.[CAMERA_ORDER_SCOPE]).toEqual([
      'camera.b',
      'camera.hidden',
      'camera.a',
      'camera.c',
    ]);
  });
});
