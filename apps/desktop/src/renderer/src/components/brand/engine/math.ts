/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const f = Math.fround;
const add = (a: number, b: number) => f(a + b);
const mul = (a: number, b: number) => f(a * b);
const madd = (a: number, b: number, c: number) => f(a * b + c);
const identity3 = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

const bitBuffer = new ArrayBuffer(4);
const bitFloat = new Float32Array(bitBuffer);
const bitInteger = new Uint32Array(bitBuffer);
const floatBits = (bits: number) => {
  bitInteger[0] = bits >>> 0;
  return bitFloat[0] ?? 0;
};

export const COVARIANCE_REGULARIZATION = 1.0049500360764796e-6;

export type AlphaMode = 'premultiplied' | 'opaque';

export type TaggedPixels = Uint8ClampedArray & { alphaMode?: AlphaMode };

/** Converts IEEE-754 float64/float32 into unsigned 16-bit binary16 representation. */
export function float16Bits(value: number): number {
  bitFloat[0] = value;
  const word = bitInteger[0] ?? 0;
  const sign = (word >>> 16) & 0x8000;
  let exponent = ((word >>> 23) & 255) - 127 + 15;
  let mantissa = word & 0x7fffff;
  if (exponent >= 31) {
    return sign | 0x7c00 | (mantissa && ((word >>> 23) & 255) === 255 ? 0x200 : 0);
  }
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa |= 0x800000;
    const shift = 14 - exponent;
    const result = mantissa >>> shift;
    const remainder = mantissa & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    return (
      sign | (result + Number(remainder > halfway || (remainder === halfway && (result & 1) === 1)))
    );
  }
  let result = mantissa >>> 13;
  const remainder = mantissa & 8191;
  if (remainder > 4096 || (remainder === 4096 && (result & 1) === 1)) result += 1;
  if (result === 1024) {
    result = 0;
    exponent += 1;
  }
  return sign | (exponent << 10) | result;
}

/** Decodes unsigned 16-bit binary16 pattern into a JavaScript number. */
export function float16Value(word: number): number {
  const sign = word & 32768 ? -1 : 1;
  const exponent = (word >>> 10) & 31;
  const fraction = word & 1023;
  if (!exponent) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export const half = (value: number): number => float16Value(float16Bits(value));

/** Fused half multiply-add rounding the exact product+addend directly to float16. */
export function halfFma(a: number, b: number, c: number): number {
  const value = a * b + c;
  const stored = float16Bits(value);
  if (f(value) === value || !Number.isFinite(value)) return float16Value(stored);
  const magnitude = Math.abs(value);
  const sign = stored & 0x8000 ? -1 : 1;
  if (magnitude >= 65520) return sign * Infinity;
  const word = stored & 0x7fff;
  if (word === 0x7c00) return sign * 65504;
  const nearest = float16Value(word);
  const other = float16Value(magnitude > nearest ? word + 1 : word - 1);
  const midpoint = (nearest + other) * 0.5;
  const result =
    magnitude === midpoint
      ? word & 1
        ? other
        : nearest
      : magnitude < midpoint
        ? Math.min(nearest, other)
        : Math.max(nearest, other);
  return sign * result;
}

export const saturate = (value: number): number => Math.min(1, Math.max(0, value));
export const halfMix = (a: number, b: number, t: number): number => halfFma(half(b - a), t, a);

export function pixelOpacity(
  rgba: TaggedPixels | Uint8Array | Uint8ClampedArray,
  index: number,
): number {
  const mode = 'alphaMode' in rgba ? rgba.alphaMode : undefined;
  return mode === 'premultiplied' ? f((rgba[index * 4 + 3] ?? 0) / 255) : 1;
}

export function almostOpaquePixel(
  rgba: TaggedPixels | Uint8Array | Uint8ClampedArray,
  index: number,
): boolean {
  const mode = 'alphaMode' in rgba ? rgba.alphaMode : undefined;
  return mode !== 'premultiplied' || (rgba[index * 4 + 3] ?? 0) >= 253;
}

export function pixelColor(
  rgba: TaggedPixels | Uint8Array | Uint8ClampedArray,
  index: number,
): [number, number, number] {
  const offset = index * 4;
  const mode = 'alphaMode' in rgba ? rgba.alphaMode : undefined;
  const alpha = pixelOpacity(rgba, index);
  const r = f((rgba[offset] ?? 0) / 255);
  const g = f((rgba[offset + 1] ?? 0) / 255);
  const b = f((rgba[offset + 2] ?? 0) / 255);
  if (mode === 'premultiplied' && alpha > 0) {
    return [f(r / alpha), f(g / alpha), f(b / alpha)];
  }
  return [r, g, b];
}

export function premultipliedIconPixels(rgba: Uint8ClampedArray): TaggedPixels {
  const tagged: TaggedPixels = rgba;
  tagged.alphaMode = 'premultiplied';
  return tagged;
}

/** Float32 exponential range reduction and polynomial approximation. */
export function segmentationVectorExp(value: number): number {
  let x = Math.min(Math.max(value, floatBits(0xc2cff1b5)), floatBits(0x42b17218));
  const exponent = Math.floor(mul(x, floatBits(0x3fb8aa3b)));
  x = madd(floatBits(0xbf318000), exponent, x);
  x = madd(floatBits(0x395e8083), exponent, x);
  let polynomial = madd(floatBits(0x3aea6bc0), x, floatBits(0x3c045bfb));
  polynomial = madd(polynomial, x, floatBits(0x3d2aee9a));
  polynomial = madd(polynomial, x, floatBits(0x3e2aa92b));
  polynomial = madd(polynomial, x, floatBits(0x3f000001));
  polynomial = madd(polynomial, x, 1);
  polynomial = madd(x, polynomial, 1);
  const underflow = exponent + 127 <= 0;
  let result = mul(polynomial, floatBits((exponent + (underflow ? 254 : 127)) << 23));
  if (underflow) result = mul(result, floatBits(0x00400000));
  return result;
}

/** Minimal standard Park-Miller LCG matching BSD rand_r sequence. */
export class SegmentationRandom {
  seed: number;
  constructor(seed = 10) {
    this.seed = seed >>> 0;
  }
  next(): number {
    const value = this.seed || 123459876;
    const high = Math.floor(value / 127773);
    const low = value % 127773;
    let next = 16807 * low - 2836 * high;
    if (next < 0) next += 2147483647;
    this.seed = next >>> 0;
    return this.seed & 0x7fffffff;
  }
  uniform(): number {
    return mul(f(this.next()), 2 ** -31);
  }
  integer(lower: number, upper: number): number {
    return lower + Math.trunc(mul(this.uniform(), upper - lower));
  }
  normal(): number {
    let x = 0;
    let y = 0;
    let radius = 0;
    do {
      x = f((2 * f(this.next())) / 2147483647 - 1);
      y = f((2 * f(this.next())) / 2147483647 - 1);
      radius = madd(x, x, mul(y, y));
    } while (radius === 0 || radius >= 1);
    return mul(f(Math.sqrt(f(mul(-2, f(Math.log(radius))) / radius))), x);
  }
}

export function determinant3(m: Float32Array): number {
  const m0 = m[0] ?? 0;
  const m1 = m[1] ?? 0;
  const m2 = m[2] ?? 0;
  const m3 = m[3] ?? 0;
  const m4 = m[4] ?? 0;
  const m5 = m[5] ?? 0;
  const m6 = m[6] ?? 0;
  const m7 = m[7] ?? 0;
  const m8 = m[8] ?? 0;
  const c0 = madd(m8, m4, -mul(m5, m7));
  const c1 = madd(m6, m5, -mul(m3, m8));
  const c2 = madd(m7, m3, -mul(m4, m6));
  return add(mul(m2, c2), add(mul(m0, c0), mul(m1, c1)));
}

export function inverse3(m: Float32Array): Float32Array {
  const a = m[0] ?? 0;
  const b = m[1] ?? 0;
  const c = m[2] ?? 0;
  const d = m[3] ?? 0;
  const e = m[4] ?? 0;
  const z = m[5] ?? 0;
  const g = m[6] ?? 0;
  const h = m[7] ?? 0;
  const i = m[8] ?? 0;
  const c00 = madd(i, e, -mul(h, z));
  const temporary = -mul(h, c);
  const c10 = -madd(b, i, temporary);
  const c20 = madd(z, b, -mul(e, c));
  const cofactors = new Float32Array([
    c00,
    c10,
    c20,
    -madd(d, i, -mul(g, z)),
    madd(a, i, -mul(g, c)),
    -madd(a, z, -mul(d, c)),
    madd(d, h, -mul(g, e)),
    -madd(a, h, -mul(g, b)),
    madd(a, e, -mul(d, b)),
  ]);
  const determinant = madd(g, c20, madd(a, c00, -mul(madd(i, b, temporary), d)));
  const reciprocal = f(1 / determinant);
  return cofactors.map((value) => mul(value, reciprocal));
}

function quadraticForm(delta: readonly number[], inverse: Float32Array, bulk: boolean): number {
  const d0 = delta[0] ?? 0;
  const d1 = delta[1] ?? 0;
  const d2 = delta[2] ?? 0;
  const term = (c: number) =>
    bulk
      ? add(
          mul(d2, inverse[c * 3 + 2] ?? 0),
          add(mul(d0, inverse[c * 3] ?? 0), mul(d1, inverse[c * 3 + 1] ?? 0)),
        )
      : madd(inverse[c + 6] ?? 0, d2, madd(inverse[c + 3] ?? 0, d1, mul(inverse[c] ?? 0, d0)));
  return add(mul(d2, term(2)), add(mul(d0, term(0)), mul(d1, term(1))));
}

export function squaredMahalanobis(delta: readonly number[], inverse: Float32Array): number {
  return Math.max(0, quadraticForm(delta, inverse, false));
}

export interface GaussianCluster {
  mean: Float32Array;
  covariance: Float32Array;
  inverse: Float32Array;
  weight: number;
}

export function bhattacharyyaDistance(a: GaussianCluster, b: GaussianCluster): number {
  const average = a.covariance.map((v, idx) => mul(add(v, b.covariance[idx] ?? 0), 0.5));
  const inverse = inverse3(average);
  const delta = [
    f((a.mean[0] ?? 0) - (b.mean[0] ?? 0)),
    f((a.mean[1] ?? 0) - (b.mean[1] ?? 0)),
    f((a.mean[2] ?? 0) - (b.mean[2] ?? 0)),
  ];
  const q = squaredMahalanobis(delta, inverse);
  const denominator = f(Math.sqrt(mul(determinant3(a.covariance), determinant3(b.covariance))));
  const ratio = f(determinant3(average) / denominator);
  const logarithm = f(Math.log(ratio));
  const result = f(q * 0.125 + logarithm * 0.5);
  return Number.isNaN(result) ? 0 : Math.max(0, result);
}

export function clampedProject(
  point: readonly number[],
  start: readonly number[],
  end: readonly number[],
): [number, number, number] {
  const dir: [number, number, number] = [
    f((end[0] ?? 0) - (start[0] ?? 0)),
    f((end[1] ?? 0) - (start[1] ?? 0)),
    f((end[2] ?? 0) - (start[2] ?? 0)),
  ];
  const delta: [number, number, number] = [
    f((point[0] ?? 0) - (start[0] ?? 0)),
    f((point[1] ?? 0) - (start[1] ?? 0)),
    f((point[2] ?? 0) - (start[2] ?? 0)),
  ];
  const dot = (a: readonly number[], b: readonly number[]) =>
    add(mul(a[2] ?? 0, b[2] ?? 0), add(mul(a[0] ?? 0, b[0] ?? 0), mul(a[1] ?? 0, b[1] ?? 0)));
  const amount = Math.min(1, Math.max(0, f(dot(delta, dir) / dot(dir, dir))));
  const t = Number.isNaN(amount) ? 0 : amount;
  return [
    madd(dir[0], t, start[0] ?? 0),
    madd(dir[1], t, start[1] ?? 0),
    madd(dir[2], t, start[2] ?? 0),
  ];
}

export function gaussianMixture(
  samples: ReadonlyArray<readonly number[]>,
  clusterCount = 10,
  iterations = 50,
): { clusters: GaussianCluster[]; posterior: Float32Array; iterations: number } {
  const count = samples.length;
  const random = new SegmentationRandom(10);
  let clusters: GaussianCluster[] = Array.from({ length: clusterCount }, () => ({
    mean: Float32Array.from([random.uniform(), random.uniform(), random.uniform()]),
    covariance: identity3(),
    inverse: identity3(),
    weight: f(1 / clusterCount),
  }));
  const posterior = new Float32Array(count * clusterCount);
  let completedIterations = 0;
  for (let step = 0; step < iterations; step += 1) {
    for (let k = 0; k < clusterCount; k += 1) {
      const cluster = clusters[k]!;
      const determinant = Math.max(determinant3(cluster.covariance), f(1e-20));
      const normalizer = f(1 / f(Math.sqrt(mul(determinant, 0.2580122649669647))));
      for (let i = 0; i < count; i += 1) {
        const s = samples[i]!;
        const delta = [
          f((s[0] ?? 0) - (cluster.mean[0] ?? 0)),
          f((s[1] ?? 0) - (cluster.mean[1] ?? 0)),
          f((s[2] ?? 0) - (cluster.mean[2] ?? 0)),
        ];
        const distance = Math.max(0, quadraticForm(delta, cluster.inverse, i < (count & ~3)));
        const density =
          i < (count & ~3)
            ? segmentationVectorExp(mul(-0.5, distance))
            : f(Math.exp(mul(-0.5, distance)));
        posterior[k * count + i] = mul(mul(density, normalizer), cluster.weight);
      }
    }
    for (let i = 0; i < count; i += 1) {
      let sum = 0;
      for (let k = 0; k < clusterCount; k += 1) sum = add(sum, posterior[k * count + i] ?? 0);
      if (sum !== 0) {
        for (let k = 0; k < clusterCount; k += 1) {
          posterior[k * count + i] = f((posterior[k * count + i] ?? 0) / sum);
        }
      }
    }
    const next: GaussianCluster[] = [];
    let converged = true;
    for (let k = 0; k < clusterCount; k += 1) {
      const mean = new Float32Array(3);
      let total = 0;
      for (let i = 0; i < count; i += 1) {
        const probability = posterior[k * count + i] ?? 0;
        const s = samples[i]!;
        total = add(total, probability);
        for (let c = 0; c < 3; c += 1) {
          mean[c] =
            i < (count & ~3)
              ? add(mul(s[c] ?? 0, probability), mean[c] ?? 0)
              : madd(s[c] ?? 0, probability, mean[c] ?? 0);
        }
      }
      if (total === 0) {
        next.push({ mean, covariance: identity3(), inverse: identity3(), weight: 0 });
        continue;
      }
      for (let c = 0; c < 3; c += 1) mean[c] = f((mean[c] ?? 0) / total);
      const covariance = new Float32Array(9);
      for (let i = 0; i < count; i += 1) {
        const s = samples[i]!;
        const p = posterior[k * count + i] ?? 0;
        const delta = [
          f((s[0] ?? 0) - (mean[0] ?? 0)),
          f((s[1] ?? 0) - (mean[1] ?? 0)),
          f((s[2] ?? 0) - (mean[2] ?? 0)),
        ];
        const weighted = [mul(delta[0] ?? 0, p), mul(delta[1] ?? 0, p), mul(delta[2] ?? 0, p)];
        for (let row = 0; row < 3; row += 1) {
          for (let col = 0; col < 3; col += 1) {
            covariance[col * 3 + row] = add(
              mul(delta[row] ?? 0, weighted[col] ?? 0),
              covariance[col * 3 + row] ?? 0,
            );
          }
        }
      }
      const reciprocal = f(1 / total);
      for (let c = 0; c < 9; c += 1) {
        covariance[c] = add(
          mul(covariance[c] ?? 0, reciprocal),
          c % 4 === 0 ? COVARIANCE_REGULARIZATION : 0,
        );
      }
      const weight = f(total / count);
      const previous = clusters[k]!;
      if (
        weight !== previous.weight ||
        mean.some((v, idx) => v !== previous.mean[idx]) ||
        covariance.some((v, idx) => v !== previous.covariance[idx])
      ) {
        converged = false;
      }
      next.push({ mean, covariance, inverse: inverse3(covariance), weight });
    }
    clusters = next;
    completedIterations = step + 1;
    if (converged) break;
  }
  return { clusters, posterior, iterations: completedIterations };
}
