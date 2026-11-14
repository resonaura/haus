/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  SegmentationRandom,
  almostOpaquePixel,
  clampedProject,
  pixelColor,
  type TaggedPixels,
} from './math';

const f = Math.fround;
export const dot3 = (a: readonly number[], b: readonly number[]) =>
  f(f((a[2] ?? 0) * (b[2] ?? 0)) + f(f((a[0] ?? 0) * (b[0] ?? 0)) + f((a[1] ?? 0) * (b[1] ?? 0))));
export const subtract3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  f((a[0] ?? 0) - (b[0] ?? 0)),
  f((a[1] ?? 0) - (b[1] ?? 0)),
  f((a[2] ?? 0) - (b[2] ?? 0)),
];
export const clamp01 = (v: number) => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));
export const mix3 = (
  a: readonly number[],
  b: readonly number[],
  amount: number,
): [number, number, number] => [
  f(f((b[0] ?? 0) - (a[0] ?? 0)) * amount + (a[0] ?? 0)),
  f(f((b[1] ?? 0) - (a[1] ?? 0)) * amount + (a[1] ?? 0)),
  f(f((b[2] ?? 0) - (a[2] ?? 0)) * amount + (a[2] ?? 0)),
];

export function colorDistance(a: readonly number[], b: readonly number[]): number {
  const d0 = f((a[0] ?? 0) - (b[0] ?? 0));
  const d1 = f((a[1] ?? 0) - (b[1] ?? 0));
  const d2 = f((a[2] ?? 0) - (b[2] ?? 0));
  return f(Math.sqrt(f(f(f(d0 * d0) + f(d1 * d1)) + f(d2 * d2))));
}

export function meanColor(samples: ReadonlyArray<readonly number[]>): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (const color of samples) {
    result[0] = f(result[0] + (color[0] ?? 0));
    result[1] = f(result[1] + (color[1] ?? 0));
    result[2] = f(result[2] + (color[2] ?? 0));
  }
  return [
    f(result[0] / samples.length),
    f(result[1] / samples.length),
    f(result[2] / samples.length),
  ];
}

export function colorCovariance(
  samples: ReadonlyArray<readonly number[]>,
  mean: readonly number[] = meanColor(samples),
): Float32Array {
  const covariance = new Float32Array(9);
  for (const sample of samples) {
    const delta = subtract3(sample, mean);
    for (let col = 0; col < 3; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        covariance[col * 3 + row] = f(
          (covariance[col * 3 + row] ?? 0) + f((delta[col] ?? 0) * (delta[row] ?? 0)),
        );
      }
    }
  }
  const reciprocal = f(1 / samples.length);
  return covariance.map((v) => f(v * reciprocal));
}

export function colorClusters(
  samples: ReadonlyArray<readonly number[]>,
  minimum = 10,
  epsilon = f(11 / 255),
) {
  const labels = new Int32Array(samples.length).fill(-2147483648);
  const queued = new Uint8Array(samples.length);
  const squared = f(epsilon * epsilon);
  const neighbors = (index: number) => {
    const available: number[] = [];
    let count = 0;
    const base = samples[index]!;
    for (let j = 0; j < samples.length; j += 1) {
      const delta = subtract3(base, samples[j]!);
      const dist = f(f(delta[2] * delta[2]) + f(f(delta[0] * delta[0]) + f(delta[1] * delta[1])));
      if (dist <= squared) {
        count += 1;
        if (!queued[j]) available.push(j);
      }
    }
    return { count, available };
  };
  let clusters = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (labels[i] !== -2147483648) continue;
    const initial = neighbors(i);
    if (initial.count < minimum) {
      labels[i] = -1;
      continue;
    }
    const stack = initial.available;
    for (const j of stack) queued[j] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      if (labels[j] === -2147483648) {
        labels[j] = clusters;
        const next = neighbors(j);
        if (next.count >= minimum) {
          stack.push(...next.available);
          for (const k of next.available) queued[k] = 1;
        }
      } else if (labels[j] === -1) {
        labels[j] = clusters;
      }
    }
    queued.fill(0);
    clusters += 1;
  }
  const counts = new Uint32Array(clusters);
  const colors: Array<[number, number, number]> = Array.from({ length: clusters }, () => [0, 0, 0]);
  let noise = 0;
  samples.forEach((sample, i) => {
    const label = labels[i] ?? -1;
    if (label < 0) {
      noise += 1;
      return;
    }
    counts[label] = (counts[label] ?? 0) + 1;
    for (let c = 0; c < 3; c += 1) {
      colors[label]![c] = f((colors[label]![c] ?? 0) + (sample[c] ?? 0));
    }
  });
  for (let i = 0; i < clusters; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      colors[i]![c] = f((colors[i]![c] ?? 0) / (counts[i] ?? 1));
    }
  }
  return { clusters, labels, colors, counts, noise };
}

function hsvColor(hue: number, saturation: number, value: number): [number, number, number] {
  return [1, f(2 / 3), f(1 / 3)].map((offset) => {
    let x = f(hue + offset);
    x = Math.min(f(x - Math.floor(x)), f(1 - 2 ** -24));
    x = f(Math.abs(f(6 * x - 3)) - 1);
    x = f(Math.min(1, Math.max(0, x)) - 1);
    return f(f(x * saturation + 1) * value);
  }) as [number, number, number];
}

export function grayscaleConversion(
  samples: ReadonlyArray<readonly number[]>,
  saturation = f(0.65),
  energyRatio = f(0.3),
): [number, number, number] {
  const luma = (color: readonly number[]) =>
    f(
      f((color[2] ?? 0) * f(0.0722)) +
        f(f((color[0] ?? 0) * f(0.2126)) + f((color[1] ?? 0) * f(0.7152))),
    );
  const normalize = (color: readonly number[]): [number, number, number] => {
    const scale = f(1 / f((color[2] ?? 0) + f((color[0] ?? 0) + (color[1] ?? 0))));
    return [f((color[0] ?? 0) * scale), f((color[1] ?? 0) * scale), f((color[2] ?? 0) * scale)];
  };
  let bestHue = 0;
  let bestScore = -3.4028234663852886e38;
  for (let hue = 0; hue < 1; hue = f(hue + 0.02)) {
    const weights = normalize(hsvColor(hue, saturation, 0.5));
    let distortion = 0;
    for (const color of samples) {
      distortion = f(distortion + Math.abs(f(dot3(color, weights) - luma(color))));
    }
    const random = new SegmentationRandom(10);
    let energy = 0;
    let count = 0;
    for (let i = 0; i < 300; i += 1) {
      const a = samples[random.integer(0, samples.length)]!;
      const b = samples[random.integer(0, samples.length)]!;
      if (colorDistance(a, b) > 20 / 255) {
        const delta = Math.abs(f(dot3(a, weights) - dot3(b, weights)));
        energy = f(energy + f(Math.log(f(delta + 1))));
        count += 1;
      }
    }
    const average = f(energy / count);
    const score = f(energyRatio * f(f(-distortion / f(samples.length)) - average) + average);
    if (score > bestScore) {
      bestScore = score;
      bestHue = hue;
    }
  }
  return normalize(
    hsvColor(Math.min(f(bestHue - Math.floor(bestHue)), f(1 - 2 ** -24)), saturation, 0.5),
  );
}

export function foregroundRatioAndAlpha(
  color: readonly number[],
  a: readonly number[],
  b: readonly number[],
): { ratio: number; alpha: number } {
  const aa = dot3(a, a);
  const bb = dot3(b, b);
  const length = f(Math.sqrt(dot3(color, color)));
  if (length < f(Math.sqrt(aa)) * 1e-5 && length < f(Math.sqrt(bb)) * 1e-5) {
    return { ratio: 0, alpha: 0 };
  }
  const direction = subtract3(b, a);
  const dd = dot3(direction, direction);
  const invA = f(1 / Math.sqrt(aa));
  const invB = f(1 / Math.sqrt(bb));
  const cosine = dot3(
    [f((a[0] ?? 0) * invA), f((a[1] ?? 0) * invA), f((a[2] ?? 0) * invA)],
    [f((b[0] ?? 0) * invB), f((b[1] ?? 0) * invB), f((b[2] ?? 0) * invB)],
  );
  const projectToPair = () => ({
    ratio: f(dot3(subtract3(color, a), direction) / dd),
    alpha: 1,
  });
  if (cosine > 0.9992) return projectToPair();
  const ad = dot3(a, direction);
  const determinant = f(aa * dd + f(-ad * ad));
  if (determinant < 1e-6) return projectToPair();
  const ca = dot3(color, a);
  const cd = dot3(color, direction);
  const alpha = f(f(ca * dd + f(-cd * ad)) / determinant);
  const ratio = f(f(f(cd * aa + f(-ca * ad)) / determinant) / alpha);
  return { ratio, alpha };
}

export function extendColorConfidence(
  flags: Uint8Array,
  width: number,
  height: number,
  extra = true,
): Uint8Array {
  const radius = extra ? 2 : 1;
  const bit = extra ? 8 : 4;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = x + y * width;
      if (!((flags[index] ?? 0) & 2)) continue;
      let stable = true;
      for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 1) {
        const vertical = extra ? radius - Math.abs(xx - x) : radius;
        for (
          let yy = Math.max(0, y - vertical);
          yy <= Math.min(height - 1, y + vertical);
          yy += 1
        ) {
          if (!((flags[xx + yy * width] ?? 0) & 2)) stable = false;
        }
      }
      if (stable) flags[index] = (flags[index] ?? 0) | bit;
    }
  }
  return flags;
}

export function connectedBackgroundFlags(
  flags: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  for (let i = 0; i < flags.length; i += 1) flags[i] = (flags[i] ?? 0) & 127;
  const update = (x: number, y: number) => {
    const index = x + y * width;
    if ((flags[index] ?? 0) & 1) return;
    let connected = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (!connected) {
      for (let xx = x - 1; xx <= x + 1; xx += 1) {
        for (let yy = y - 1; yy <= y + 1; yy += 1) {
          connected ||= Boolean((flags[xx + yy * width] ?? 0) & 128);
        }
      }
    }
    if (connected) flags[index] = (flags[index] ?? 0) | 128;
  };
  for (let x = 0; x < width; x += 1) {
    update(x, 0);
    update(x, height - 1);
  }
  for (let x = width - 1; x >= 0; x -= 1) {
    update(x, 0);
    update(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    update(0, y);
    update(width - 1, y);
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    update(0, y);
    update(width - 1, y);
  }
  for (
    let ring = 1, right = width - 2, bottom = height - 2;
    ring < right + 1 && ring < bottom + 1;
    ring += 1, right -= 1, bottom -= 1
  ) {
    for (let x = 0; x < width; x += 1) {
      update(x, ring);
      update(x, bottom);
    }
    for (let x = width - 1; x >= 0; x -= 1) {
      update(x, ring);
      update(x, bottom);
    }
    for (let y = 0; y < height; y += 1) {
      update(ring, y);
      update(right, y);
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      update(ring, y);
      update(right, y);
    }
  }
  return flags;
}

export function hasEyeFeature(
  rgba: TaggedPixels,
  width: number,
  height: number,
  x: number,
  y: number,
  flags: Uint8Array,
): boolean {
  const getColor = (px: number, py: number) => pixelColor(rgba, px + py * width);
  const white = [1, 1, 1] as const;
  const black = [0, 0, 0] as const;
  if (colorDistance(getColor(x, y), white) >= f(70 / 255)) return false;
  for (let xx = Math.max(0, x - 3); xx <= Math.min(width - 1, x + 3); xx += 1) {
    for (let yy = Math.max(0, y - 3); yy <= Math.min(height - 1, y + 3); yy += 1) {
      if ((flags[xx + yy * width] ?? 0) & 128) return false;
    }
  }
  const scan = (direction: number) => {
    let dark = 0;
    const end =
      direction < 0
        ? Math.max(0, x - Math.floor(width / 20))
        : Math.min(width - 1, x + Math.floor(width / 20));
    for (let xx = x; direction < 0 ? xx >= end : xx <= end; xx += direction) {
      const color = getColor(xx, y);
      const isDark = colorDistance(color, black) < f(90 / 255);
      const chroma = colorDistance(color, clampedProject(color, black, white));
      if (!dark) {
        if (isDark) dark = 1;
        else if (chroma >= f(50 / 255)) return { dark, found: false };
      } else if (isDark) {
        dark += 1;
      } else {
        if (colorDistance(color, white) < f(70 / 255)) return { dark, found: false };
        if (chroma >= f(50 / 255)) return { dark, found: true };
      }
    }
    return { dark, found: false };
  };
  const left = scan(-1);
  const right = scan(1);
  const threshold = Math.floor((width * height) / 100000);
  return left.dark > threshold && right.dark > threshold && (left.found || right.found);
}

export function shadowSegmentation(
  rgba: TaggedPixels,
  width: number,
  height: number,
  flags: Uint8Array,
  background: readonly [number, number, number],
) {
  const getColor = (x: number, y: number) => pixelColor(rgba, x + y * width);
  const denominator = dot3(background, background);
  let shadows = 0;
  let curved = 0;
  let minimum = 1;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = x + y * width;
      if (!((flags[index] ?? 0) & 1) || !almostOpaquePixel(rgba, index)) continue;
      const color = getColor(x, y);
      const alpha = clamp01(f(dot3(background, color) / denominator));
      const scaled: [number, number, number] = [
        f(background[0] * alpha),
        f(background[1] * alpha),
        f(background[2] * alpha),
      ];
      if (alpha >= 0.77 && colorDistance(color, scaled) < 3 / 255) {
        flags[index] = (flags[index] ?? 0) | 32;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const index = x + y * width;
      if (!((flags[index] ?? 0) & 32)) continue;
      shadows += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      if (
        [index - 1, index + 1, index - width, index + width].some(
          (i) => ((flags[i] ?? 0) & 33) === 1,
        )
      ) {
        continue;
      }
      const center = getColor(x, y);
      const left = getColor(x - 1, y);
      const right = getColor(x + 1, y);
      const up = getColor(x, y - 1);
      const down = getColor(x, y + 1);
      const horizontal = Math.min(
        ...center.map((v, c) => f(f(v - (left[c] ?? 0)) * f((right[c] ?? 0) - v))),
      );
      const vertical = Math.min(
        ...center.map((v, c) => f(f(v - (up[c] ?? 0)) * f((down[c] ?? 0) - v))),
      );
      if (Math.max(horizontal, vertical) > 0) {
        flags[index] = (flags[index] ?? 0) | 64;
        curved += 1;
      }
    }
  }
  const ratio = curved / shadows;
  if (ratio > 0.525 || (ratio > 0.32 && shadows / (width * height) < 0.038)) {
    for (let i = 0; i < flags.length; i += 1) {
      if ((flags[i] ?? 0) & 32) {
        minimum = Math.min(
          minimum,
          clamp01(f(dot3(background, getColor(i % width, Math.floor(i / width))) / denominator)),
        );
      }
    }
  }
  return { minimum, shadows, curved };
}
