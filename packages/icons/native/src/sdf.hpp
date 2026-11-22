/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

#include "half.hpp"

namespace haus::icons {

struct EnclosureSdfSample {
  float distance;
  float normalX;
  float normalY;
};

/** Analytical continuous-corner supercircle SDF (1:1 GNOME macosGlassShape). */
inline EnclosureSdfSample evaluateEnclosureSdf(
    float pointX,
    float pointY,
    float halfWidth,
    float halfHeight,
    float radius) noexcept {
  const float r = std::max(std::min(std::fabs(radius), std::min(halfWidth, halfHeight)), 0.0001f);
  const float extent = r * 1.5286649465560913f;
  const float blendX = clamp01((halfWidth / r - 1.52866f) / -0.52866f);
  const float blendY = clamp01((halfHeight / r - 1.52866f) / -0.52866f);
  const float normalExtent = mixf(extent, r, std::max(blendX, blendY));
  const float absX = std::fabs(pointX);
  const float absY = std::fabs(pointY);
  const float cornerX = absX - halfWidth + normalExtent;
  const float cornerY = absY - halfHeight + normalExtent;
  const float qx = std::max((absX - halfWidth + extent) / extent, 0.0f);
  const float qy = std::max((absY - halfHeight + extent) / extent, 0.0f);
  const float major = std::max(qx, qy);
  const float minor = std::min(qx, qy);
  const float t = major > 0.0f ? clamp01(minor / major) : 0.0f;
  const float polynomial =
      (((3.1560099124908447f - t * 0.9260540008544922f) * t - 3.6412200927734375f) * t +
       1.268030047416687f) *
          t +
      0.2685309946537018f;
  const float magnitude = std::hypot(qx, qy);
  const float continuous = magnitude + 1.0f - 1.0f / (1.0f - t * t * clamp01(magnitude) * polynomial);
  const float circX = std::max(qx * 1.5286649465560913f - 0.5286650061607361f, 0.0f);
  const float circY = std::max(qy * 1.5286649465560913f - 0.5286650061607361f, 0.0f);
  const float circular = std::hypot(circX, circY) * 0.6541655659675598f + 0.3458344340324402f;
  const float orientation = qy > qx ? 1.0f : -1.0f;
  const float weight = clamp01(0.5f - orientation + orientation * t);
  const float distX = mixf(continuous, circular, blendX);
  const float distY = mixf(continuous, circular, blendY);
  const float distance =
      (mixf(distX, distY, weight) - 1.0f) * extent + std::min(std::max(cornerX, cornerY), 0.0f);

  float nx = std::max(cornerX, 0.0f);
  float ny = std::max(cornerY, 0.0f);
  const float normalLen = std::hypot(nx, ny);
  if (normalLen > 0.0f) {
    nx /= normalLen;
    ny /= normalLen;
  } else if (cornerX > cornerY) {
    nx = 1.0f;
    ny = 0.0f;
  } else {
    nx = 0.0f;
    ny = 1.0f;
  }
  const float signX = pointX > 0.0f ? 1.0f : (pointX < 0.0f ? -1.0f : 0.0f);
  const float signY = pointY > 0.0f ? 1.0f : (pointY < 0.0f ? -1.0f : 0.0f);
  return {distance, nx * signX, ny * signY};
}

inline float enclosureRimBand(
    float distanceInside,
    float height,
    float curvature,
    float angular,
    float amount,
    float aaWidth) noexcept {
  const float x = clamp01(distanceInside / height);
  const float falloff = mixf(x < 1.0f ? 1.0f : 0.0f, 1.0f - x, curvature);
  const float coverage =
      clamp01(distanceInside / aaWidth + 0.5f) * clamp01((height - distanceInside) / aaWidth + 0.5f);
  const float a = falloff * coverage * angular;
  const float bias = 1.0f / amount - 2.0f;
  return a / std::max(1.0f + bias * (1.0f - a), 0.0001f);
}

/** Dual-opposing specular + diffuse glass rim (1:1 GNOME macosGlassRim). */
inline float enclosureGlassRim(float distanceInside, float outwardNormalY, float aaWidth) noexcept {
  constexpr float kHeight = 1.0f;
  constexpr float kAmount = 0.5f;
  constexpr float kSpread = 1.523526992886717f;
  constexpr float kDiffuseHeightScale = 8.0f;
  constexpr float kDiffuseAmountScale = 0.15000000596046448f;
  constexpr float kDiffuseSpreadScale = 0.6499999761581421f;
  constexpr float kCurvature = 0.75f;

  const float facing = std::fabs(outwardNormalY);
  const float spread = std::cos(kSpread);
  const float diffuseSpread = std::cos(kSpread * kDiffuseSpreadScale);
  const float angular = clamp01((facing - spread) / (1.0f - spread));
  const float diffuseAngular = clamp01((facing - diffuseSpread) / (1.0f - diffuseSpread));
  const float aa = std::max(aaWidth, 0.0001f);
  return enclosureRimBand(distanceInside, kHeight, kCurvature, angular, kAmount, aa) +
         enclosureRimBand(
             distanceInside,
             kHeight * kDiffuseHeightScale,
             1.0f,
             diffuseAngular,
             kAmount * kDiffuseAmountScale,
             aa);
}

/** Vibrancy-aware rim color composite (1:1 GNOME macosGlassRimComposite). */
inline std::array<float, 3> enclosureRimComposite(
    float r,
    float g,
    float b,
    float intensity,
    bool isDark) noexcept {
  const float darkR = r * 1.09375f + g * -0.357666015625f + b * -0.0360107421875f + 0.25f;
  const float darkG = r * -0.1063232421875f + g * 0.84228515625f + b * -0.036102294921875f + 0.25f;
  const float darkB = r * -0.10638427734375f + g * -0.357421875f + b * 1.1640625f + 0.25f;

  const float lightR =
      r * 1.2626953125f + g * -0.238525390625f + b * -0.0240020751953125f + 0.199951171875f;
  const float lightG =
      r * -0.07080078125f + g * 1.0947265625f + b * -0.0240936279296875f + 0.199951171875f;
  const float lightB =
      r * -0.0709228515625f + g * -0.23828125f + b * 1.3095703125f + 0.199951171875f;

  const float t = isDark ? 1.0f : 0.0f;
  auto clampHdr = [](float v) noexcept { return std::min(1.0f, std::max(-0.75f, v)); };
  const float rimR = clampHdr(mixf(lightR, darkR, t));
  const float rimG = clampHdr(mixf(lightG, darkG, t));
  const float rimB = clampHdr(mixf(lightB, darkB, t));
  return {
      clamp01(mixf(r, rimR, intensity)),
      clamp01(mixf(g, rimG, intensity)),
      clamp01(mixf(b, rimB, intensity)),
  };
}

/** Felzenszwalb & Huttenlocher exact O(n) 1D squared Euclidean Distance Transform. */
inline void edt1d(
    const float* f,
    float* d,
    int n,
    std::vector<int>& v,
    std::vector<float>& z) {
  int k = 0;
  v[0] = 0;
  z[0] = -1e20f;
  z[1] = 1e20f;
  for (int q = 1; q < n; ++q) {
    float s = ((f[q] + static_cast<float>(q * q)) - (f[v[k]] + static_cast<float>(v[k] * v[k]))) /
              static_cast<float>(2 * (q - v[k]));
    while (s <= z[k]) {
      --k;
      s = ((f[q] + static_cast<float>(q * q)) - (f[v[k]] + static_cast<float>(v[k] * v[k]))) /
          static_cast<float>(2 * (q - v[k]));
    }
    ++k;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20f;
  }
  k = 0;
  for (int q = 0; q < n; ++q) {
    while (z[k + 1] < static_cast<float>(q)) ++k;
    const float dx = static_cast<float>(q - v[k]);
    d[q] = dx * dx + f[v[k]];
  }
}

struct ContourField {
  int width = 0;   // bodyW + 2
  int height = 0;  // bodyH + 2
  float maxDistance = 0.0f;
  // Packed RGBA float32: [0] normalized signed distance (0.5 = edge, <0.5 = inside), [1] nx01, [2] ny01, [3] 1.
  std::vector<float> pixels;
};

/** Exact O(W*H) 2D signed Euclidean distance + contour normal field (matching contour.ts layout). */
inline ContourField buildContourField(const std::vector<float>& bodyAlpha, int bodyW, int bodyH) {
  const int w = bodyW + 2;
  const int h = bodyH + 2;
  const float maxDistance = static_cast<float>(std::min(bodyW, bodyH)) * 0.2f;
  const float invRange = maxDistance > 1e-4f ? 1.0f / (2.0f * maxDistance) : 1.0f;
  constexpr float kInf = 1e12f;

  std::vector<float> alpha(static_cast<size_t>(w * h), 0.0f);
  for (int y = 0; y < bodyH; ++y) {
    for (int x = 0; x < bodyW; ++x) {
      alpha[static_cast<size_t>((y + 1) * w + (x + 1))] =
          clamp01(bodyAlpha[static_cast<size_t>(y * bodyW + x)]);
    }
  }

  std::vector<float> outGrid(static_cast<size_t>(w * h), kInf);
  std::vector<float> inGrid(static_cast<size_t>(w * h), kInf);
  for (int i = 0; i < w * h; ++i) {
    const float a = alpha[static_cast<size_t>(i)];
    if (a >= 0.5f) {
      // Seed for outside distance: distance to solid interior.
      outGrid[static_cast<size_t>(i)] = 0.0f;
    } else {
      // Seed for inside distance: distance to transparent exterior.
      inGrid[static_cast<size_t>(i)] = 0.0f;
    }
  }

  auto runEdt2d = [&](std::vector<float>& grid) {
    const int maxDim = std::max(w, h);
    std::vector<float> f(static_cast<size_t>(maxDim));
    std::vector<float> d(static_cast<size_t>(maxDim));
    std::vector<int> v(static_cast<size_t>(maxDim));
    std::vector<float> z(static_cast<size_t>(maxDim + 1));

    for (int x = 0; x < w; ++x) {
      for (int y = 0; y < h; ++y) f[static_cast<size_t>(y)] = grid[static_cast<size_t>(y * w + x)];
      edt1d(f.data(), d.data(), h, v, z);
      for (int y = 0; y < h; ++y) grid[static_cast<size_t>(y * w + x)] = d[static_cast<size_t>(y)];
    }
    for (int y = 0; y < h; ++y) {
      for (int x = 0; x < w; ++x) f[static_cast<size_t>(x)] = grid[static_cast<size_t>(y * w + x)];
      edt1d(f.data(), d.data(), w, v, z);
      for (int x = 0; x < w; ++x) grid[static_cast<size_t>(y * w + x)] = std::sqrt(d[static_cast<size_t>(x)]);
    }
  };

  runEdt2d(outGrid);
  runEdt2d(inGrid);

  std::vector<float> signedDist(static_cast<size_t>(w * h), 0.0f);
  for (int i = 0; i < w * h; ++i) {
    const float a = alpha[static_cast<size_t>(i)];
    const float dOut = outGrid[static_cast<size_t>(i)];
    const float dIn = inGrid[static_cast<size_t>(i)];
    // Subpixel edge adjustment from antialiased alpha at boundary pixels.
    float sd = 0.0f;
    if (dOut <= 0.0f && dIn > 0.0f) {
      sd = -(dIn - 0.5f) - (a - 0.5f);
    } else if (dIn <= 0.0f && dOut > 0.0f) {
      sd = (dOut - 0.5f) + (0.5f - a);
    } else {
      sd = 0.5f - a;
    }
    signedDist[static_cast<size_t>(i)] = sd;
  }

  ContourField field;
  field.width = w;
  field.height = h;
  field.maxDistance = maxDistance;
  field.pixels.resize(static_cast<size_t>(w * h * 4), 0.0f);

  for (int y = 0; y < h; ++y) {
    const int ym = std::max(0, y - 1);
    const int yp = std::min(h - 1, y + 1);
    for (int x = 0; x < w; ++x) {
      const int xm = std::max(0, x - 1);
      const int xp = std::min(w - 1, x + 1);
      const float sd = signedDist[static_cast<size_t>(y * w + x)];
      // Outward gradient of signed distance (positive outward).
      const float gx =
          (signedDist[static_cast<size_t>(ym * w + xp)] +
           2.0f * signedDist[static_cast<size_t>(y * w + xp)] +
           signedDist[static_cast<size_t>(yp * w + xp)]) -
          (signedDist[static_cast<size_t>(ym * w + xm)] +
           2.0f * signedDist[static_cast<size_t>(y * w + xm)] +
           signedDist[static_cast<size_t>(yp * w + xm)]);
      const float gy =
          (signedDist[static_cast<size_t>(yp * w + xm)] +
           2.0f * signedDist[static_cast<size_t>(yp * w + x)] +
           signedDist[static_cast<size_t>(yp * w + xp)]) -
          (signedDist[static_cast<size_t>(ym * w + xm)] +
           2.0f * signedDist[static_cast<size_t>(ym * w + x)] +
           signedDist[static_cast<size_t>(ym * w + xp)]);
      const float len = std::hypot(gx, gy);
      // Inward normal stored as (1 - 2*packed) in contour.ts => packed = 0.5 + 0.5 * outward.
      const float ox = len > 1e-5f ? gx / len : 0.0f;
      const float oy = len > 1e-5f ? gy / len : 0.0f;

      const size_t idx = static_cast<size_t>((y * w + x) * 4);
      field.pixels[idx] = clamp01(0.5f + sd * invRange);
      field.pixels[idx + 1] = clamp01(0.5f + 0.5f * ox);
      field.pixels[idx + 2] = clamp01(0.5f + 0.5f * oy);
      field.pixels[idx + 3] = 1.0f;
    }
  }
  return field;
}

}  // namespace haus::icons
