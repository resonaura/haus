/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace haus::icons {

struct AllBaseLayersOutput {
  int width = 0;
  int height = 0;
  int bodySize = 0;
  bool isFill = false;
  bool segmented = false;
  std::vector<uint8_t> defaultRgba;
  std::vector<uint8_t> darkRgba;
  std::vector<uint8_t> clearSemanticRgba;
  std::vector<uint8_t> tintedSemanticRgba;
};

std::vector<uint8_t> maskOpaqueBodyCpp(
    const std::vector<float>& bodyFloat,
    int bodySize,
    int targetSize,
    float tileFraction);

AllBaseLayersOutput renderAllBaseLayersCpp(
    const uint8_t* sourcePremulRgba,
    int sourceWidth,
    int sourceHeight,
    int targetSize,
    float tileFraction);

std::vector<uint8_t> compositeSemanticCpp(
    const uint8_t* semanticRgba,
    int width,
    int height,
    bool isTinted,
    bool isDark,
    const std::array<float, 3>& accentRgb,
    float tileFraction,
    int displaySize);

}  // namespace haus::icons
