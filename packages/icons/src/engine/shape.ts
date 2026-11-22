/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const f = Math.fround;

export function standardIconCornerRadius(size: number, continuousContour = true): number {
  return size * (continuousContour ? 0.26 : 0.225);
}

export function categorizeIconShape(
  width: number,
  height: number,
  radius: number,
  continuousContour = true,
): number {
  const min = Math.min(width, height);
  const max = Math.max(width, height);
  if (f(min / max) < f(0.97) && Math.abs(width - height) > 2) return 7;
  if (radius >= min * 0.48) return 0;
  if (radius === 0) return 6;
  if (radius > min * 0.305) return 1;
  if (radius < min * 0.115) return 5;
  const standard = standardIconCornerRadius(min, continuousContour);
  if (radius - standard > min * 0.002) return 2;
  return standard - radius <= min * 0.025 ? 3 : 4;
}

export interface DetectedIconShape {
  detected: boolean;
  bounds: [number, number, number, number];
  radius: number;
}

export function detectIconShape(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): DetectedIconShape {
  const result: DetectedIconShape = {
    detected: false,
    bounds: [0, 0, width, height],
    radius: 0,
  };
  if (width !== height || width < 2) return result;
  const alpha = (x: number, y: number) => rgba[(x + y * width) * 4 + 3] ?? 0;
  const scan = (maximum: number, coordinate: (i: number) => readonly [number, number]) => {
    for (let i = 0; i < maximum; i += 1) {
      const [x, y] = coordinate(i);
      if (alpha(x, y) > 252) return i;
    }
    return maximum;
  };
  const mid = Math.trunc(width / 2);
  const left = scan(mid, (i) => [i, mid]);
  if (left === mid) return result;
  const rightInset = scan(mid, (i) => [width - 1 - i, mid]);
  if (rightInset === mid) return result;
  const top = scan(mid, (i) => [mid, i]);
  if (top === mid) return result;
  const bottomInset = scan(mid, (i) => [mid, height - 1 - i]);
  if (bottomInset === mid) return result;
  const right = width - rightInset;
  const bottom = height - bottomInset;
  const bodyWidth = right - left;
  const bodyHeight = bottom - top;
  result.bounds = [left, top, bodyWidth, bodyHeight];
  const min = Math.min(bodyWidth, bodyHeight);
  const max = Math.max(bodyWidth, bodyHeight);
  if (f(min / max) < f(0.97) && Math.abs(bodyWidth - bodyHeight) > 2) return result;
  const diagonalHalf = Math.trunc(min / 2);
  const diagonals = [
    scan(diagonalHalf, (i) => [left + i, top + i]),
    scan(diagonalHalf, (i) => [right - 1 - i, top + i]),
    scan(diagonalHalf, (i) => [left + i, bottom - 1 - i]),
    scan(diagonalHalf, (i) => [right - 1 - i, bottom - 1 - i]),
  ];
  if (diagonals.includes(diagonalHalf)) return result;
  const largest = Math.max(...diagonals);
  const smallest = Math.min(...diagonals);
  const radius = Math.trunc(Math.min(diagonalHalf, largest * (2 + Math.SQRT2)));
  const error = Math.trunc((largest - smallest) * Math.SQRT2);
  result.radius = radius;
  if (error >= 8) return result;
  const marginTop = Math.max(0, top - 1);
  const marginBottom = Math.min(height, bottom + 1);
  const marginLeft = Math.max(0, left - 1);
  const marginRight = Math.min(width, right + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        (y < marginTop || y >= marginBottom || x < marginLeft || x >= marginRight) &&
        alpha(x, y) > 252
      ) {
        return result;
      }
    }
  }
  const opaque = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) if (alpha(x, y) < 236) return false;
    }
    return true;
  };
  const centralLeft = Math.max(left + 4, left + radius);
  const centralRight = Math.min(right - 4, right - radius);
  const centralTop = Math.max(top + 4, top + radius);
  const centralBottom = Math.min(bottom - 4, bottom - radius);
  if (
    !opaque(centralLeft, top + 4, centralRight, centralTop) ||
    !opaque(left + 4, centralTop, right - 4, centralBottom) ||
    !opaque(centralLeft, centralBottom, centralRight, bottom - 4)
  ) {
    return result;
  }
  const outer = f(radius + error + 1.75);
  const inner = f(radius - 5.25);
  const corners: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [left, top, left + radius, top + radius, left + radius, top + radius],
    [right - radius, top, right, top + radius, right - radius, top + radius],
    [left, bottom - radius, left + radius, bottom, left + radius, bottom - radius],
    [right - radius, bottom - radius, right, bottom, right - radius, bottom - radius],
  ];
  for (const [x0, y0, x1, y1, cx, cy] of corners) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = f(x + 0.5 - cx);
        const dy = f(y + 0.5 - cy);
        const dist = f(Math.sqrt(f(dx * dx + f(dy * dy))));
        if ((dist < inner && alpha(x, y) < 236) || (dist > outer && alpha(x, y) > 252)) {
          return result;
        }
      }
    }
  }
  result.detected = true;
  return result;
}

export function cropIconPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  bounds: readonly [number, number, number, number],
): { rgba: Uint8Array; width: number; height: number } {
  const [x, y, w, h] = bounds;
  if (x < 0 || y < 0 || x + w > width || y + h > height) {
    throw new Error('Icon crop exceeds source bounds');
  }
  const result = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    result.set(
      rgba.subarray(((row + y) * width + x) * 4, ((row + y) * width + x + w) * 4),
      row * w * 4,
    );
  }
  return { rgba: result, width: w, height: h };
}

export function outpaintIconCorners(
  input: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  targetRadius: number,
): Uint8Array {
  const rgba = Uint8Array.from(input);
  const corners: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [0, 0, radius, radius, radius, radius],
    [width - radius, 0, width, radius, width - radius, radius],
    [0, height - radius, radius, height, radius, height - radius],
    [width - radius, height - radius, width, height, width - radius, height - radius],
  ];
  for (const [x0, y0, x1, y1, cx, cy] of corners) {
    const mask = new Uint8Array(radius * radius);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const dx = f(x + 0.5 - cx);
        const dy = f(y + 0.5 - cy);
        mask[x - x0 + (y - y0) * radius] =
          f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))) >= radius - 2 ? 255 : 0;
      }
    }
    for (let iteration = 1; iteration <= radius - targetRadius + 3; iteration += 1) {
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = x - x0 + (y - y0) * radius;
          if (mask[index] !== 255) continue;
          const sum = [0, 0, 0];
          let alphaSum = 0;
          let count = 0;
          for (let xx = Math.max(x0, x - 1); xx <= Math.min(x1 - 1, x + 1); xx += 1) {
            for (let yy = Math.max(y0, y - 1); yy <= Math.min(y1 - 1, y + 1); yy += 1) {
              if ((mask[xx - x0 + (yy - y0) * radius] ?? 0) >= iteration) continue;
              const offset = (xx + yy * width) * 4;
              const a = f((rgba[offset + 3] ?? 0) / 255);
              if (a < 0.99) continue;
              count += 1;
              alphaSum = f(alphaSum + a);
              for (let c = 0; c < 3; c += 1) {
                sum[c] = f((sum[c] ?? 0) + f(f((rgba[offset + c] ?? 0) / 255) / a));
              }
            }
          }
          if (count < 2) continue;
          const alpha = f(alphaSum / f(count));
          const offset = (x + y * width) * 4;
          for (let c = 0; c < 3; c += 1) {
            rgba[offset + c] = Math.trunc(f(f(f((sum[c] ?? 0) / f(count)) * alpha) * 255));
          }
          rgba[offset + 3] = Math.trunc(f(alpha * 255));
          mask[index] = iteration & 255;
        }
      }
    }
  }
  return rgba;
}

export function removeIconShadow(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): { success: true; rgba: Uint8Array } | { success: false; reason: string } {
  const read = (x: number, y: number) => {
    const offset = (x + y * width) * 4;
    const alpha = f((rgba[offset + 3] ?? 0) / 255);
    const color: [number, number, number] = [
      alpha === 0 ? 0 : f(f((rgba[offset] ?? 0) / 255) / alpha),
      alpha === 0 ? 0 : f(f((rgba[offset + 1] ?? 0) / 255) / alpha),
      alpha === 0 ? 0 : f(f((rgba[offset + 2] ?? 0) / 255) / alpha),
    ];
    return { alpha, color };
  };
  const distance = (a: readonly number[], b: readonly number[]) => {
    const d0 = f((a[0] ?? 0) - (b[0] ?? 0));
    const d1 = f((a[1] ?? 0) - (b[1] ?? 0));
    const d2 = f((a[2] ?? 0) - (b[2] ?? 0));
    return f(Math.sqrt(f(f(d2 * d2) + f(f(d0 * d0) + f(d1 * d1)))));
  };
  const flags = new Uint8Array(width * height);
  const sum = [0, 0, 0];
  let alphaSum = 0;
  let count = 0;
  let maximumAlpha = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let opaque = 0;
      let transparent = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(height - 1, y + 2); yy += 1) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(width - 1, x + 2); xx += 1) {
          if (Math.abs(xx - x) + Math.abs(yy - y) >= 4) continue;
          if ((rgba[(xx + yy * width) * 4 + 3] ?? 0) >= 250) opaque += 1;
          else transparent += 1;
        }
      }
      flags[x + y * width] =
        (opaque && transparent ? 0 : 2) | Number((rgba[(x + y * width) * 4 + 3] ?? 0) >= 250);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (((flags[x + y * width] ?? 0) & 3) !== 2) continue;
      const sample = read(x, y);
      const premul: [number, number, number] = [
        f(sample.color[0] * sample.alpha),
        f(sample.color[1] * sample.alpha),
        f(sample.color[2] * sample.alpha),
      ];
      const max = Math.max(...premul);
      const min = Math.min(...premul);
      if (max >= 0.15 || f(max - min) >= 5 / 255 || sample.alpha >= 0.71) {
        return { success: false, reason: 'non-shadow-transparent-content' };
      }
      count += 1;
      for (let c = 0; c < 3; c += 1) sum[c] = f((sum[c] ?? 0) + (premul[c] ?? 0));
      alphaSum = f(alphaSum + sample.alpha);
      maximumAlpha = Math.max(maximumAlpha, sample.alpha);
    }
  }
  if (!count || !alphaSum) return { success: false, reason: 'no-shadow-samples' };
  const shadowColor = [
    f((sum[0] ?? 0) / alphaSum),
    f((sum[1] ?? 0) / alphaSum),
    f((sum[2] ?? 0) / alphaSum),
  ];
  const output = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = x + y * width;
      const sample = read(x, y);
      let color: [number, number, number] = sample.color;
      let alpha = sample.alpha;
      const flagValue = flags[index] ?? 0;
      if (!(flagValue & 1)) {
        if (flagValue & 2) alpha = 0;
        else {
          let foregroundDistance = 2147483647;
          let shadowDistance = foregroundDistance;
          let foregroundCount = 0;
          let shadowCount = 0;
          let localAlpha = 0;
          let matches = false;
          const localColor: [number, number, number] = [0, 0, 0];
          for (let xx = Math.max(0, x - 7); xx <= Math.min(width - 1, x + 7); xx += 1) {
            for (let yy = Math.max(0, y - 7); yy <= Math.min(height - 1, y + 7); yy += 1) {
              const neighborFlag = flags[xx + yy * width] ?? 0;
              const neighbor = read(xx, yy);
              const d = Math.abs(xx - x) + Math.abs(yy - y);
              if (neighborFlag & 1) {
                if (d > foregroundDistance) continue;
                if (d < foregroundDistance) {
                  foregroundDistance = d;
                  foregroundCount = 0;
                  localColor.fill(0);
                  matches = false;
                }
                foregroundCount += 1;
                for (let c = 0; c < 3; c += 1) {
                  localColor[c] = f(localColor[c]! + neighbor.color[c]!);
                }
                matches ||= distance(sample.color, neighbor.color) < 2 / 255;
              } else if (neighborFlag & 2) {
                if (d > shadowDistance) continue;
                if (d < shadowDistance) {
                  shadowDistance = d;
                  shadowCount = 0;
                  localAlpha = 0;
                }
                shadowCount += 1;
                localAlpha = f(localAlpha + neighbor.alpha);
              }
            }
          }
          if (!foregroundCount)
            return { success: false, reason: 'shadow-without-foreground-neighbor' };
          color = matches
            ? sample.color
            : [
                f(localColor[0] / f(foregroundCount)),
                f(localColor[1] / f(foregroundCount)),
                f(localColor[2] / f(foregroundCount)),
              ];
          let shadowAlpha: number;
          if (distance(color, shadowColor) >= 1e-6) {
            const premul = [
              f(sample.color[0] * sample.alpha),
              f(sample.color[1] * sample.alpha),
              f(sample.color[2] * sample.alpha),
            ];
            const dir = [
              f(
                f((shadowColor[0] ?? 0) + f((premul[0] ?? 0) - color[0])) -
                  f((shadowColor[0] ?? 0) * sample.alpha),
              ),
              f(
                f((shadowColor[1] ?? 0) + f((premul[1] ?? 0) - color[1])) -
                  f((shadowColor[1] ?? 0) * sample.alpha),
              ),
              f(
                f((shadowColor[2] ?? 0) + f((premul[2] ?? 0) - color[2])) -
                  f((shadowColor[2] ?? 0) * sample.alpha),
              ),
            ];
            const delta = [
              f((premul[0] ?? 0) - f(color[0] * sample.alpha)),
              f((premul[1] ?? 0) - f(color[1] * sample.alpha)),
              f((premul[2] ?? 0) - f(color[2] * sample.alpha)),
            ];
            const dot = (a: readonly number[], b: readonly number[]) =>
              f(
                f((a[2] ?? 0) * (b[2] ?? 0)) +
                  f(f((a[0] ?? 0) * (b[0] ?? 0)) + f((a[1] ?? 0) * (b[1] ?? 0))),
              );
            shadowAlpha = Math.min(
              maximumAlpha,
              sample.alpha,
              Math.max(0, f(dot(delta, dir) / dot(dir, dir))),
            );
          } else {
            shadowAlpha = shadowCount ? f(localAlpha / f(shadowCount)) : maximumAlpha;
          }
          alpha = f(f(sample.alpha - shadowAlpha) / f(1 - shadowAlpha));
        }
      }
      const offset = index * 4;
      for (let c = 0; c < 3; c += 1) {
        output[offset + c] = Math.trunc(f(f((color[c] ?? 0) * 255) * alpha));
      }
      output[offset + 3] = Math.trunc(f(alpha * 255));
    }
  }
  return { success: true, rgba: output };
}
