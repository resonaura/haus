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

namespace haus::icons {

inline float clamp01(float v) noexcept {
  return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

inline float mixf(float a, float b, float t) noexcept {
  return a + (b - a) * t;
}

inline float srgbToLinear(float v) noexcept {
  const float c = clamp01(v);
  return c <= 0.04045f ? c / 12.92f : std::pow((c + 0.055f) / 1.055f, 2.4f);
}

inline float linearToSrgb(float v) noexcept {
  const float c = clamp01(v);
  return c <= 0.0031308f ? c * 12.92f : 1.055f * std::pow(c, 1.0f / 2.4f) - 0.055f;
}

inline uint8_t toByte(float v) noexcept {
  return static_cast<uint8_t>(std::lround(clamp01(v) * 255.0f));
}

/** Exact IEEE-754 float16 rounding to match GNOME half-precision shaders. */
inline float roundHalf(float value) noexcept {
  if (!std::isfinite(value)) return value;
  if (value == 0.0f) return 0.0f;
  const float sign = value < 0.0f ? -1.0f : 1.0f;
  const float a = std::fabs(value);
  if (a >= 65504.0f) return sign * 65504.0f;
  if (a < 6.103515625e-5f) {
    return sign * std::round(a / 5.960464477539063e-8f) * 5.960464477539063e-8f;
  }
  int exp = 0;
  const float mant = std::frexp(a, &exp);
  const float scaled = std::round(mant * 2048.0f) / 2048.0f;
  return sign * std::ldexp(scaled, exp);
}

inline float halfFma(float a, float b, float c) noexcept {
  return roundHalf(std::fma(roundHalf(a), roundHalf(b), roundHalf(c)));
}

inline float halfMix(float a, float b, float t) noexcept {
  const float ha = roundHalf(a);
  const float hb = roundHalf(b);
  const float ht = roundHalf(t);
  return halfFma(ht, hb, halfFma(-ht, ha, ha));
}

inline float relativeLuminance(const std::array<float, 3>& rgb) noexcept {
  return 0.2126f * srgbToLinear(rgb[0]) +
         0.7152f * srgbToLinear(rgb[1]) +
         0.0722f * srgbToLinear(rgb[2]);
}

inline float contrastRatio(const std::array<float, 3>& a, const std::array<float, 3>& b) noexcept {
  const float la = relativeLuminance(a);
  const float lb = relativeLuminance(b);
  const float hi = std::max(la, lb);
  const float lo = std::min(la, lb);
  return (hi + 0.05f) / (lo + 0.05f);
}

struct RgbResult {
  std::array<float, 3> color;
  bool success;
};

inline constexpr std::array<float, 3> kDarkBackground{
    0.09019607843137255f,
    0.09019607843137255f,
    0.09019607843137255f,
};

inline std::array<float, 3> rgbToHsl(const std::array<float, 3>& rgb) noexcept {
  const float r = clamp01(rgb[0]);
  const float g = clamp01(rgb[1]);
  const float b = clamp01(rgb[2]);
  const float maxC = std::max({r, g, b});
  const float minC = std::min({r, g, b});
  const float l = (maxC + minC) * 0.5f;
  const float d = maxC - minC;
  if (d <= 1e-6f) return {0.0f, 0.0f, l};
  const float s = l > 0.5f ? d / (2.0f - maxC - minC) : d / (maxC + minC);
  float h = 0.0f;
  if (maxC == r) h = (g - b) / d + (g < b ? 6.0f : 0.0f);
  else if (maxC == g) h = (b - r) / d + 2.0f;
  else h = (r - g) / d + 4.0f;
  return {h / 6.0f, s, l};
}

inline std::array<float, 3> hslToRgb(const std::array<float, 3>& hsl) noexcept {
  const float h = hsl[0] - std::floor(hsl[0]);
  const float s = clamp01(hsl[1]);
  const float l = clamp01(hsl[2]);
  if (s <= 1e-6f) return {l, l, l};
  const float q = l < 0.5f ? l * (1.0f + s) : l + s - l * s;
  const float p = 2.0f * l - q;
  auto hue2rgb = [&](float t) noexcept -> float {
    if (t < 0.0f) t += 1.0f;
    if (t > 1.0f) t -= 1.0f;
    if (t < 1.0f / 6.0f) return p + (q - p) * 6.0f * t;
    if (t < 0.5f) return q;
    if (t < 2.0f / 3.0f) return p + (q - p) * (2.0f / 3.0f - t) * 6.0f;
    return p;
  };
  return {hue2rgb(h + 1.0f / 3.0f), hue2rgb(h), hue2rgb(h - 1.0f / 3.0f)};
}

/** Lightens low-contrast foreground colors cleanly over dark enclosure background (GNOME icon-dark.js). */
inline RgbResult lightenColorOverDark(const std::array<float, 3>& rgb) noexcept {
  if (contrastRatio(rgb, kDarkBackground) >= 3.2f) return {rgb, true};
  const auto hsl = rgbToHsl(rgb);
  float lo = hsl[2];
  float hi = 0.94f;
  std::array<float, 3> best = rgb;
  for (int iter = 0; iter < 14; ++iter) {
    const float mid = (lo + hi) * 0.5f;
    const auto cand = hslToRgb({hsl[0], std::min(1.0f, hsl[1] * 1.08f), mid});
    if (contrastRatio(cand, kDarkBackground) >= 4.2f) {
      best = cand;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  if (contrastRatio(best, kDarkBackground) < 3.0f) {
    best = hslToRgb({hsl[0], hsl[1] * 0.85f, 0.82f});
  }
  return {best, true};
}

/** Selects dark-mode glyph color from segmented foreground & background colors (GNOME icon-dark.js). */
inline RgbResult chooseDarkIconColor(
    const std::array<float, 3>& fg,
    const std::array<float, 3>& bg) noexcept {
  const auto fgHsl = rgbToHsl(fg);
  const auto bgHsl = rgbToHsl(bg);
  // White/near-white glyph over a colorful brand background swaps to the brand hue on Dark tile.
  const bool fgNeutralBright = fgHsl[1] < 0.16f && fgHsl[2] > 0.78f;
  const bool bgColorful = bgHsl[1] >= 0.22f && bgHsl[2] >= 0.14f && bgHsl[2] <= 0.86f;
  if (fgNeutralBright && bgColorful) {
    return lightenColorOverDark(bg);
  }
  return lightenColorOverDark(fg);
}

}  // namespace haus::icons
