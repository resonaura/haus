/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { corners, pct, px, rgba } from '../../ir/geometry.js';
import { BackdropMaterial } from '../../ir/materials.js';
import type { UiStyleSpec } from '../../ir/node.js';

export const cameraPreviewCorners = corners(26);
export const cameraStageCorners = corners(20);

export const cameraPreviewMediaStyle: UiStyleSpec = {
  layout: { width: pct(100), height: pct(100) },
  corners: cameraPreviewCorners,
};

export const cameraStageMediaStyle: UiStyleSpec = {
  layout: { width: pct(100), height: pct(100) },
  corners: cameraStageCorners,
};

export const cameraStageBlurStyle: UiStyleSpec = {
  layout: {
    position: 'absolute',
    height: pct(36),
    inset: { bottom: px(0), left: px(0), right: px(0) },
  },
  corners: { ...cameraStageCorners, topLeft: 0, topRight: 0 },
};

export function cameraGlass(opacity: number) {
  return new BackdropMaterial(
    { blurRadius: 14, saturation: 1.1, tintColor: rgba(12, 12, 12, opacity) },
    { fallbackColor: rgba(16, 16, 18, 0.96) },
  );
}
