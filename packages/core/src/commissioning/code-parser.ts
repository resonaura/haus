/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  HomeKitOnboardingPayload,
  MatterOnboardingPayload,
  ParsedSetupCode,
} from './types.js';

const BASE38_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';
const BASE36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function decodeBase38(str: string): Uint8Array {
  const bytes: number[] = [];
  let i = 0;
  while (i < str.length) {
    const remaining = str.length - i;
    const charCount = remaining >= 5 ? 5 : remaining >= 4 ? 4 : 2;
    const byteCount = charCount === 2 ? 1 : charCount === 4 ? 2 : 3;

    let val = 0;
    let multiplier = 1;
    for (let c = 0; c < charCount; c++) {
      const ch = str[i + c];
      const idx = ch !== undefined ? BASE38_ALPHABET.indexOf(ch) : -1;
      if (idx === -1) {
        throw new Error(`Invalid Base38 character in Matter QR payload: ${String(ch)}`);
      }
      val += idx * multiplier;
      multiplier *= 38;
    }

    for (let b = 0; b < byteCount; b++) {
      bytes.push((val >> (b * 8)) & 0xff);
    }
    i += charCount;
  }
  return new Uint8Array(bytes);
}

function decodeBase36(str: string): bigint {
  let result = 0n;
  const base = 36n;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]?.toUpperCase() ?? '';
    const idx = BASE36_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid Base36 character in HomeKit setup URI: ${ch}`);
    }
    result = result * base + BigInt(idx);
  }
  return result;
}

export function parseMatterQrPayload(rawInput: string): MatterOnboardingPayload {
  const trimmed = rawInput.trim().toUpperCase();
  if (!trimmed.startsWith('MT:')) {
    throw new Error('Invalid Matter QR payload: missing "MT:" prefix');
  }
  const base38Body = trimmed.slice(3);
  if (base38Body.length < 19) {
    throw new Error('Invalid Matter QR payload: payload too short');
  }
  const bytes = decodeBase38(base38Body);

  let bitPos = 0;
  const readBits = (numBits: number): number => {
    let val = 0;
    for (let b = 0; b < numBits; b++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      const bit = ((bytes[byteIdx] ?? 0) >> bitIdx) & 1;
      val |= bit << b;
      bitPos++;
    }
    return val;
  };

  const _version = readBits(3);
  const vendorId = readBits(16);
  const productId = readBits(16);
  const commissioningFlow = readBits(2);
  const discoveryCapsMask = readBits(8);
  const discriminator = readBits(12);
  const passcode = readBits(27);

  return {
    raw: trimmed,
    passcode,
    discriminator: {
      value: discriminator,
      type: 'long',
    },
    vendorId,
    productId,
    commissioningFlow,
    discoveryCapabilities: {
      softAp: (discoveryCapsMask & 0x01) !== 0,
      ble: (discoveryCapsMask & 0x02) !== 0,
      onNetwork: (discoveryCapsMask & 0x04) !== 0,
    },
  };
}

export function parseMatterManualPayload(rawInput: string): MatterOnboardingPayload {
  const digits = rawInput.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(digits) && !/^\d{21}$/.test(digits)) {
    throw new Error(
      `Invalid Matter manual pairing code: expected 11 or 21 digits, got "${rawInput}"`,
    );
  }

  const chunk1 = Number(digits.slice(0, 1));
  const chunk2 = Number(digits.slice(1, 6));
  const chunk3 = Number(digits.slice(6, 10));

  const shortDiscHigh = chunk1 & 0x03;
  const shortDiscLow = (chunk2 >> 14) & 0x03;
  const shortDiscriminator = (shortDiscHigh << 2) | shortDiscLow;

  const passcodeLow = chunk2 & 0x3fff;
  const passcodeHigh = chunk3 & 0x1fff;
  const passcode = (passcodeHigh << 14) | passcodeLow;

  const vendorId = digits.length === 21 ? Number(digits.slice(10, 15)) : undefined;
  const productId = digits.length === 21 ? Number(digits.slice(15, 20)) : undefined;

  return {
    raw: digits,
    passcode,
    discriminator: {
      value: shortDiscriminator,
      type: 'short',
    },
    ...(vendorId !== undefined ? { vendorId } : {}),
    ...(productId !== undefined ? { productId } : {}),
  };
}

export function parseHomeKitUriPayload(rawInput: string): HomeKitOnboardingPayload {
  const trimmed = rawInput.trim().toUpperCase();
  if (!trimmed.startsWith('X-HM://')) {
    throw new Error('Invalid HomeKit setup URI: missing "X-HM://" prefix');
  }
  const body = trimmed.slice(7);
  if (body.length < 13) {
    throw new Error('Invalid HomeKit setup URI: body too short');
  }

  const base36Payload = body.slice(0, 9);
  const setupId = body.slice(9, 13);
  const packed = decodeBase36(base36Payload);

  const low = Number(packed & 0xffffffffn);
  const high = Number(packed >> 32n);
  const category = (high << 1) | ((low >>> 31) & 1);
  const flagsMask = (low >> 28) & 0x07;
  const pinNum = low & ~(0x07 << 28) & 0x7fffffff;

  const pinDigits = pinNum.toString().padStart(8, '0');
  const pin = `${pinDigits.slice(0, 3)}-${pinDigits.slice(3, 5)}-${pinDigits.slice(5, 8)}`;

  return {
    raw: trimmed,
    pin,
    setupId,
    category,
    flags: {
      ip: (flagsMask & 0x01) !== 0,
      ble: (flagsMask & 0x02) !== 0,
      wac: (flagsMask & 0x04) !== 0,
    },
  };
}

export function parseHomeKitPinPayload(rawInput: string): HomeKitOnboardingPayload {
  const digits = rawInput.replace(/\D/g, '');
  if (digits.length !== 8) {
    throw new Error(`Invalid HomeKit setup PIN: expected 8 digits, got "${rawInput}"`);
  }
  const pin = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 8)}`;
  return {
    raw: rawInput.trim(),
    pin,
  };
}

/**
 * Deterministically classifies and parses any onboarding code ("Code-First" UX):
 * - `^X-HM://`       -> `homekit-uri`
 * - `^MT:`           -> `matter-qr`
 * - 11 or 21 digits  -> `matter-manual`
 * - 8 digits / PIN   -> `homekit-pin`
 * - `^improv:`       -> `improv`
 */
export function parseSetupCode(rawInput: string): ParsedSetupCode {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Setup code cannot be empty');
  }

  const upper = trimmed.toUpperCase();

  if (upper.startsWith('X-HM://')) {
    const homekit = parseHomeKitUriPayload(trimmed);
    return {
      kind: 'homekit-uri',
      raw: trimmed,
      protocol: 'homekit',
      homekit,
    };
  }

  if (upper.startsWith('MT:')) {
    const matter = parseMatterQrPayload(trimmed);
    return {
      kind: 'matter-qr',
      raw: trimmed,
      protocol: 'matter',
      matter,
    };
  }

  if (upper.startsWith('IMPROV:') || upper === 'IMPROV') {
    const hint = trimmed.includes(':') ? trimmed.slice(trimmed.indexOf(':') + 1).trim() : undefined;
    return {
      kind: 'improv',
      raw: trimmed,
      protocol: 'improv',
      improv: {
        raw: trimmed,
        ...(hint ? { deviceNameHint: hint } : {}),
      },
    };
  }

  const digitsOnly = trimmed.replace(/[\s-]/g, '');

  if (/^\d{11}$/.test(digitsOnly) || /^\d{21}$/.test(digitsOnly)) {
    const matter = parseMatterManualPayload(trimmed);
    return {
      kind: 'matter-manual',
      raw: trimmed,
      protocol: 'matter',
      matter,
    };
  }

  if (/^\d{8}$/.test(digitsOnly)) {
    const homekit = parseHomeKitPinPayload(trimmed);
    return {
      kind: 'homekit-pin',
      raw: trimmed,
      protocol: 'homekit',
      homekit,
    };
  }

  throw new Error(
    'Unrecognized setup code format. Expected HomeKit PIN (8 digits or X-HM://), Matter QR (MT:...), Matter manual code (11 or 21 digits), or Improv identifier.',
  );
}
