/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i += 1) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

function lookupBase64(charCode: number): number {
  const value = B64_LOOKUP[charCode];
  return value !== undefined && value >= 0 ? value : 0;
}

/** Decodes a compact unpadded/padded ASCII base64 string into bytes without Node Buffer. */
export function decodeBase64Bytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/[^A-Za-z0-9+/=]/g, '');
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const outLength = ((clean.length * 3) >> 2) - padding;
  const out = new Uint8Array(outLength);
  let outPos = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookupBase64(clean.charCodeAt(i));
    const c1 = lookupBase64(clean.charCodeAt(i + 1));
    const c2 = lookupBase64(clean.charCodeAt(i + 2));
    const c3 = lookupBase64(clean.charCodeAt(i + 3));
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outPos < outLength) out[outPos++] = (triple >> 16) & 0xff;
    if (outPos < outLength) out[outPos++] = (triple >> 8) & 0xff;
    if (outPos < outLength) out[outPos++] = triple & 0xff;
  }
  return out;
}

export function decodeUint16Lut(encoded: string): Uint16Array {
  const bytes = decodeBase64Bytes(encoded);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint16Array(bytes.byteLength >> 1);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint16(i * 2, true);
  }
  return out;
}

export function decodeInt32Lut(encoded: string): Int32Array {
  const bytes = decodeBase64Bytes(encoded);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int32Array(bytes.byteLength >> 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getInt32(i * 4, true);
  }
  return out;
}

export function decodeUint32Lut(encoded: string): Uint32Array {
  const bytes = decodeBase64Bytes(encoded);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint32Array(bytes.byteLength >> 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getUint32(i * 4, true);
  }
  return out;
}

export function decodeFloat32Lut(encoded: string): Float32Array {
  const bytes = decodeBase64Bytes(encoded);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >> 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}
