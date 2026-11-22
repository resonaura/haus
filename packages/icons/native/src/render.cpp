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
#include "preprocess.hpp"
#include "sdf.hpp"

namespace haus::icons {

namespace {

constexpr float kContentLighteningStrength = 0.85f;
constexpr float kShadowOpacity = 0.1875f;

enum class SizeClass { Display = 0, Large = 1, Medium = 2, Small = 3 };

inline SizeClass sizeClassFor(int size) noexcept {
  if (size >= 256) return SizeClass::Display;
  if (size >= 60) return SizeClass::Large;
  if (size >= 25) return SizeClass::Medium;
  return SizeClass::Small;
}

struct HighlightPass {
  float heightParam;
  float inset;
  float spread;
  float biasAmount;
  float curvature;
  float dirX;
  float dirY;
  std::array<float, 4> color;
  float opacity;
  bool isScreen;
  bool isPlusLighter;
  float sdfScale;
};

std::array<HighlightPass, 6> buildContourPasses(int size, bool semantic) noexcept {
  const int sc = static_cast<int>(sizeClassFor(size));
  const float scale = static_cast<float>(size) / 1024.0f;
  const float sdfScale = -static_cast<float>(size) * 0.4f;
  constexpr float kCurv = 0.75f;

  constexpr float kSharpDist[4] = {4.0f, 6.0f, 6.0f, 6.0f};
  constexpr float kSharpOp[4] = {1.0f, 1.0f, 1.0f, 0.3f};
  constexpr float kDiffDist[4] = {16.0f, 24.0f, 24.0f, 24.0f};
  constexpr float kDarkOutsetOp[4] = {0.9f, 0.9f, 0.2f, 0.2f};
  constexpr float kDarkSpread[4] = {
      1.5707963267948966f, 1.5707963267948966f, 3.141592653589793f, 3.141592653589793f};

  auto make = [&](float dist, float minPx, float spreadRad, float bias, float op, float dx,
                  float dy, bool diffuse, bool dark) noexcept -> HighlightPass {
    const float h = std::max(dist * scale, minPx);
    return HighlightPass{
        h,
        dark ? -h : 0.0f,
        std::cos(spreadRad),
        1.0f / bias - 2.0f,
        dark ? 0.0f : (diffuse ? 1.0f : kCurv),
        dx,
        dy,
        semantic ? (dark ? std::array<float, 4>{1.0f, 0.0f, 1.0f, 1.0f}
                         : std::array<float, 4>{1.0f, 0.0f, 0.0f, 1.0f})
                 : (dark ? std::array<float, 4>{0.0f, 0.0f, 0.0f, 1.0f}
                         : std::array<float, 4>{1.0f, 1.0f, 1.0f, 1.0f}),
        op,
        semantic && !dark,
        !semantic && !dark,
        sdfScale,
    };
  };

  return {
      make(kSharpDist[sc], 1.0f, 1.5707963267948966f, 0.5f, kSharpOp[sc], 0.0f, -1.0f, false, false),
      make(kSharpDist[sc], 1.0f, 1.0471975511965976f, 0.5f, kSharpOp[sc], 0.0f, 1.0f, false, false),
      make(kDiffDist[sc], 4.0f, 1.0471975511965976f, 0.08f, 1.0f, 0.0f, -1.0f, true, false),
      make(kDiffDist[sc], 4.0f, 1.0471975511965976f, 0.08f, 1.0f, 0.0f, 1.0f, true, false),
      make(kSharpDist[sc], 1.0f, kDarkSpread[sc], 0.2f, kDarkOutsetOp[sc], 1.0f, 0.0f, false, true),
      make(kSharpDist[sc], 1.0f, kDarkSpread[sc], 0.2f, kDarkOutsetOp[sc], -1.0f, 0.0f, false, true),
  };
}

void applyContourPass(
    const ContourField& field,
    const HighlightPass& pass,
    bool semantic,
    int originX,
    int originY,
    std::vector<float>& target) {
  const int fw = field.width;
  const int fh = field.height;
  const int bodyW = fw - 2;
  const int bodyH = fh - 2;
  const int qxOff = originX - 1;
  const int qyOff = originY - 1;

  std::vector<float> dist(static_cast<size_t>(fw * fh));
  for (int i = 0; i < fw * fh; ++i) {
    dist[static_cast<size_t>(i)] = roundHalf(
        (0.5f - roundHalf(field.pixels[static_cast<size_t>(i) * 4])) * pass.sdfScale - pass.inset);
  }

  const float h = pass.heightParam;
  const float curve = clamp01(roundHalf((roundHalf(h) - 1.0f) * 0.5f));
  const float curvAmt = roundHalf(roundHalf(curve * curve) * roundHalf(pass.curvature));
  const float curv = roundHalf(curvAmt * roundHalf(3.0f - roundHalf(curve * 2.0f)));
  const float denom = std::max(roundHalf(1.0f - roundHalf(pass.spread)), 1.0f / 1024.0f);

  for (int y = 0; y < bodyH; ++y) {
    const int fy = y + 1;
    const int y0 = ((fy + qyOff) & ~1) - qyOff;
    const int yA = std::max(0, y0);
    const int yB = std::min(fh - 1, y0 + 1);
    for (int x = 0; x < bodyW; ++x) {
      const int fx = x + 1;
      const int x0 = ((fx + qxOff) & ~1) - qxOff;
      const int xA = std::max(0, x0);
      const int xB = std::min(fw - 1, x0 + 1);

      const int fi = fy * fw + fx;
      const float d = dist[static_cast<size_t>(fi)];
      const float dx =
          dist[static_cast<size_t>(fy * fw + xB)] - dist[static_cast<size_t>(fy * fw + xA)];
      const float dy =
          dist[static_cast<size_t>(yB * fw + fx)] - dist[static_cast<size_t>(yA * fw + fx)];
      const float deriv = std::fabs(dx) + std::fabs(dy);

      const float normD = clamp01(d / h);
      const float aa = std::min(2.0f, std::max(1.0f / 1024.0f, deriv)) * 0.8330078125f;
      const float intensity = mixf(1.0f, 1.0f - normD, curv);
      const float cov = clamp01(d / aa + 0.5f) * clamp01((h - d) / aa + 0.5f);
      if (cov <= 0.0f) continue;

      const float nx = 1.0f - field.pixels[static_cast<size_t>(fi) * 4 + 1] * 2.0f;
      const float ny = 1.0f - field.pixels[static_cast<size_t>(fi) * 4 + 2] * 2.0f;
      const float dot = pass.dirX * nx + pass.dirY * ny;
      const float angular = clamp01((dot - pass.spread) / denom) * intensity;
      if (angular <= 0.0f) continue;

      const float biased = std::max((1.0f - angular) * pass.biasAmount + 1.0f, 1.0f / 1024.0f);
      const float alpha = (cov * angular * pass.opacity) / biased;
      if (alpha <= 0.0f) continue;

      const size_t tIdx = static_cast<size_t>((y * bodyW + x) * 4);
      if (semantic) {
        for (int c = 0; c < 3; ++c) {
          const float src = alpha * pass.color[static_cast<size_t>(c)];
          const float dst = target[tIdx + static_cast<size_t>(c)];
          target[tIdx + static_cast<size_t>(c)] =
              pass.isScreen ? dst * (1.0f - src) + src : dst * (src + (1.0f - alpha));
        }
      } else {
        for (int c = 0; c < 3; ++c) {
          const float delta =
              pass.isPlusLighter ? (alpha * pass.color[static_cast<size_t>(c)]) : -alpha;
          target[tIdx + static_cast<size_t>(c)] =
              clamp01(target[tIdx + static_cast<size_t>(c)] + delta);
        }
      }
    }
  }
}

std::vector<uint8_t> adaptUnsegmentedDark(const std::vector<uint8_t>& rgba) {
  double wSum = 0.0;
  double rSum = 0.0;
  double gSum = 0.0;
  double bSum = 0.0;
  for (size_t i = 0; i < rgba.size(); i += 4) {
    if (rgba[i + 3] < 24) continue;
    wSum += rgba[i + 3] / 255.0;
    rSum += rgba[i] / 255.0;
    gSum += rgba[i + 1] / 255.0;
    bSum += rgba[i + 2] / 255.0;
  }
  if (wSum <= 0.0) return rgba;
  const std::array<float, 3> mean{
      static_cast<float>(rSum / wSum),
      static_cast<float>(gSum / wSum),
      static_cast<float>(bSum / wSum),
  };
  if (contrastRatio(mean, kDarkBackground) >= 2.8f) return rgba;

  std::vector<uint8_t> out(rgba.size(), 0);
  for (size_t i = 0; i < rgba.size(); i += 4) {
    const int a = rgba[i + 3];
    if (a == 0) continue;
    const float inv = 1.0f / a;
    const auto lifted =
        lightenColorOverDark({rgba[i] * inv, rgba[i + 1] * inv, rgba[i + 2] * inv}).color;
    out[i] = static_cast<uint8_t>(std::lround(lifted[0] * a));
    out[i + 1] = static_cast<uint8_t>(std::lround(lifted[1] * a));
    out[i + 2] = static_cast<uint8_t>(std::lround(lifted[2] * a));
    out[i + 3] = static_cast<uint8_t>(a);
  }
  return out;
}

std::vector<float> buildOpaqueBody(const SegmentedLayers& layers, int bodySize, bool isDark) {
  const std::vector<uint8_t>* sourcePtr = &layers.prepared.image.rgba;
  std::vector<uint8_t> adapted;

  if (isDark && layers.segmented) {
    const auto selected = chooseDarkIconColor(layers.foregroundColor, layers.backgroundColor);
    if (selected.success) {
      adapted.assign(layers.foreground.size(), 0);
      for (size_t i = 0; i < adapted.size(); i += 4) {
        const int a = layers.foreground[i + 3];
        if (a == 0) continue;
        const float inv = 1.0f / a;
        const auto color = layers.isSingleBranch
                               ? selected.color
                               : lightenColorOverDark({
                                     layers.foreground[i] * inv,
                                     layers.foreground[i + 1] * inv,
                                     layers.foreground[i + 2] * inv,
                                 })
                                     .color;
        adapted[i] = static_cast<uint8_t>(std::lround(color[0] * a));
        adapted[i + 1] = static_cast<uint8_t>(std::lround(color[1] * a));
        adapted[i + 2] = static_cast<uint8_t>(std::lround(color[2] * a));
        adapted[i + 3] = static_cast<uint8_t>(a);
      }
      sourcePtr = &adapted;
    }
  } else if (isDark && !layers.prepared.isFill) {
    adapted = adaptUnsegmentedDark(layers.prepared.image.rgba);
    sourcePtr = &adapted;
  }

  const auto raster = fitIconSourceCubic(
      sourcePtr->data(), layers.prepared.image.width, layers.prepared.image.height, bodySize,
      bodySize, layers.prepared.scale, !layers.prepared.isFill);

  std::vector<float> bodyAlpha(static_cast<size_t>(bodySize * bodySize));
  for (int i = 0; i < bodySize * bodySize; ++i) {
    bodyAlpha[static_cast<size_t>(i)] = raster[static_cast<size_t>(i) * 4 + 3];
  }
  const auto contour = buildContourField(bodyAlpha, bodySize, bodySize);

  const float topC = isDark ? 0.12156862745098039f : 1.0f;
  const float botC = isDark ? 0.058823529411764705f : 0.9607843137254902f;
  std::vector<float> composed(static_cast<size_t>(bodySize * bodySize * 4), 1.0f);
  for (int y = 0; y < bodySize; ++y) {
    const float t = (y + 0.5f) / bodySize;
    const float bg = mixf(topC, botC, t);
    for (int x = 0; x < bodySize; ++x) {
      const size_t idx = static_cast<size_t>((y * bodySize + x) * 4);
      const float a = raster[idx + 3];
      composed[idx] = clamp01(raster[idx] + bg * (1.0f - a));
      composed[idx + 1] = clamp01(raster[idx + 1] + bg * (1.0f - a));
      composed[idx + 2] = clamp01(raster[idx + 2] + bg * (1.0f - a));
      composed[idx + 3] = 1.0f;
    }
  }

  for (const auto& pass : buildContourPasses(bodySize, false)) {
    applyContourPass(contour, pass, false, 0, 0, composed);
  }
  return composed;
}

std::vector<float> buildGlyphShadow(const std::vector<float>& bodyAlpha, int w, int h) {
  const float sigma = std::max(0.8f, static_cast<float>(std::min(w, h)) * 0.025f);
  const int radius = std::max(1, static_cast<int>(std::ceil(sigma * 3.0f)));
  std::vector<float> kernel(static_cast<size_t>(radius * 2 + 1));
  float kSum = 0.0f;
  for (int i = -radius; i <= radius; ++i) {
    const float v = std::exp(-(i * i) / (2.0f * sigma * sigma));
    kernel[static_cast<size_t>(i + radius)] = v;
    kSum += v;
  }
  for (float& v : kernel) v /= kSum;

  const float offsetY = static_cast<float>(h) * (32.0f / 1024.0f);
  std::vector<float> temp(static_cast<size_t>(w * h), 0.0f);
  std::vector<float> blur(static_cast<size_t>(w * h), 0.0f);

  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      float acc = 0.0f;
      for (int k = -radius; k <= radius; ++k) {
        const int sx = std::clamp(x + k, 0, w - 1);
        acc += bodyAlpha[static_cast<size_t>(y * w + sx)] * kernel[static_cast<size_t>(k + radius)];
      }
      temp[static_cast<size_t>(y * w + x)] = acc;
    }
  }
  for (int y = 0; y < h; ++y) {
    const int baseY = static_cast<int>(std::lround(y - offsetY));
    for (int x = 0; x < w; ++x) {
      float acc = 0.0f;
      for (int k = -radius; k <= radius; ++k) {
        const int sy = baseY + k;
        if (sy >= 0 && sy < h) {
          acc += temp[static_cast<size_t>(sy * w + x)] * kernel[static_cast<size_t>(k + radius)];
        }
      }
      blur[static_cast<size_t>(y * w + x)] = clamp01(acc);
    }
  }
  return blur;
}

std::vector<uint8_t> buildSemanticGlyph(
    const SegmentedLayers& layers,
    int targetSize,
    int bodySize,
    bool forTinted) {
  const std::vector<uint8_t>& src = layers.segmented
                                        ? (forTinted ? layers.solarium : layers.foreground)
                                        : layers.prepared.image.rgba;

  const auto raster = fitIconSourceCubic(
      src.data(), layers.prepared.image.width, layers.prepared.image.height, bodySize, bodySize,
      layers.prepared.scale, true);

  std::vector<float> bodyAlpha(static_cast<size_t>(bodySize * bodySize));
  std::vector<float> monoLuma(static_cast<size_t>(bodySize * bodySize));
  for (int i = 0; i < bodySize * bodySize; ++i) {
    const size_t off = static_cast<size_t>(i) * 4;
    const float a = raster[off + 3];
    bodyAlpha[static_cast<size_t>(i)] = a;
    if (a > 1e-4f) {
      const float r = raster[off] / a;
      const float g = raster[off + 1] / a;
      const float b = raster[off + 2] / a;
      const float l = clamp01(0.2126f * r + 0.7152f * g + 0.0722f * b);
      monoLuma[static_cast<size_t>(i)] = clamp01((0.35f + 0.65f * l) * a);
    } else {
      monoLuma[static_cast<size_t>(i)] = 0.0f;
    }
  }

  const auto contour = buildContourField(bodyAlpha, bodySize, bodySize);
  const auto shadow = buildGlyphShadow(bodyAlpha, bodySize, bodySize);

  const float translucency = (layers.segmented && layers.isSingleBranch) ? 0.3f : 0.0f;
  const float overdraw = translucency > 0.0f ? 0.2f : 0.0f;
  const int offset = (targetSize - bodySize) / 2;

  std::vector<float> shadowed(static_cast<size_t>(bodySize * bodySize * 4), 0.0f);
  for (int y = 0; y < bodySize; ++y) {
    const float ty = (y + 0.5f) / bodySize;
    const float cov = 1.0f - translucency * (1.0f - ty);
    for (int x = 0; x < bodySize; ++x) {
      const int idx = y * bodySize + x;
      const float a = bodyAlpha[static_cast<size_t>(idx)];
      const float srcLight = monoLuma[static_cast<size_t>(idx)] * kContentLighteningStrength;
      const float bg = 1.0f - shadow[static_cast<size_t>(idx)] * kShadowOpacity;
      const float green = bg * (1.0f - a) + a;
      float r = srcLight * cov;
      float g = mixf(bg, green, cov);
      if (overdraw > 0.0f) {
        const float oCov = a * overdraw * cov;
        const float sA = shadow[static_cast<size_t>(idx)] * kShadowOpacity;
        r = mixf(r, r * (1.0f - sA), oCov);
        g = mixf(g, g * (1.0f - sA), oCov);
      }
      const size_t pIdx = static_cast<size_t>(idx) * 4;
      shadowed[pIdx] = r;
      shadowed[pIdx + 1] = g;
      shadowed[pIdx + 2] = 0.0f;
      shadowed[pIdx + 3] = 1.0f;
    }
  }

  std::vector<float> lit = shadowed;
  for (const auto& pass : buildContourPasses(bodySize, true)) {
    applyContourPass(contour, pass, true, offset, offset, lit);
  }

  std::vector<uint8_t> encoded(static_cast<size_t>(targetSize * targetSize * 4), 0);
  for (int y = 0; y < bodySize; ++y) {
    for (int x = 0; x < bodySize; ++x) {
      const size_t inOff = static_cast<size_t>((y * bodySize + x) * 4);
      const size_t outOff = static_cast<size_t>(((y + offset) * targetSize + (x + offset)) * 4);
      encoded[outOff] = toByte(lit[inOff]);
      encoded[outOff + 1] = toByte(lit[inOff + 1]);
      encoded[outOff + 2] = toByte(shadowed[inOff]);
      encoded[outOff + 3] = toByte(lit[inOff + 3]);
    }
  }
  return encoded;
}

}  // namespace

AllBaseLayersOutput renderAllBaseLayersCpp(
    const uint8_t* sourcePremulRgba,
    int sourceWidth,
    int sourceHeight,
    int targetSize,
    float tileFraction) {
  const auto analysis = downsampleForAnalysis(sourcePremulRgba, sourceWidth, sourceHeight, 512);
  const auto layers = segmentIconLayers(analysis);
  const int bodySize =
      std::max(16, static_cast<int>(std::lround((targetSize * tileFraction) / 2.0f)) * 2);
  const float effFrac = static_cast<float>(bodySize) / targetSize;

  const auto defaultBody = buildOpaqueBody(layers, bodySize, false);
  const auto darkBody = buildOpaqueBody(layers, bodySize, true);

  AllBaseLayersOutput out;
  out.width = targetSize;
  out.height = targetSize;
  out.bodySize = bodySize;
  out.isFill = layers.prepared.isFill;
  out.segmented = layers.segmented;
  out.defaultRgba = maskOpaqueBodyCpp(defaultBody, bodySize, targetSize, effFrac);
  out.darkRgba = maskOpaqueBodyCpp(darkBody, bodySize, targetSize, effFrac);
  out.clearSemanticRgba = buildSemanticGlyph(layers, targetSize, bodySize, false);
  out.tintedSemanticRgba =
      layers.segmented ? buildSemanticGlyph(layers, targetSize, bodySize, true)
                       : out.clearSemanticRgba;
  return out;
}

}  // namespace haus::icons
