/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export * from './appearance.js';
export * from './squircle.js';
export {
  APP_ICON_METRICS,
  ENCLOSURE_RIM,
  ICON_RENDERING_PARAMETERS,
  type IconSizeClass,
} from './engine/parameters.js';
export {
  float16Bits,
  float16Value,
  half,
  halfFma,
  premultipliedIconPixels,
} from './engine/math.js';
export { decodeBase64Bytes } from './engine/decode-lut.js';
export { ICON_COLOR_TRANSFER_BITS } from './engine/transfer-table.js';
export { SEGMENTATION_CHI2_CDF } from './engine/chi2-table.js';
export {
  ICON_CUBIC_WEIGHTS,
  ICON_DISTANCE_LUT_BITS,
  ICON_DITHER_NOISE_RGB,
} from './engine/luts.js';
export {
  DARK_BACKGROUND,
  chooseDarkIconColor,
  iconContrastRatio,
  iconSRGBTransfer,
} from './engine/color.js';
export { iconContourLightSettings, iconGlassHighlight } from './engine/contour.js';
export { categorizeIconShape, detectIconShape, standardIconCornerRadius } from './engine/shape.js';
export {
  generateLegacyIconLayers,
  prepareLegacyIcon,
  type GeneratedLegacyIconLayers,
  type PreparedLegacyIcon,
} from './engine/layers.js';
export {
  createClearGlyphMaterial,
  createLegacyColorPresentation,
  createSemanticGlyphPresentation,
  fitIconSource,
} from './engine/presentation.js';
export {
  compositeSemanticPresentation,
  enclosureGlassRim,
  enclosureRimComposite,
  evaluateEnclosureSdf,
  maskOpaqueColorPresentation,
  renderAllBaseLayers,
  renderEnclosureTileToRgba,
  type EnclosureSdfSample,
  type RenderedAllBaseLayers,
} from './engine/enclosure.js';
