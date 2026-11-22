/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    c = CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterScanline(
  filterType: number,
  raw: Uint8Array,
  rawOffset: number,
  prev: Uint8Array,
  out: Uint8Array,
  stride: number,
  bpp: number,
): void {
  if (filterType === 0) {
    out.set(raw.subarray(rawOffset, rawOffset + stride));
    return;
  }
  for (let i = 0; i < stride; i += 1) {
    const x = raw[rawOffset + i] ?? 0;
    const a = i >= bpp ? (out[i - bpp] ?? 0) : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    if (filterType === 1) out[i] = (x + a) & 0xff;
    else if (filterType === 2) out[i] = (x + b) & 0xff;
    else if (filterType === 3) out[i] = (x + ((a + b) >> 1)) & 0xff;
    else if (filterType === 4) out[i] = (x + paethPredictor(a, b, c)) & 0xff;
    else throw new Error(`Unsupported PNG filter type: ${filterType}`);
  }
}

export interface DecodedRgbaImage {
  readonly width: number;
  readonly height: number;
  /** Straight (non-premultiplied) RGBA bytes. */
  readonly rgba: Uint8Array;
}

function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

function readSample(line: Uint8Array, bitOffset: number, bitDepth: number): number {
  if (bitDepth === 8) return line[bitOffset >> 3] ?? 0;
  if (bitDepth === 16) return line[bitOffset >> 3] ?? 0;
  const byteIndex = bitOffset >> 3;
  const shift = 8 - bitDepth - (bitOffset & 7);
  const mask = (1 << bitDepth) - 1;
  return ((line[byteIndex] ?? 0) >> shift) & mask;
}

function scaleLowBitSample(value: number, bitDepth: number): number {
  if (bitDepth >= 8) return value;
  const max = (1 << bitDepth) - 1;
  return Math.round((value * 255) / max);
}

function writeRowPixels(
  line: Uint8Array,
  passWidth: number,
  colorType: number,
  bitDepth: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
  dest: Uint8Array,
  destWidth: number,
  y: number,
  xStart: number,
  xStep: number,
): void {
  const channels = channelsForColorType(colorType);
  const sampleBits = bitDepth;
  const trnsGray =
    colorType === 0 && trns && trns.length >= 2 ? (bitDepth === 16 ? trns[0]! : trns[1]!) : -1;
  const trnsRgb =
    colorType === 2 && trns && trns.length >= 6
      ? bitDepth === 16
        ? ([trns[0]!, trns[2]!, trns[4]!] as const)
        : ([trns[1]!, trns[3]!, trns[5]!] as const)
      : null;

  for (let px = 0; px < passWidth; px += 1) {
    const bitBase = px * channels * sampleBits;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 255;

    if (colorType === 6) {
      r = readSample(line, bitBase, bitDepth);
      g = readSample(line, bitBase + sampleBits, bitDepth);
      b = readSample(line, bitBase + sampleBits * 2, bitDepth);
      a = readSample(line, bitBase + sampleBits * 3, bitDepth);
    } else if (colorType === 2) {
      r = readSample(line, bitBase, bitDepth);
      g = readSample(line, bitBase + sampleBits, bitDepth);
      b = readSample(line, bitBase + sampleBits * 2, bitDepth);
      if (trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2]) a = 0;
    } else if (colorType === 3) {
      const idx = readSample(line, bitBase, bitDepth);
      if (palette && idx * 3 + 2 < palette.length) {
        r = palette[idx * 3]!;
        g = palette[idx * 3 + 1]!;
        b = palette[idx * 3 + 2]!;
      }
      if (trns && idx < trns.length) a = trns[idx]!;
    } else if (colorType === 0) {
      const rawGray = readSample(line, bitBase, bitDepth);
      const gray = scaleLowBitSample(rawGray, bitDepth);
      r = gray;
      g = gray;
      b = gray;
      if (trnsGray >= 0 && rawGray === trnsGray) a = 0;
    } else if (colorType === 4) {
      const gray = readSample(line, bitBase, bitDepth);
      r = gray;
      g = gray;
      b = gray;
      a = readSample(line, bitBase + sampleBits, bitDepth);
    }

    const dx = xStart + px * xStep;
    const outIdx = (dx + y * destWidth) * 4;
    dest[outIdx] = r;
    dest[outIdx + 1] = g;
    dest[outIdx + 2] = b;
    dest[outIdx + 3] = a;
  }
}

const ADAM7_PASSES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/** Decodes any standard PNG buffer (color types 0/2/3/4/6, bit depths 1..16, Adam7, tRNS) to straight RGBA. */
export function decodePngRgba(pngBytes: Uint8Array): DecodedRgbaImage {
  if (pngBytes.length < 33 || !Buffer.from(pngBytes.subarray(0, 8)).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];

  let offset = 8;
  while (offset + 12 <= pngBytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      pngBytes[offset + 4]!,
      pngBytes[offset + 5]!,
      pngBytes[offset + 6]!,
      pngBytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBytes.length) break;

    if (type === 'IHDR' && length >= 13) {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = pngBytes[dataStart + 8]!;
      colorType = pngBytes[dataStart + 9]!;
      interlace = pngBytes[dataStart + 12]!;
    } else if (type === 'PLTE') {
      palette = pngBytes.subarray(dataStart, dataEnd);
    } else if (type === 'tRNS') {
      trns = pngBytes.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idatChunks.push(pngBytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}`);
  }
  if (![1, 2, 4, 8, 16].includes(bitDepth)) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  }

  const compressed = Buffer.concat(idatChunks);
  const inflated = inflateSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  const channels = channelsForColorType(colorType);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const rgba = new Uint8Array(width * height * 4);

  if (interlace === 0) {
    const stride = Math.ceil((width * channels * bitDepth) / 8);
    let prev = new Uint8Array(stride);
    let curr = new Uint8Array(stride);
    let pos = 0;
    for (let y = 0; y < height; y += 1) {
      if (pos + 1 + stride > inflated.length) throw new Error('Truncated PNG scanline');
      const filterType = inflated[pos]!;
      pos += 1;
      unfilterScanline(filterType, inflated, pos, prev, curr, stride, bpp);
      pos += stride;
      writeRowPixels(curr, width, colorType, bitDepth, palette, trns, rgba, width, y, 0, 1);
      const swap = prev;
      prev = curr;
      curr = swap;
    }
  } else if (interlace === 1) {
    let pos = 0;
    for (const [xStart, yStart, xStep, yStep] of ADAM7_PASSES) {
      const passW = Math.ceil((width - xStart) / xStep);
      const passH = Math.ceil((height - yStart) / yStep);
      if (passW <= 0 || passH <= 0) continue;
      const stride = Math.ceil((passW * channels * bitDepth) / 8);
      let prev = new Uint8Array(stride);
      let curr = new Uint8Array(stride);
      for (let py = 0; py < passH; py += 1) {
        if (pos + 1 + stride > inflated.length) throw new Error('Truncated interlaced PNG');
        const filterType = inflated[pos]!;
        pos += 1;
        unfilterScanline(filterType, inflated, pos, prev, curr, stride, bpp);
        pos += stride;
        writeRowPixels(
          curr,
          passW,
          colorType,
          bitDepth,
          palette,
          trns,
          rgba,
          width,
          yStart + py * yStep,
          xStart,
          xStep,
        );
        const swap = prev;
        prev = curr;
        curr = swap;
      }
    }
  } else {
    throw new Error(`Unsupported PNG interlace method: ${interlace}`);
  }

  return { width, height, rgba };
}

function buildPngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  if (data.length > 0) out.set(data, 8);
  const crc = crc32(out, 4, 8 + data.length);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

/** Encodes straight RGBA bytes into a compact standard RGBA8 PNG buffer using Sub filtering. */
export function encodePngRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error('RGBA buffer length mismatch for PNG encoding');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // standard filter
  ihdr[12] = 0; // non-interlaced

  const stride = width * 4;
  const raw = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowOut = y * (stride + 1);
    const rowIn = y * stride;
    raw[rowOut] = 1; // Sub filter — fast and compresses gradients/solid tiles well
    for (let x = 0; x < stride; x += 1) {
      const cur = rgba[rowIn + x] ?? 0;
      const left = x >= 4 ? (rgba[rowIn + x - 4] ?? 0) : 0;
      raw[rowOut + 1 + x] = (cur - left) & 0xff;
    }
  }

  const compressed = deflateSync(raw, { level: 4 });
  return Buffer.concat([
    PNG_SIGNATURE,
    buildPngChunk('IHDR', ihdr),
    buildPngChunk('IDAT', compressed),
    buildPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Converts straight RGBA to premultiplied RGBA (expected by the icon segmentation engine). */
export function straightToPremultipliedRgba(straight: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(straight.length);
  for (let i = 0; i < straight.length; i += 4) {
    const a = straight[i + 3] ?? 0;
    if (a === 255) {
      out[i] = straight[i] ?? 0;
      out[i + 1] = straight[i + 1] ?? 0;
      out[i + 2] = straight[i + 2] ?? 0;
      out[i + 3] = 255;
    } else if (a > 0) {
      const k = a / 255;
      out[i] = Math.round((straight[i] ?? 0) * k);
      out[i + 1] = Math.round((straight[i + 1] ?? 0) * k);
      out[i + 2] = Math.round((straight[i + 2] ?? 0) * k);
      out[i + 3] = a;
    }
  }
  return out;
}
