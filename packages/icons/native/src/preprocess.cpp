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
#include <cstring>
#include <unordered_map>

#include "half.hpp"

namespace haus::icons {

namespace {

constexpr int kCoreAlpha = 160;
constexpr float kForegroundFraction = 0.7f;

struct PixelBounds {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  int count = 0;
  bool valid = false;
};

inline int unpremulChannel(const uint8_t* rgba, size_t off, int c) noexcept {
  const int a = rgba[off + 3];
  if (a >= 255) return rgba[off + static_cast<size_t>(c)];
  if (a <= 0) return 0;
  return std::min(255, static_cast<int>(std::lround(rgba[off + static_cast<size_t>(c)] * 255.0f / a)));
}

PixelBounds scanAlphaBounds(const uint8_t* rgba, int w, int h, int threshold) noexcept {
  int x0 = w;
  int y0 = h;
  int x1 = -1;
  int y1 = -1;
  int count = 0;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      const int a = rgba[(static_cast<size_t>(y) * w + x) * 4 + 3];
      if (a < threshold) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      ++count;
    }
  }
  if (count <= 0) return {};
  return {x0, y0, x1 - x0 + 1, y1 - y0 + 1, count, true};
}

bool isNormalizedExistingTile(const uint8_t* rgba, int w, int h, const PixelBounds& core) noexcept {
  if (core.width < w * 0.76f || core.height < h * 0.76f) return false;
  const float ratio = static_cast<float>(core.width) / std::max(1, core.height);
  if (ratio < 0.88f || ratio > 1.14f) return false;
  if (static_cast<float>(core.count) / (core.width * core.height) < 0.72f) return false;
  auto alphaAt = [&](int x, int y) noexcept -> int {
    return rgba[(static_cast<size_t>(y) * w + x) * 4 + 3];
  };
  auto edgeRowInset = [&](float frac) noexcept -> float {
    const int y = std::min(h - 1, core.y + static_cast<int>((core.height - 1) * frac));
    const int centerA = alphaAt(core.x + core.width / 2, y);
    const int threshold = std::max(32, std::min(kCoreAlpha, centerA));
    int first = w;
    int last = -1;
    for (int x = core.x; x < core.x + core.width; ++x) {
      if (alphaAt(x, y) >= threshold) {
        if (x < first) first = x;
        if (x > last) last = x;
      }
    }
    if (last < first) return 1.0f;
    return static_cast<float>(std::max(first - core.x, core.x + core.width - 1 - last)) / core.width;
  };
  return edgeRowInset(0.1f) <= 0.11f && edgeRowInset(0.9f) <= 0.11f;
}

bool sampleRimStudioColor(const uint8_t* rgba, int w, int h, std::array<int, 3>& outBg) {
  const int rimX = std::max(1, static_cast<int>(std::lround(w * 0.08f)));
  const int rimY = std::max(1, static_cast<int>(std::lround(h * 0.08f)));
  struct Bin {
    int count = 0;
    std::array<int, 3> color{0, 0, 0};
  };
  std::unordered_map<uint32_t, Bin> bins;
  std::vector<std::array<int, 3>> samples;
  samples.reserve(static_cast<size_t>((w + h) * 4));
  int rimPixels = 0;

  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      if (x >= rimX && x < w - rimX && y >= rimY && y < h - rimY) continue;
      ++rimPixels;
      const size_t off = (static_cast<size_t>(y) * w + x) * 4;
      if (rgba[off + 3] < 240) continue;
      const int r = unpremulChannel(rgba, off, 0);
      const int g = unpremulChannel(rgba, off, 1);
      const int b = unpremulChannel(rgba, off, 2);
      samples.push_back({r, g, b});
      const uint32_t key =
          (static_cast<uint32_t>(std::lround(r / 16.0f)) << 16) |
          (static_cast<uint32_t>(std::lround(g / 16.0f)) << 8) |
          static_cast<uint32_t>(std::lround(b / 16.0f));
      auto& bin = bins[key];
      if (bin.count == 0) bin.color = {r, g, b};
      bin.count += 1;
    }
  }
  if (bins.empty() || static_cast<float>(samples.size()) / std::max(1, rimPixels) < 0.85f) {
    return false;
  }
  Bin winner;
  for (const auto& [_, b] : bins) {
    if (b.count > winner.count) winner = b;
  }
  int matchCount = 0;
  int sumR = 0;
  int sumG = 0;
  int sumB = 0;
  for (const auto& s : samples) {
    const int d = std::max({
        std::abs(s[0] - winner.color[0]),
        std::abs(s[1] - winner.color[1]),
        std::abs(s[2] - winner.color[2]),
    });
    if (d < 18) {
      ++matchCount;
      sumR += s[0];
      sumG += s[1];
      sumB += s[2];
    }
  }
  if (static_cast<float>(matchCount) / std::max<size_t>(1, samples.size()) < 0.94f) return false;
  const int ar = static_cast<int>(std::lround(static_cast<float>(sumR) / matchCount));
  const int ag = static_cast<int>(std::lround(static_cast<float>(sumG) / matchCount));
  const int ab = static_cast<int>(std::lround(static_cast<float>(sumB) / matchCount));
  const int lo = std::min({ar, ag, ab});
  const int hi = std::max({ar, ag, ab});
  if (lo < 228 || hi - lo > 16) return false;
  outBg = {ar, ag, ab};
  return true;
}

bool stripOpaqueStudioMatte(const PremulImage& src, PremulImage& out) {
  std::array<int, 3> bg{0, 0, 0};
  if (!sampleRimStudioColor(src.rgba.data(), src.width, src.height, bg)) return false;

  const int w = src.width;
  const int h = src.height;
  const int total = w * h;
  std::vector<uint8_t> visited(static_cast<size_t>(total), 0);
  std::vector<uint8_t> removed(static_cast<size_t>(total), 0);
  std::vector<int> queue(static_cast<size_t>(total));
  int head = 0;
  int tail = 0;
  int removedOpaque = 0;
  int totalOpaque = 0;

  for (int i = 0; i < total; ++i) {
    if (src.rgba[static_cast<size_t>(i) * 4 + 3] >= 32) ++totalOpaque;
  }

  auto visit = [&](int px) {
    if (visited[static_cast<size_t>(px)]) return;
    visited[static_cast<size_t>(px)] = 1;
    const size_t off = static_cast<size_t>(px) * 4;
    if (src.rgba[off + 3] > 224) {
      const int dist = std::max({
          std::abs(unpremulChannel(src.rgba.data(), off, 0) - bg[0]),
          std::abs(unpremulChannel(src.rgba.data(), off, 1) - bg[1]),
          std::abs(unpremulChannel(src.rgba.data(), off, 2) - bg[2]),
      });
      if (dist > 28) return;
    }
    queue[static_cast<size_t>(tail++)] = px;
  };

  for (int x = 0; x < w; ++x) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (int y = 0; y < h; ++y) {
    visit(y * w);
    visit(y * w + w - 1);
  }

  while (head < tail) {
    const int px = queue[static_cast<size_t>(head++)];
    removed[static_cast<size_t>(px)] = 1;
    if (src.rgba[static_cast<size_t>(px) * 4 + 3] >= 32) ++removedOpaque;
    const int x = px % w;
    const int y = px / w;
    if (x > 0) visit(px - 1);
    if (x < w - 1) visit(px + 1);
    if (y > 0) visit(px - w);
    if (y < h - 1) visit(px + w);
  }

  if (removedOpaque < totalOpaque * 0.16f || totalOpaque - removedOpaque < totalOpaque * 0.025f) {
    return false;
  }

  out = src;
  for (int i = 0; i < total; ++i) {
    if (!removed[static_cast<size_t>(i)]) continue;
    const size_t off = static_cast<size_t>(i) * 4;
    out.rgba[off] = 0;
    out.rgba[off + 1] = 0;
    out.rgba[off + 2] = 0;
    out.rgba[off + 3] = 0;
  }

  const float matteAvg = (bg[0] + bg[1] + bg[2]) / 3.0f;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      const int px = y * w + x;
      if (removed[static_cast<size_t>(px)]) continue;
      const bool touches =
          (x > 0 && removed[static_cast<size_t>(px - 1)]) ||
          (x < w - 1 && removed[static_cast<size_t>(px + 1)]) ||
          (y > 0 && removed[static_cast<size_t>(px - w)]) ||
          (y < h - 1 && removed[static_cast<size_t>(px + w)]);
      if (!touches) continue;
      const size_t off = static_cast<size_t>(px) * 4;
      const int sr = unpremulChannel(out.rgba.data(), off, 0);
      const int sg = unpremulChannel(out.rgba.data(), off, 1);
      const int sb = unpremulChannel(out.rgba.data(), off, 2);
      const int chroma = std::max({sr, sg, sb}) - std::min({sr, sg, sb});
      const float luma = (sr + sg + sb) / 3.0f;
      if (chroma > 24 || luma >= matteAvg - 24.0f) continue;
      const float cov = clamp01((matteAvg - luma) / std::max(32.0f, matteAvg - 32.0f));
      if (cov < 0.99f && cov > 0.0f) {
        const int nextA = static_cast<int>(std::lround(out.rgba[off + 3] * cov));
        const float k = nextA / 255.0f;
        out.rgba[off] = static_cast<uint8_t>(std::lround(std::max(0.0f, (sr - bg[0] * (1.0f - cov)) / cov) * k));
        out.rgba[off + 1] = static_cast<uint8_t>(std::lround(std::max(0.0f, (sg - bg[1] * (1.0f - cov)) / cov) * k));
        out.rgba[off + 2] = static_cast<uint8_t>(std::lround(std::max(0.0f, (sb - bg[2] * (1.0f - cov)) / cov) * k));
        out.rgba[off + 3] = static_cast<uint8_t>(std::clamp(nextA, 0, 255));
      }
    }
  }
  return true;
}

PremulImage cropPixels(const PremulImage& src, int cx, int cy, int cw, int ch) {
  PremulImage dst;
  dst.width = std::max(1, cw);
  dst.height = std::max(1, ch);
  dst.rgba.assign(static_cast<size_t>(dst.width * dst.height * 4), 0);
  for (int y = 0; y < dst.height; ++y) {
    const int sy = cy + y;
    if (sy < 0 || sy >= src.height) continue;
    for (int x = 0; x < dst.width; ++x) {
      const int sx = cx + x;
      if (sx < 0 || sx >= src.width) continue;
      const size_t sOff = (static_cast<size_t>(sy) * src.width + sx) * 4;
      const size_t dOff = (static_cast<size_t>(y) * dst.width + x) * 4;
      std::memcpy(&dst.rgba[dOff], &src.rgba[sOff], 4);
    }
  }
  return dst;
}

inline float catmullRomWeight(float d) noexcept {
  const float x = std::fabs(d);
  if (x < 1.0f) return (1.5f * x - 2.5f) * x * x + 1.0f;
  if (x < 2.0f) return ((-0.5f * x + 2.5f) * x - 4.0f) * x + 2.0f;
  return 0.0f;
}

inline float rectCoverage(int x, int y, float left, float top, float right, float bottom) noexcept {
  const float edge = std::min({
      x + 0.5f - left,
      right - x - 0.5f,
      y + 0.5f - top,
      bottom - y - 0.5f,
  });
  const float c = clamp01(edge + 0.5f);
  return c * c * (3.0f - 2.0f * c);
}

}  // namespace

PremulImage mipmap2x2(const PremulImage& src) {
  const int dw = std::max(1, src.width >> 1);
  const int dh = std::max(1, src.height >> 1);
  PremulImage dst{dw, dh, std::vector<uint8_t>(static_cast<size_t>(dw * dh * 4), 0)};
  for (int y = 0; y < dh; ++y) {
    const int sy0 = y * 2;
    const int sy1 = std::min(src.height - 1, sy0 + 1);
    for (int x = 0; x < dw; ++x) {
      const int sx0 = x * 2;
      const int sx1 = std::min(src.width - 1, sx0 + 1);
      const size_t i00 = (static_cast<size_t>(sy0) * src.width + sx0) * 4;
      const size_t i10 = (static_cast<size_t>(sy0) * src.width + sx1) * 4;
      const size_t i01 = (static_cast<size_t>(sy1) * src.width + sx0) * 4;
      const size_t i11 = (static_cast<size_t>(sy1) * src.width + sx1) * 4;
      const size_t dOff = (static_cast<size_t>(y) * dw + x) * 4;
      for (int c = 0; c < 4; ++c) {
        const int sum =
            src.rgba[i00 + c] + src.rgba[i10 + c] + src.rgba[i01 + c] + src.rgba[i11 + c];
        dst.rgba[dOff + c] = static_cast<uint8_t>((sum + 2) >> 2);
      }
    }
  }
  return dst;
}

PremulImage downsampleForAnalysis(const uint8_t* rgba, int width, int height, int maxDim) {
  PremulImage cur{
      width,
      height,
      std::vector<uint8_t>(rgba, rgba + static_cast<size_t>(width) * height * 4),
  };
  while ((cur.width > maxDim || cur.height > maxDim) && cur.width >= 4 && cur.height >= 4) {
    cur = mipmap2x2(cur);
  }
  return cur;
}

PreparedIcon prepareLegacyIcon(const PremulImage& src) {
  PremulImage stripped;
  const PremulImage& working = stripOpaqueStudioMatte(src, stripped) ? stripped : src;
  const int w = working.width;
  const int h = working.height;

  // Check for full opaque square (no transparent border).
  int opaqueCount = 0;
  for (int i = 0; i < w * h; ++i) {
    if (working.rgba[static_cast<size_t>(i) * 4 + 3] >= 250) ++opaqueCount;
  }
  if (w == h && opaqueCount >= static_cast<int>(w * h * 0.99f)) {
    return {working, true, true, 1.0f};
  }

  const PixelBounds visible = scanAlphaBounds(working.rgba.data(), w, h, 4);
  if (!visible.valid) {
    return {working, false, false, kForegroundFraction};
  }
  PixelBounds core = scanAlphaBounds(working.rgba.data(), w, h, kCoreAlpha);
  if (!core.valid) core = scanAlphaBounds(working.rgba.data(), w, h, 32);
  if (!core.valid) core = visible;

  if (isNormalizedExistingTile(working.rgba.data(), w, h, core)) {
    const int side = std::min(core.width, core.height);
    const int cx = core.x + (core.width - side) / 2;
    const int cy = core.y + (core.height - side) / 2;
    return {cropPixels(working, cx, cy, side, side), true, true, 1.0f};
  }

  // Distinct foreground silhouette: optically center on dense core bounds (exact Haus policy.ts).
  const float cx = core.x + core.width * 0.5f;
  const float cy = core.y + core.height * 0.5f;
  const int halfW = static_cast<int>(std::ceil(std::max(cx - visible.x, visible.x + visible.width - cx))) + 1;
  const int halfH = static_cast<int>(std::ceil(std::max(cy - visible.y, visible.y + visible.height - cy))) + 1;
  const int outW = std::max(2, halfW * 2);
  const int outH = std::max(2, halfH * 2);
  const int srcLeft = static_cast<int>(std::lround(cx - halfW));
  const int srcTop = static_cast<int>(std::lround(cy - halfH));
  const int coreExtent = std::max({1, core.width, core.height});
  const int cropSide = std::max(outW, outH);
  const float scale = kForegroundFraction * (static_cast<float>(cropSide) / coreExtent);

  return {cropPixels(working, srcLeft, srcTop, outW, outH), false, false, scale};
}

std::vector<float> fitIconSourceCubic(
    const uint8_t* srcRgba,
    int srcW,
    int srcH,
    int dstW,
    int dstH,
    float scale,
    bool maskEdges) {
  const float safeScale = std::max(1e-3f, scale);
  const int side = std::max({1, srcW, srcH});
  const float destW = std::max(1.0f, (static_cast<float>(dstW) * srcW / side) * safeScale);
  const float destH = std::max(1.0f, (static_cast<float>(dstH) * srcH / side) * safeScale);
  const float destLeft = (dstW - destW) * 0.5f;
  const float destTop = (dstH - destH) * 0.5f;
  const float destRight = destLeft + destW;
  const float destBottom = destTop + destH;

  PremulImage mip{
      srcW,
      srcH,
      std::vector<uint8_t>(srcRgba, srcRgba + static_cast<size_t>(srcW) * srcH * 4),
  };
  while (mip.width >= destW * 2.0f && mip.height >= destH * 2.0f && mip.width > 2 && mip.height > 2) {
    mip = mipmap2x2(mip);
  }

  const float scaleX = mip.width / destW;
  const float scaleY = mip.height / destH;
  const float offX = -destLeft * scaleX;
  const float offY = -destTop * scaleY;

  std::vector<float> out(static_cast<size_t>(dstW * dstH * 4), 0.0f);
  for (int y = 0; y < dstH; ++y) {
    const float sy = (y + 0.5f) * scaleY + offY - 0.5f;
    const int iy = static_cast<int>(std::floor(sy));
    float wy[4];
    for (int j = 0; j < 4; ++j) wy[j] = catmullRomWeight(sy - (iy + j - 1));

    for (int x = 0; x < dstW; ++x) {
      const float cov = maskEdges ? rectCoverage(x, y, destLeft, destTop, destRight, destBottom) : 1.0f;
      if (cov <= 0.0f) continue;

      const float sx = (x + 0.5f) * scaleX + offX - 0.5f;
      const int ix = static_cast<int>(std::floor(sx));
      float wx[4];
      for (int i = 0; i < 4; ++i) wx[i] = catmullRomWeight(sx - (ix + i - 1));

      float acc[4] = {0.0f, 0.0f, 0.0f, 0.0f};
      float wSum = 0.0f;
      for (int j = 0; j < 4; ++j) {
        const int py = std::clamp(iy + j - 1, 0, mip.height - 1);
        for (int i = 0; i < 4; ++i) {
          const int px = std::clamp(ix + i - 1, 0, mip.width - 1);
          const float w = wx[i] * wy[j];
          wSum += w;
          const size_t sOff = (static_cast<size_t>(py) * mip.width + px) * 4;
          acc[0] += mip.rgba[sOff] * w;
          acc[1] += mip.rgba[sOff + 1] * w;
          acc[2] += mip.rgba[sOff + 2] * w;
          acc[3] += mip.rgba[sOff + 3] * w;
        }
      }
      const float inv = (wSum > 1e-6f ? 1.0f / wSum : 1.0f) / 255.0f;
      const float a = clamp01(acc[3] * inv * cov);
      if (a <= 0.0f) continue;
      const size_t dOff = (static_cast<size_t>(y) * dstW + x) * 4;
      out[dOff] = std::min(a, std::max(0.0f, acc[0] * inv * cov));
      out[dOff + 1] = std::min(a, std::max(0.0f, acc[1] * inv * cov));
      out[dOff + 2] = std::min(a, std::max(0.0f, acc[2] * inv * cov));
      out[dOff + 3] = a;
    }
  }
  return out;
}

}  // namespace haus::icons
