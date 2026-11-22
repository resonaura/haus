/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "preprocess.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

#include "half.hpp"

namespace haus::icons {

namespace {

inline float colorDist3(const std::array<float, 3>& a, const std::array<float, 3>& b) noexcept {
  const float dr = a[0] - b[0];
  const float dg = a[1] - b[1];
  const float db = a[2] - b[2];
  return std::sqrt(dr * dr + dg * dg + db * db);
}

inline std::array<float, 3> straightRgbAt(const std::vector<uint8_t>& rgba, int idx) noexcept {
  const size_t off = static_cast<size_t>(idx) * 4;
  const float a = rgba[off + 3] / 255.0f;
  if (a <= 1e-4f) return {0.0f, 0.0f, 0.0f};
  const float inv = 1.0f / a;
  return {
      clamp01((rgba[off] / 255.0f) * inv),
      clamp01((rgba[off + 1] / 255.0f) * inv),
      clamp01((rgba[off + 2] / 255.0f) * inv),
  };
}

}  // namespace

/**
 * Separates a solid or smooth-gradient background plate from foreground brand artwork
 * on square/rounded-square icons, emitting both `foreground` RGBA and `solarium`
 * (tintable white relief mask) in one pass. Leaves photographic/complex icons unsegmented.
 */
SegmentedLayers segmentIconLayers(const PremulImage& analysisSource) {
  SegmentedLayers out;
  out.prepared = prepareLegacyIcon(analysisSource);
  if (!out.prepared.shouldSegment) return out;

  const auto& img = out.prepared.image;
  const int w = img.width;
  const int h = img.height;
  if (w < 12 || h < 12) return out;

  // 1. Sample interior-safe border band (inset by 1px to avoid AA corners) to fit background.
  const int inset = std::max(1, std::min(w, h) / 24);
  std::vector<std::array<float, 3>> borderSamples;
  std::vector<float> borderY;
  borderSamples.reserve(static_cast<size_t>((w + h) * 4));
  borderY.reserve(static_cast<size_t>((w + h) * 4));

  auto sampleBorderPixel = [&](int x, int y) {
    const int idx = y * w + x;
    if (img.rgba[static_cast<size_t>(idx) * 4 + 3] < 235) return;
    borderSamples.push_back(straightRgbAt(img.rgba, idx));
    borderY.push_back(static_cast<float>(y) / std::max(1, h - 1));
  };

  const int cornerSkip = std::max(2, static_cast<int>(std::min(w, h) * 0.24f));
  for (int x = cornerSkip; x < w - cornerSkip; ++x) {
    sampleBorderPixel(x, inset);
    sampleBorderPixel(x, h - 1 - inset);
  }
  for (int y = cornerSkip; y < h - cornerSkip; ++y) {
    sampleBorderPixel(inset, y);
    sampleBorderPixel(w - 1 - inset, y);
  }
  if (borderSamples.size() < 16) return out;

  // Fit vertical linear gradient bg(t) = top * (1 - t) + bottom * t via least squares.
  double sum1 = 0.0;
  double sumT = 0.0;
  double sumT2 = 0.0;
  std::array<double, 3> sumC{0.0, 0.0, 0.0};
  std::array<double, 3> sumTC{0.0, 0.0, 0.0};
  for (size_t i = 0; i < borderSamples.size(); ++i) {
    const double t = borderY[i];
    sum1 += 1.0;
    sumT += t;
    sumT2 += t * t;
    for (int c = 0; c < 3; ++c) {
      sumC[c] += borderSamples[i][c];
      sumTC[c] += t * borderSamples[i][c];
    }
  }
  const double det = sum1 * sumT2 - sumT * sumT;
  std::array<float, 3> bgTop{0.0f, 0.0f, 0.0f};
  std::array<float, 3> bgBot{0.0f, 0.0f, 0.0f};
  if (std::fabs(det) > 1e-6) {
    for (int c = 0; c < 3; ++c) {
      const double a0 = (sumT2 * sumC[c] - sumT * sumTC[c]) / det;
      const double a1 = (sum1 * sumTC[c] - sumT * sumC[c]) / det;
      bgTop[c] = clamp01(static_cast<float>(a0));
      bgBot[c] = clamp01(static_cast<float>(a0 + a1));
    }
  } else {
    for (int c = 0; c < 3; ++c) {
      bgTop[c] = bgBot[c] = clamp01(static_cast<float>(sumC[c] / sum1));
    }
  }

  auto bgAt = [&](int y) noexcept -> std::array<float, 3> {
    const float t = static_cast<float>(y) / std::max(1, h - 1);
    return {
        mixf(bgTop[0], bgBot[0], t),
        mixf(bgTop[1], bgBot[1], t),
        mixf(bgTop[2], bgBot[2], t),
    };
  };

  // Verify that >= 84% of border pixels closely match the fitted background gradient.
  int borderInliers = 0;
  for (size_t i = 0; i < borderSamples.size(); ++i) {
    const float t = borderY[i];
    const std::array<float, 3> expected{
        mixf(bgTop[0], bgBot[0], t),
        mixf(bgTop[1], bgBot[1], t),
        mixf(bgTop[2], bgBot[2], t),
    };
    if (colorDist3(borderSamples[i], expected) <= 0.095f) ++borderInliers;
  }
  if (static_cast<float>(borderInliers) / borderSamples.size() < 0.84f) return out;

  // 2. Classify pixels into foreground vs background and check foreground coherence.
  const int total = w * h;
  std::vector<float> distMap(static_cast<size_t>(total), 0.0f);
  std::array<double, 3> fgSum{0.0, 0.0, 0.0};
  int fgCount = 0;
  int bgCount = 0;
  for (int y = 0; y < h; ++y) {
    const auto bg = bgAt(y);
    for (int x = 0; x < w; ++x) {
      const int idx = y * w + x;
      if (img.rgba[static_cast<size_t>(idx) * 4 + 3] < 24) continue;
      const auto col = straightRgbAt(img.rgba, idx);
      const float d = colorDist3(col, bg);
      distMap[static_cast<size_t>(idx)] = d;
      if (d >= 0.14f) {
        ++fgCount;
        fgSum[0] += col[0];
        fgSum[1] += col[1];
        fgSum[2] += col[2];
      } else if (d <= 0.06f) {
        ++bgCount;
      }
    }
  }

  // Require clear foreground presence (2%..72% of tile) and meaningful background plate (>=20%).
  const float fgRatio = static_cast<float>(fgCount) / total;
  const float bgRatio = static_cast<float>(bgCount) / total;
  if (fgCount < 16 || fgRatio < 0.02f || fgRatio > 0.72f || bgRatio < 0.20f) return out;

  const std::array<float, 3> fgMean{
      static_cast<float>(fgSum[0] / fgCount),
      static_cast<float>(fgSum[1] / fgCount),
      static_cast<float>(fgSum[2] / fgCount),
  };
  const std::array<float, 3> bgMean{
      (bgTop[0] + bgBot[0]) * 0.5f,
      (bgTop[1] + bgBot[1]) * 0.5f,
      (bgTop[2] + bgBot[2]) * 0.5f,
  };
  if (colorDist3(fgMean, bgMean) < 0.14f) return out;

  // Measure foreground color variance to distinguish single-color vs multi-color icons.
  double fgVar = 0.0;
  float minLuma = 1.0f;
  float maxLuma = 0.0f;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      const int idx = y * w + x;
      if (distMap[static_cast<size_t>(idx)] < 0.14f) continue;
      const auto col = straightRgbAt(img.rgba, idx);
      const float d = colorDist3(col, fgMean);
      fgVar += static_cast<double>(d * d);
      const float luma = 0.2126f * col[0] + 0.7152f * col[1] + 0.0722f * col[2];
      minLuma = std::min(minLuma, luma);
      maxLuma = std::max(maxLuma, luma);
    }
  }
  const float fgVariance = static_cast<float>(fgVar / std::max(1, fgCount));
  const bool singleColorFg = fgVariance <= 0.015f;

  // 3. Unmix foreground RGBA & build solarium tintable relief layer.
  out.foreground.assign(static_cast<size_t>(total * 4), 0);
  out.solarium.assign(static_cast<size_t>(total * 4), 0);
  const float lumaRange = std::max(1e-4f, maxLuma - minLuma);
  const float solFloor = std::max(0.5f, 1.0f - std::min(0.5f / lumaRange, 1.6f) * lumaRange);

  for (int y = 0; y < h; ++y) {
    const auto bg = bgAt(y);
    const float singleSpan = std::max(0.14f, colorDist3(fgMean, bg));
    for (int x = 0; x < w; ++x) {
      const int idx = y * w + x;
      const size_t off = static_cast<size_t>(idx) * 4;
      const float srcA = img.rgba[off + 3] / 255.0f;
      if (srcA <= 1e-4f) continue;

      const auto col = straightRgbAt(img.rgba, idx);
      const float d = distMap[static_cast<size_t>(idx)];
      if (d <= 0.045f) continue;

      float alpha = 0.0f;
      std::array<float, 3> unmixed = col;
      if (singleColorFg) {
        const std::array<float, 3> dir{fgMean[0] - bg[0], fgMean[1] - bg[1], fgMean[2] - bg[2]};
        const float denom = dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2];
        const float proj = denom > 1e-6f
                               ? ((col[0] - bg[0]) * dir[0] + (col[1] - bg[1]) * dir[1] +
                                  (col[2] - bg[2]) * dir[2]) /
                                     denom
                               : d / singleSpan;
        alpha = clamp01(proj) * srcA;
        unmixed = fgMean;
      } else {
        // Smooth AA alpha ramp across [0.045 .. 0.16] color distance from background.
        alpha = clamp01((d - 0.045f) / 0.115f) * srcA;
        if (alpha > 0.05f && alpha < 0.99f) {
          for (int c = 0; c < 3; ++c) {
            unmixed[c] = clamp01((col[c] - bg[c] * (1.0f - alpha)) / alpha);
          }
        }
      }

      if (alpha <= 1e-4f) continue;
      const uint8_t aByte = toByte(alpha);
      out.foreground[off] = toByte(unmixed[0] * alpha);
      out.foreground[off + 1] = toByte(unmixed[1] * alpha);
      out.foreground[off + 2] = toByte(unmixed[2] * alpha);
      out.foreground[off + 3] = aByte;

      const float luma = 0.2126f * unmixed[0] + 0.7152f * unmixed[1] + 0.0722f * unmixed[2];
      const float rel = singleColorFg ? 1.0f : clamp01(1.0f - (maxLuma - luma) / lumaRange);
      const float bright = mixf(solFloor, 1.0f, rel);
      const uint8_t solByte = toByte(bright * alpha);
      out.solarium[off] = solByte;
      out.solarium[off + 1] = solByte;
      out.solarium[off + 2] = solByte;
      out.solarium[off + 3] = aByte;
    }
  }

  out.segmented = true;
  out.isSingleBranch = singleColorFg;
  out.foregroundColor = fgMean;
  out.backgroundColor = bgMean;
  return out;
}

}  // namespace haus::icons
