/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HomeKitCategory, HomeKitSetupPayload } from './types.js';

const BASE36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function normalizeHomeKitPin(pin: string): string | null {
  const digits = pin.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 8)}`;
}

export function parsePinToNumber(pin: string): number | null {
  const normalized = normalizeHomeKitPin(pin);
  if (!normalized) return null;
  const digits = normalized.replace(/-/g, '');
  return parseInt(digits, 10);
}

/**
 * Encodes a 36-bit payload into a Base36 string padded to 9 characters.
 */
function encodeBase36(value: bigint): string {
  let result = '';
  let v = value;
  const base = 36n;

  while (v > 0n) {
    const rem = Number(v % base);
    result = BASE36_ALPHABET[rem] + result;
    v = v / base;
  }

  return result.padStart(9, '0');
}

/**
 * Decodes a 9-character Base36 string into a 36-bit unsigned bigint.
 */
function decodeBase36(str: string): bigint {
  let result = 0n;
  const base = 36n;

  for (let i = 0; i < str.length; i++) {
    const char = str[i].toUpperCase();
    const idx = BASE36_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base36 character in HomeKit setup payload: ${char}`);
    }
    result = result * base + BigInt(idx);
  }

  return result;
}

/**
 * Encodes HomeKit Setup URI ("X-HM://00...") using exact HAP-NodeJS bit-packing specification.
 */
export function encodeHomeKitSetupUri(params: {
  pin: string;
  setupId: string;
  category: HomeKitCategory | number;
  flags?: number;
}): string {
  const pinNum = parsePinToNumber(params.pin);
  if (pinNum === null) {
    throw new Error(`Invalid HomeKit PIN: expected 8 digits, got ${params.pin}`);
  }

  const setupId = params.setupId.toUpperCase().slice(0, 4);
  if (setupId.length !== 4) {
    throw new Error(`Invalid setup ID: expected 4 characters, got ${params.setupId}`);
  }

  const categoryNum = Number(params.category);
  let low = pinNum;
  const high = categoryNum >> 1;

  low |= 1 << 28; // Supports IP

  if (categoryNum & 1) {
    low |= 1 << 31;
  }

  const packed = BigInt(low >>> 0) + (BigInt(high >>> 0) << 32n);
  const payloadBase36 = encodeBase36(packed);

  return `X-HM://${payloadBase36}${setupId}`;
}

/**
 * Decodes HomeKit Setup URI ("X-HM://00...").
 */
export function decodeHomeKitSetupUri(uri: string): HomeKitSetupPayload {
  const trimmed = uri.trim();
  if (!trimmed.startsWith('X-HM://')) {
    throw new Error('Invalid HomeKit setup payload: missing "X-HM://" prefix');
  }

  const body = trimmed.slice(7);
  if (body.length < 13) {
    throw new Error('Invalid HomeKit setup payload: payload string too short');
  }

  const base36Payload = body.slice(0, 9);
  const setupId = body.slice(9, 13).toUpperCase();

  const packed = decodeBase36(base36Payload);

  const low = Number(packed & 0xffffffffn);
  const high = Number(packed >> 32n);
  const category = (high << 1) | ((low >>> 31) & 1);
  const flags = (low >> 28) & 0x07;
  const pinNum = low & ~(1 << 28) & 0x7fffffff;

  const pinStr = pinNum.toString().padStart(8, '0');
  const formattedPin = `${pinStr.slice(0, 3)}-${pinStr.slice(3, 5)}-${pinStr.slice(5, 8)}`;

  return {
    version: 0,
    flags,
    category,
    setupId,
    pin: formattedPin,
    setupUri: trimmed,
  };
}
