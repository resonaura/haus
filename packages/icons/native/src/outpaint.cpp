/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

#include "preprocess.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace haus::icons {

namespace {

constexpr int kSolidTileAlpha = 250;
constexpr int kOutpaintSeedAlpha = 252;

inline int unpremulByte(const uint8_t* rgba, size_t off, int c) noexcept {
  const int a = rgba[off + 3];
  if (a >= 255) return rgba[off + static_cast<size_t>(c)];
  if (a <= 0) return 0;
  return std::min(255, static_cast<int>(std::lround(rgba[off + static_cast<size_t>(c)] * 255.0f / a)));
}

PremulImage copySubrect(const PremulImage& src, int cx, int cy, int cw, int ch) {
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

}  // namespace

PremulImage outpaintFullBleedTile(const PremulImage& src) {
  const int w = src.width;
  const int h = src.height;
  const int total = w * h;
  if (w < 2 || h < 2 || static_cast<int>(src.rgba.size()) < total * 4) return src;

  int solidCount = 0;
  for (int i = 0; i < total; ++i) {
    if (src.rgba[static_cast<size_t>(i) * 4 + 3] >= kOutpaintSeedAlpha) ++solidCount;
  }
  if (solidCount == total) return src;

  const int seedThreshold = solidCount >= total / 2 ? kOutpaintSeedAlpha : 240;

  // 1. Mark only edge-connected sub-opaque pixels (rounded corners + outer AA rim),
  // leaving any interior transparent cutouts untouched.
  std::vector<uint8_t> exterior(static_cast<size_t>(total), 0);
  std::vector<int> bfs;
  bfs.reserve(static_cast<size_t>(total / 4));

  auto enqueueExterior = [&](int px) {
    if (exterior[static_cast<size_t>(px)]) return;
    if (src.rgba[static_cast<size_t>(px) * 4 + 3] >= seedThreshold) return;
    exterior[static_cast<size_t>(px)] = 1;
    bfs.push_back(px);
  };

  for (int x = 0; x < w; ++x) {
    enqueueExterior(x);
    enqueueExterior((h - 1) * w + x);
  }
  for (int y = 0; y < h; ++y) {
    enqueueExterior(y * w);
    enqueueExterior(y * w + (w - 1));
  }

  for (size_t head = 0; head < bfs.size(); ++head) {
    const int px = bfs[head];
    const int x = px % w;
    const int y = px / w;
    if (x > 0) enqueueExterior(px - 1);
    if (x < w - 1) enqueueExterior(px + 1);
    if (y > 0) enqueueExterior(px - w);
    if (y < h - 1) enqueueExterior(px + w);
  }
  if (bfs.empty()) return src;

  // 2. Multi-source wave dilation outward from solid opaque boundary pixels.
  PremulImage out = src;
  std::vector<int> state(static_cast<size_t>(total), 0);
  for (int i = 0; i < total; ++i) {
    if (!exterior[static_cast<size_t>(i)] &&
        src.rgba[static_cast<size_t>(i) * 4 + 3] >= seedThreshold) {
      state[static_cast<size_t>(i)] = 1;
    }
  }

  std::vector<int> frontier;
  std::vector<int> nextFrontier;
  std::vector<uint8_t> queued(static_cast<size_t>(total), 0);
  frontier.reserve(bfs.size());
  nextFrontier.reserve(bfs.size());

  auto hasFilledNeighbor = [&](int x, int y, int maxWave) noexcept -> bool {
    const int y0 = std::max(0, y - 1);
    const int y1 = std::min(h - 1, y + 1);
    const int x0 = std::max(0, x - 1);
    const int x1 = std::min(w - 1, x + 1);
    for (int ny = y0; ny <= y1; ++ny) {
      for (int nx = x0; nx <= x1; ++nx) {
        const int s = state[static_cast<size_t>(ny * w + nx)];
        if (s > 0 && s <= maxWave) return true;
      }
    }
    return false;
  };

  for (int px : bfs) {
    const int x = px % w;
    const int y = px / w;
    if (hasFilledNeighbor(x, y, 1)) {
      queued[static_cast<size_t>(px)] = 1;
      frontier.push_back(px);
    }
  }

  int wave = 1;
  while (!frontier.empty()) {
    const int prevWave = wave;
    ++wave;
    nextFrontier.clear();

    for (int px : frontier) {
      const int x = px % w;
      const int y = px / w;
      const int y0 = std::max(0, y - 1);
      const int y1 = std::min(h - 1, y + 1);
      const int x0 = std::max(0, x - 1);
      const int x1 = std::min(w - 1, x + 1);

      int sumR = 0;
      int sumG = 0;
      int sumB = 0;
      int wSum = 0;
      for (int ny = y0; ny <= y1; ++ny) {
        for (int nx = x0; nx <= x1; ++nx) {
          const int nIdx = ny * w + nx;
          const int s = state[static_cast<size_t>(nIdx)];
          if (s <= 0 || s > prevWave) continue;
          const int wt = (nx == x || ny == y) ? 2 : 1;
          const size_t nOff = static_cast<size_t>(nIdx) * 4;
          sumR += unpremulByte(out.rgba.data(), nOff, 0) * wt;
          sumG += unpremulByte(out.rgba.data(), nOff, 1) * wt;
          sumB += unpremulByte(out.rgba.data(), nOff, 2) * wt;
          wSum += wt;
        }
      }
      if (wSum <= 0) continue;
      const size_t off = static_cast<size_t>(px) * 4;
      out.rgba[off] = static_cast<uint8_t>(std::clamp((sumR + wSum / 2) / wSum, 0, 255));
      out.rgba[off + 1] = static_cast<uint8_t>(std::clamp((sumG + wSum / 2) / wSum, 0, 255));
      out.rgba[off + 2] = static_cast<uint8_t>(std::clamp((sumB + wSum / 2) / wSum, 0, 255));
      out.rgba[off + 3] = 255;
    }

    for (int px : frontier) {
      state[static_cast<size_t>(px)] = wave;
    }

    for (int px : frontier) {
      const int x = px % w;
      const int y = px / w;
      const int y0 = std::max(0, y - 1);
      const int y1 = std::min(h - 1, y + 1);
      const int x0 = std::max(0, x - 1);
      const int x1 = std::min(w - 1, x + 1);
      for (int ny = y0; ny <= y1; ++ny) {
        for (int nx = x0; nx <= x1; ++nx) {
          const int nIdx = ny * w + nx;
          if (!exterior[static_cast<size_t>(nIdx)] || state[static_cast<size_t>(nIdx)] != 0 ||
              queued[static_cast<size_t>(nIdx)]) {
            continue;
          }
          queued[static_cast<size_t>(nIdx)] = 1;
          nextFrontier.push_back(nIdx);
        }
      }
    }

    frontier.swap(nextFrontier);
  }

  return out;
}

PremulImage cropAndOutpaintTile(
    const PremulImage& src,
    int boxX,
    int boxY,
    int boxW,
    int boxH) {
  int left = std::clamp(boxX, 0, std::max(0, src.width - 1));
  int top = std::clamp(boxY, 0, std::max(0, src.height - 1));
  int right = std::clamp(boxX + boxW, left + 1, src.width);
  int bottom = std::clamp(boxY + boxH, top + 1, src.height);

  const int bw = right - left;
  const int bh = bottom - top;
  const int maxTrim = std::min(3, std::min(bw, bh) / 16);

  auto alphaAt = [&](int x, int y) noexcept -> int {
    return src.rgba[(static_cast<size_t>(y) * src.width + x) * 4 + 3];
  };

  // Trim up to 3px of semi-transparent AA/drop-shadow edge rows/columns along the middle 40% band.
  if (maxTrim > 0 && bw >= 16 && bh >= 16) {
    const int midX0 = left + static_cast<int>(bw * 0.30f);
    const int midX1 = std::max(midX0 + 1, left + static_cast<int>(bw * 0.70f));
    const int midY0 = top + static_cast<int>(bh * 0.30f);
    const int midY1 = std::max(midY0 + 1, top + static_cast<int>(bh * 0.70f));

    auto isSolidRow = [&](int y) noexcept -> bool {
      int solid = 0;
      const int len = midX1 - midX0;
      for (int x = midX0; x < midX1; ++x) {
        if (alphaAt(x, y) >= kSolidTileAlpha) ++solid;
      }
      return solid * 100 >= len * 85;
    };

    auto isSolidCol = [&](int x) noexcept -> bool {
      int solid = 0;
      const int len = midY1 - midY0;
      for (int y = midY0; y < midY1; ++y) {
        if (alphaAt(x, y) >= kSolidTileAlpha) ++solid;
      }
      return solid * 100 >= len * 85;
    };

    for (int t = 0; t < maxTrim && bottom - top > 16 && !isSolidRow(top); ++t) ++top;
    for (int t = 0; t < maxTrim && bottom - top > 16 && !isSolidRow(bottom - 1); ++t) --bottom;
    for (int t = 0; t < maxTrim && right - left > 16 && !isSolidCol(left); ++t) ++left;
    for (int t = 0; t < maxTrim && right - left > 16 && !isSolidCol(right - 1); ++t) --right;
  }

  const int tw = right - left;
  const int th = bottom - top;
  const int side = std::max(1, std::min(tw, th));
  const int cx = left + (tw - side) / 2;
  const int cy = top + (th - side) / 2;
  return outpaintFullBleedTile(copySubrect(src, cx, cy, side, side));
}

}  // namespace haus::icons
