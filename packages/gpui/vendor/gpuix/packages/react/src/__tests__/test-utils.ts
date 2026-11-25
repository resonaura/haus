/// Test utilities shared across GPUIX test files.

import fs from "fs"
import zlib from "zlib"
import path from "path"
import { fileURLToPath } from "url"
import { expect } from "vitest"
import type { TestRenderer } from "../testing.js"

export const isCI = !!process.env.CI

/** Where visual tests write their PNGs. Kept in the repo (gitignored) rather
 *  than /tmp so the output can actually be looked at after a run, and because
 *  `/tmp` does not exist on Windows: native `save()` there fails the whole
 *  test with `The system cannot find the path specified`.
 *
 *  Created on import, so a file that only writes a screenshot needs no
 *  `beforeAll`. Native never creates the parent directory itself. */
export const SHOTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../screenshots"
)

fs.mkdirSync(SHOTS_DIR, { recursive: true })

/** A monospace family the host actually has installed.
 *
 *  A test that asserts a font *changes* the picture must name a real family:
 *  an unknown one falls back to the default and paints byte-identical output.
 *  `Menlo` is macOS only, which is what failed once Windows started running
 *  the full suite. */
export const MONO_FAMILY =
  process.platform === "win32"
    ? "Consolas"
    : process.platform === "darwin"
      ? "Menlo"
      : "DejaVu Sans Mono"

/** Compute byte-level similarity between two buffers (0..1).
 *  For PNGs from the same renderer, identical pixels → identical bytes
 *  (same encoder settings). Any pixel change cascades through compression,
 *  so even small visual diffs produce low byte similarity. */
export function bufferSimilarity(a: Buffer, b: Buffer): number {
  const len = Math.max(a.length, b.length)
  if (len === 0) return 1
  let matching = 0
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matching++
  }
  return matching / len
}

/** Assert two screenshot PNGs exist, are non-empty, and are visually
 *  different (less than 99% byte similarity).
 *  Skipped on CI — Metal on macOS VMs doesn't repaint between captures,
 *  producing byte-identical screenshots regardless of state changes. */
export function expectScreenshotsDiffer(beforePath: string, afterPath: string) {
  expect(fs.existsSync(beforePath)).toBe(true)
  expect(fs.existsSync(afterPath)).toBe(true)
  expect(fs.statSync(beforePath).size).toBeGreaterThan(0)
  expect(fs.statSync(afterPath).size).toBeGreaterThan(0)

  if (isCI) return

  const before = fs.readFileSync(beforePath)
  const after = fs.readFileSync(afterPath)
  const similarity = bufferSimilarity(before, after)
  expect(similarity).toBeLessThan(0.99)
}

export function expectScreenshotsEqual(leftPath: string, rightPath: string) {
  expect(fs.existsSync(leftPath)).toBe(true)
  expect(fs.existsSync(rightPath)).toBe(true)
  const left = fs.readFileSync(leftPath)
  const right = fs.readFileSync(rightPath)
  expect(left.equals(right)).toBe(true)
}

export interface Pixels {
  width: number
  height: number
  /** The pixel at (x, y) as `[r, g, b, a]`. */
  at(x: number, y: number): [number, number, number, number]
}

/** Decode a screenshot (8-bit RGBA, not interlaced, which is what the test
 *  renderer writes) so a test can look at actual pixels. */
export function readPixels(file: string): Pixels {
  const png = fs.readFileSync(file)
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  expect([png[24], png[25], png[28]], "8-bit RGBA, not interlaced").toEqual([8, 6, 0])
  const chunks: Buffer[] = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      chunks.push(png.subarray(at + 8, at + 8 + length))
    }
    at += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const data = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const byte = raw[y * (stride + 1) + 1 + x]!
      const left = x >= 4 ? data[y * stride + x - 4]! : 0
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0
      const upLeft = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4]! : 0
      const paeth = () => {
        const estimate = left + up - upLeft
        const [a, b, c] = [
          Math.abs(estimate - left),
          Math.abs(estimate - up),
          Math.abs(estimate - upLeft),
        ]
        return a <= b && a <= c ? left : b <= c ? up : upLeft
      }
      const predicted =
        filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth()
      data[y * stride + x] = (byte + predicted) & 255
    }
  }
  return {
    width,
    height,
    at: (x, y) => {
      const i = y * stride + x * 4
      return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
    },
  }
}

/** `readPixels` addressed in logical pixels, the units styles are written in,
 *  sampling the centre of each. The same geometry reads the same on a 1x and
 *  a 2x display. */
export function readLogicalPixels(file: string, renderer: TestRenderer): Pixels {
  const pixels = readPixels(file)
  const { width, height } = renderer.getWindowSize()
  const scale = pixels.width / width
  return {
    width,
    height,
    at: (x, y) =>
      pixels.at(Math.floor((x + 0.5) * scale), Math.floor((y + 0.5) * scale)),
  }
}
