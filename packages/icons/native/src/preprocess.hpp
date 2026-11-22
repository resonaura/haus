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

struct PremulImage {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> rgba;
};

struct PreparedIcon {
  PremulImage image;
  bool isFill = false;
  bool shouldSegment = false;
  float scale = 1.0f;
};

struct SegmentedLayers {
  PreparedIcon prepared;
  bool segmented = false;
  bool isSingleBranch = false;
  std::vector<uint8_t> foreground;
  std::vector<uint8_t> solarium;
  std::array<float, 3> foregroundColor{1.0f, 1.0f, 1.0f};
  std::array<float, 3> backgroundColor{0.0f, 0.0f, 0.0f};
};

PremulImage mipmap2x2(const PremulImage& src);
PremulImage downsampleForAnalysis(const uint8_t* rgba, int width, int height, int maxDim = 256);
PreparedIcon prepareLegacyIcon(const PremulImage& src);

/** High-quality bicubic fit into float RGBA [0..1] premultiplied buffer (width * height * 4). */
std::vector<float> fitIconSourceCubic(
    const uint8_t* srcRgba,
    int srcW,
    int srcH,
    int dstW,
    int dstH,
    float scale,
    bool maskEdges);

SegmentedLayers segmentIconLayers(const PremulImage& analysisSource);

}  // namespace haus::icons
