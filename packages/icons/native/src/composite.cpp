/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "render.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

#include "half.hpp"
#include "sdf.hpp"

namespace haus::icons {

namespace {

constexpr float kDefaultCornerRadiusRatio = 266.24f / 1024.0f;

float evaluateSupersampledCoverage(
    int x,
    int y,
    float centerX,
    float centerY,
    float halfExtent,
    float cornerRadius) noexcept {
  const auto centerSdf = evaluateEnclosureSdf(
      x + 0.5f - centerX, y + 0.5f - centerY, halfExtent, halfExtent, cornerRadius);
  if (centerSdf.distance <= -1.2f) return 1.0f;
  if (centerSdf.distance >= 1.2f) return 0.0f;

  int inside = 0;
  for (int sy = 0; sy < 4; ++sy) {
    const float py = y + (sy + 0.5f) * 0.25f - centerY;
    for (int sx = 0; sx < 4; ++sx) {
      const float px = x + (sx + 0.5f) * 0.25f - centerX;
      if (evaluateEnclosureSdf(px, py, halfExtent, halfExtent, cornerRadius).distance <= 0.0f) {
        ++inside;
      }
    }
  }
  return inside * (1.0f / 16.0f);
}

}  // namespace

std::vector<uint8_t> maskOpaqueBodyCpp(
    const std::vector<float>& bodyFloat,
    int bodySize,
    int targetSize,
    float tileFraction) {
  const float effectiveTile = bodySize > 0 ? static_cast<float>(bodySize) : targetSize * tileFraction;
  const float halfExtent = effectiveTile * 0.5f;
  const float cornerRadius = kDefaultCornerRadiusRatio * effectiveTile;
  const float center = targetSize * 0.5f;
  const int offset = static_cast<int>(std::lround((targetSize - bodySize) * 0.5f));
  const int maxBody = std::max(0, bodySize - 1);

  std::vector<uint8_t> out(static_cast<size_t>(targetSize * targetSize * 4), 0);
  for (int y = 0; y < targetSize; ++y) {
    const int by = std::clamp(y - offset, 0, maxBody);
    for (int x = 0; x < targetSize; ++x) {
      const float cov = evaluateSupersampledCoverage(x, y, center, center, halfExtent, cornerRadius);
      if (cov <= 0.0f) continue;

      const int bx = std::clamp(x - offset, 0, maxBody);
      const size_t bIdx = static_cast<size_t>((by * bodySize + bx) * 4);
      const size_t idx = static_cast<size_t>((y * targetSize + x) * 4);
      out[idx] = toByte(bodyFloat[bIdx]);
      out[idx + 1] = toByte(bodyFloat[bIdx + 1]);
      out[idx + 2] = toByte(bodyFloat[bIdx + 2]);
      out[idx + 3] = toByte(cov);
    }
  }
  return out;
}

std::vector<uint8_t> compositeSemanticCpp(
    const uint8_t* semanticRgba,
    int width,
    int height,
    bool isTinted,
    bool isDark,
    const std::array<float, 3>& accentRgb,
    float tileFraction,
    int displaySize) {
  float plateR = 0.5f;
  float plateG = 0.5f;
  float plateB = 0.5f;
  float plateA = 0.42f;
  if (isTinted) {
    plateA = 1.0f;
    if (isDark) {
      plateR = plateG = plateB = 0.1f;
    } else {
      plateR = accentRgb[0];
      plateG = accentRgb[1];
      plateB = accentRgb[2];
    }
  } else if (isDark) {
    plateR = plateG = plateB = 0.17f;
    plateA = 0.72f;
  }

  const float side = static_cast<float>(std::min(width, height));
  const int bodySize = std::max(
      16, static_cast<int>(std::lround((side * tileFraction) / 2.0f)) * 2);
  const float halfExtent = bodySize * 0.5f;
  const float cornerRadius = kDefaultCornerRadiusRatio * bodySize;
  const float centerX = width * 0.5f;
  const float centerY = height * 0.5f;
  const float pixelScale = std::max(1.0f, side / std::max(1, displaySize));
  const int semMinX = (width - bodySize) / 2;
  const int semMinY = (height - bodySize) / 2;
  const int semMaxX = std::min(width - 1, semMinX + bodySize - 1);
  const int semMaxY = std::min(height - 1, semMinY + bodySize - 1);
  constexpr float kInv255 = 1.0f / 255.0f;

  std::vector<uint8_t> out(static_cast<size_t>(width * height * 4), 0);
  for (int y = 0; y < height; ++y) {
    const int sy = std::clamp(y, semMinY, semMaxY);
    for (int x = 0; x < width; ++x) {
      const auto centerSdf = evaluateEnclosureSdf(
          x + 0.5f - centerX, y + 0.5f - centerY, halfExtent, halfExtent, cornerRadius);
      if (centerSdf.distance >= 1.2f) continue;

      // Exact 1:1 semantic pixel lookup — zero interior bilinear blur.
      const int sx = std::clamp(x, semMinX, semMaxX);
      const size_t semIdx = static_cast<size_t>((sy * width + sx) * 4);
      const float semR = semanticRgba[semIdx] * kInv255;
      const float semG = semanticRgba[semIdx + 1] * kInv255;
      const float semB = semanticRgba[semIdx + 2] * kInv255;
      const float semA = semanticRgba[semIdx + 3] * kInv255;

      const float light = clamp01(semR);
      const float dark = clamp01((semA - semG) * 0.3f);
      const float fgA = clamp01(light + dark * (1.0f - light));
      float lightR = light;
      float lightG = light;
      float lightB = light;
      if (isTinted && isDark) {
        const float content = std::min(light, semB);
        lightR = accentRgb[0] * content + (light - content);
        lightG = accentRgb[1] * content + (light - content);
        lightB = accentRgb[2] * content + (light - content);
      }
      const float fgPremulR = lightR * (1.0f - dark);
      const float fgPremulG = lightG * (1.0f - dark);
      const float fgPremulB = lightB * (1.0f - dark);

      const bool isRimOrBoundary = centerSdf.distance > -(pixelScale * 4.0f + 2.0f);
      if (!isRimOrBoundary) {
        const float outA = clamp01(fgA + plateA * (1.0f - fgA));
        const float premulR = clamp01(fgPremulR + plateR * plateA * (1.0f - fgA));
        const float premulG = clamp01(fgPremulG + plateG * plateA * (1.0f - fgA));
        const float premulB = clamp01(fgPremulB + plateB * plateA * (1.0f - fgA));
        if (outA <= 0.0f) continue;
        const float invOutA = outA > 1e-5f ? 1.0f / outA : 0.0f;
        const size_t idx = static_cast<size_t>((y * width + x) * 4);
        out[idx] = toByte(premulR * invOutA);
        out[idx + 1] = toByte(premulG * invOutA);
        out[idx + 2] = toByte(premulB * invOutA);
        out[idx + 3] = toByte(outA);
        continue;
      }

      const int subFactor = centerSdf.distance > -1.2f ? 4 : 2;
      const float subStep = 1.0f / subFactor;
      const float invSub = 1.0f / (subFactor * subFactor);
      float linR = 0.0f;
      float linG = 0.0f;
      float linB = 0.0f;
      float sumA = 0.0f;
      for (int subY = 0; subY < subFactor; ++subY) {
        const float py = y + (subY + 0.5f) * subStep - centerY;
        for (int subX = 0; subX < subFactor; ++subX) {
          const float px = x + (subX + 0.5f) * subStep - centerX;
          const auto sdf = evaluateEnclosureSdf(px, py, halfExtent, halfExtent, cornerRadius);
          if (sdf.distance > 0.0f) continue;

          const float distInsidePts = std::max(0.0f, -sdf.distance) / pixelScale;
          const float rim = enclosureGlassRim(distInsidePts, sdf.normalY, 1.0f / pixelScale);
          const auto bg = enclosureRimComposite(plateR, plateG, plateB, rim, isDark);
          const float bgA = clamp01(plateA + (1.0f - plateA) * clamp01(rim * 0.65f));

          const float outA = clamp01(fgA + bgA * (1.0f - fgA));
          const float premulR = clamp01(fgPremulR + bg[0] * bgA * (1.0f - fgA));
          const float premulG = clamp01(fgPremulG + bg[1] * bgA * (1.0f - fgA));
          const float premulB = clamp01(fgPremulB + bg[2] * bgA * (1.0f - fgA));
          if (outA <= 0.0f) continue;
          const float invOutA = outA > 1e-5f ? 1.0f / outA : 0.0f;
          linR += srgbToLinear(premulR * invOutA) * outA;
          linG += srgbToLinear(premulG * invOutA) * outA;
          linB += srgbToLinear(premulB * invOutA) * outA;
          sumA += outA;
        }
      }
      const float avgA = sumA * invSub;
      if (avgA <= 0.0f) continue;
      const float invA = 1.0f / sumA;
      const size_t idx = static_cast<size_t>((y * width + x) * 4);
      out[idx] = toByte(linearToSrgb(linR * invA));
      out[idx + 1] = toByte(linearToSrgb(linG * invA));
      out[idx + 2] = toByte(linearToSrgb(linB * invA));
      out[idx + 3] = toByte(avgA);
    }
  }
  return out;
}

}  // namespace haus::icons
