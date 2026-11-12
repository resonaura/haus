/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type {
  HomeKitOnboardingPayload,
  MatterOnboardingPayload,
  ParseSetupCodeOptions,
  ParsedSetupCode,
} from './types.js';

const BASE38_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';
const BASE36_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function validateVerhoeff(str: string): boolean {
  if (!/^\d+$/.test(str)) return false;
  let c = 0;
  const digits = str.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i] ?? 0;
    const pRow = VERHOEFF_P[i % 8] ?? [];
    const dRow = VERHOEFF_D[c] ?? [];
    c = dRow[pRow[digit] ?? 0] ?? 0;
  }
  return c === 0;
}

export function computeVerhoeff(str: string): number {
  let c = 0;
  const digits = str.split('').map(Number).reverse();
  for (let i = 0; i < digits.length; i++) {
    const digit = digits[i] ?? 0;
    const pRow = VERHOEFF_P[(i + 1) % 8] ?? [];
    const dRow = VERHOEFF_D[c] ?? [];
    c = dRow[pRow[digit] ?? 0] ?? 0;
  }
  return VERHOEFF_INV[c] ?? 0;
}

const BANNED_HOMEKIT_PINS = new Set([
  '000-00-000',
  '111-11-111',
  '222-22-222',
  '333-33-333',
  '444-44-444',
  '555-55-555',
  '666-66-666',
  '777-77-777',
  '888-88-888',
  '999-99-999',
  '123-45-678',
  '876-54-321',
]);

export function validateHomeKitPin(pin: string): void {
  if (BANNED_HOMEKIT_PINS.has(pin)) {
    throw new Error(`Invalid HomeKit setup PIN: banned weak PIN pattern "${pin}"`);
  }
}

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

  const first11 = digits.slice(0, 11);
  if (!validateVerhoeff(first11)) {
    throw new Error(
      `Invalid Matter manual pairing code: check digit verification failed for "${rawInput}"`,
    );
  }

  const chunk1 = Number(digits.slice(0, 1));
  const chunk2 = Number(digits.slice(1, 6));
  const chunk3 = Number(digits.slice(6, 10));

  const hasVidPid = (chunk1 & 0x04) !== 0;
  if (digits.length === 21 && !hasVidPid) {
    throw new Error('Invalid Matter manual pairing code: 21-digit code missing VID/PID flag bit');
  }

  const shortDiscHigh = chunk1 & 0x03;
  const shortDiscLow = (chunk2 >> 14) & 0x03;
  const shortDiscriminator = (shortDiscHigh << 2) | shortDiscLow;

  const passcodeLow = chunk2 & 0x3fff;
  const passcodeHigh = chunk3 & 0x1fff;
  const passcode = (passcodeHigh << 14) | passcodeLow;

  const vendorId = digits.length === 21 ? Number(digits.slice(11, 16)) : undefined;
  const productId = digits.length === 21 ? Number(digits.slice(16, 21)) : undefined;

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
  validateHomeKitPin(pin);

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
  validateHomeKitPin(pin);
  return {
    raw: rawInput.trim(),
    pin,
  };
}

const VENDOR_PREFIXES = ['esphome', 'shelly', 'tasmota', 'tuya', 'nanoleaf', 'wled'] as const;

/**
 * Deterministically classifies and parses any onboarding code ("Code-First" UX):
 * - `^X-HM://`       -> `homekit-uri`
 * - `^MT:`           -> `matter-qr`
 * - 11 or 21 digits  -> `matter-manual`
 * - 8 digits / PIN   -> `homekit-pin`
 * - `^improv:`       -> `improv`
 * - `<vendor>:`      -> `vendor`
 */
export function parseSetupCode(rawInput: string, options?: ParseSetupCodeOptions): ParsedSetupCode {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Setup code cannot be empty');
  }

  const upper = trimmed.toUpperCase();

  if (upper.startsWith('X-HM://')) {
    if (options?.contextProtocol && options.contextProtocol !== 'homekit') {
      throw new Error(
        `Mismatched protocol context: provided HomeKit URI but context is "${options.contextProtocol}"`,
      );
    }
    const homekit = parseHomeKitUriPayload(trimmed);
    return {
      kind: 'homekit-uri',
      raw: trimmed,
      protocol: 'homekit',
      homekit,
    };
  }

  if (upper.startsWith('MT:')) {
    if (options?.contextProtocol && options.contextProtocol !== 'matter') {
      throw new Error(
        `Mismatched protocol context: provided Matter QR but context is "${options.contextProtocol}"`,
      );
    }
    const matter = parseMatterQrPayload(trimmed);
    return {
      kind: 'matter-qr',
      raw: trimmed,
      protocol: 'matter',
      matter,
    };
  }

  if (upper.startsWith('IMPROV:') || upper === 'IMPROV') {
    if (options?.contextProtocol && options.contextProtocol !== 'improv') {
      throw new Error(
        `Mismatched protocol context: provided Improv code but context is "${options.contextProtocol}"`,
      );
    }
    const remainder = trimmed.includes(':')
      ? trimmed.slice(trimmed.indexOf(':') + 1).trim()
      : undefined;
    let transport: 'ble' | 'serial' | undefined;
    let deviceNameHint = remainder;
    let serialPort: string | undefined;
    if (remainder?.toLowerCase().startsWith('serial:')) {
      transport = 'serial';
      serialPort = remainder.slice(7).trim();
      deviceNameHint = serialPort;
    } else if (remainder?.toLowerCase().startsWith('ble:')) {
      transport = 'ble';
      deviceNameHint = remainder.slice(4).trim();
    }
    return {
      kind: 'improv',
      raw: trimmed,
      protocol: 'improv',
      improv: {
        raw: trimmed,
        ...(transport ? { transport } : {}),
        ...(serialPort ? { serialPort } : {}),
        ...(deviceNameHint ? { deviceNameHint } : {}),
      },
    };
  }

  for (const v of VENDOR_PREFIXES) {
    if (upper.startsWith(`${v.toUpperCase()}:`)) {
      const remainder = trimmed.slice(v.length + 1).trim();
      return {
        kind: 'vendor',
        raw: trimmed,
        protocol: 'vendor',
        vendor: {
          raw: trimmed,
          vendor: v,
          identifier: remainder || undefined,
        },
      };
    }
  }

  const digitsOnly = trimmed.replace(/[\s-]/g, '');

  if (/^\d{11}$/.test(digitsOnly) || /^\d{21}$/.test(digitsOnly)) {
    if (options?.contextProtocol && options.contextProtocol !== 'matter') {
      throw new Error(
        `Mismatched protocol context: code has ${digitsOnly.length} digits (Matter manual) but context is "${options.contextProtocol}"`,
      );
    }
    const matter = parseMatterManualPayload(trimmed);
    return {
      kind: 'matter-manual',
      raw: trimmed,
      protocol: 'matter',
      matter,
    };
  }

  if (/^\d{8}$/.test(digitsOnly)) {
    if (options?.contextProtocol && options.contextProtocol !== 'homekit') {
      throw new Error(
        `Mismatched protocol context: code has 8 digits (HomeKit PIN) but context is "${options.contextProtocol}"`,
      );
    }
    const homekit = parseHomeKitPinPayload(trimmed);
    return {
      kind: 'homekit-pin',
      raw: trimmed,
      protocol: 'homekit',
      homekit,
    };
  }

  if (/^\d{4,10}$/.test(digitsOnly)) {
    if (options?.contextProtocol === 'improv') {
      return {
        kind: 'improv',
        raw: trimmed,
        protocol: 'improv',
        improv: {
          raw: trimmed,
          deviceNameHint: digitsOnly,
        },
      };
    }
    throw new Error(
      `Ambiguous setup code: bare numeric code "${trimmed}" requires protocol context (Matter, HomeKit, or Improv)`,
    );
  }

  throw new Error(
    'Unrecognized setup code format. Expected HomeKit PIN (8 digits or X-HM://), Matter QR (MT:...), Matter manual code (11 or 21 digits), Improv identifier, or supported vendor code.',
  );
}

/** Setup codes are secrets: redact raw code, PIN, and passcodes for logs and UI. */
export function redactSetupCode(parsed: ParsedSetupCode): ParsedSetupCode {
  return {
    kind: parsed.kind,
    raw: '',
    protocol: parsed.protocol,
    ...(parsed.matter
      ? {
          matter: {
            raw: '',
            passcode: 0,
            discriminator: parsed.matter.discriminator,
            ...(parsed.matter.vendorId !== undefined ? { vendorId: parsed.matter.vendorId } : {}),
            ...(parsed.matter.productId !== undefined
              ? { productId: parsed.matter.productId }
              : {}),
            ...(parsed.matter.commissioningFlow !== undefined
              ? { commissioningFlow: parsed.matter.commissioningFlow }
              : {}),
            ...(parsed.matter.discoveryCapabilities !== undefined
              ? { discoveryCapabilities: parsed.matter.discoveryCapabilities }
              : {}),
          },
        }
      : {}),
    ...(parsed.homekit
      ? {
          homekit: {
            raw: '',
            pin: '***-**-***',
            ...(parsed.homekit.setupId ? { setupId: parsed.homekit.setupId } : {}),
            ...(parsed.homekit.category !== undefined ? { category: parsed.homekit.category } : {}),
            ...(parsed.homekit.flags ? { flags: parsed.homekit.flags } : {}),
          },
        }
      : {}),
    ...(parsed.improv
      ? {
          improv: {
            raw: '',
            ...(parsed.improv.deviceNameHint
              ? { deviceNameHint: parsed.improv.deviceNameHint }
              : {}),
          },
        }
      : {}),
    ...(parsed.vendor
      ? {
          vendor: {
            raw: '',
            vendor: parsed.vendor.vendor,
            ...(parsed.vendor.identifier ? { identifier: parsed.vendor.identifier } : {}),
            ...(parsed.vendor.model ? { model: parsed.vendor.model } : {}),
            ...(parsed.vendor.address ? { address: parsed.vendor.address } : {}),
            ...(parsed.vendor.port ? { port: parsed.vendor.port } : {}),
            ...(parsed.vendor.metadata ? { metadata: parsed.vendor.metadata } : {}),
          },
        }
      : {}),
  };
}
