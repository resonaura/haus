/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

const BASE38_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';

export interface MatterSetupPayload {
  readonly version: number;
  readonly vendorId: number;
  readonly productId: number;
  readonly commissioningFlow: number;
  readonly discoveryCapabilities: number;
  readonly discriminator: number;
  readonly passcode: number;
}

export function encodeBase38(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunkLen = Math.min(3, bytes.length - i);
    let val = 0;
    for (let j = 0; j < chunkLen; j++) {
      val |= bytes[i + j] << (j * 8);
    }

    const charCount = chunkLen === 1 ? 2 : chunkLen === 2 ? 4 : 5;
    for (let c = 0; c < charCount; c++) {
      result += BASE38_ALPHABET[val % 38];
      val = Math.floor(val / 38);
    }
  }
  return result;
}

export function decodeBase38(str: string): Uint8Array {
  const bytes: number[] = [];
  let i = 0;
  while (i < str.length) {
    const remaining = str.length - i;
    const charCount = remaining >= 5 ? 5 : remaining >= 4 ? 4 : 2;
    const byteCount = charCount === 2 ? 1 : charCount === 4 ? 2 : 3;

    let val = 0;
    let multiplier = 1;
    for (let c = 0; c < charCount; c++) {
      const idx = BASE38_ALPHABET.indexOf(str[i + c]);
      if (idx === -1) throw new Error(`Invalid Base38 character: ${str[i + c]}`);
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

/**
 * Encodes Matter setup payload into standard QR code string ("MT:...").
 */
export function encodeMatterQrCode(
  payload: Partial<MatterSetupPayload> & { passcode: number; discriminator: number },
): string {
  const version = payload.version ?? 0;
  const vendorId = payload.vendorId ?? 0xfff1; // Test vendor
  const productId = payload.productId ?? 0x8001; // Test product
  const flow = payload.commissioningFlow ?? 0; // Standard
  const caps = payload.discoveryCapabilities ?? 0x04; // On-network (bit 2)
  const discriminator = payload.discriminator & 0xfff;
  const passcode = payload.passcode;

  // Total 84 bits / 11 bytes
  const bytes = new Uint8Array(11);

  // Bit allocation:
  // 0..2: version (3 bits)
  // 3..18: vendorId (16 bits)
  // 19..34: productId (16 bits)
  // 35..36: customFlow (2 bits)
  // 37..44: discoveryCapabilities (8 bits)
  // 45..56: discriminator (12 bits)
  // 57..83: passcode (27 bits)
  // 84..87: padding (4 bits)
  let bitPos = 0;
  const setBits = (val: number, numBits: number) => {
    for (let b = 0; b < numBits; b++) {
      const bit = (val >> b) & 1;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      bytes[byteIdx] |= bit << bitIdx;
      bitPos++;
    }
  };

  setBits(version, 3);
  setBits(vendorId, 16);
  setBits(productId, 16);
  setBits(flow, 2);
  setBits(caps, 8);
  setBits(discriminator, 12);
  setBits(passcode, 27);

  return `MT:${encodeBase38(bytes)}`;
}

/**
 * Decodes standard Matter QR code string ("MT:...").
 */
export function decodeMatterQrCode(qrString: string): MatterSetupPayload {
  const trimmed = qrString.trim();
  if (!trimmed.startsWith('MT:')) {
    throw new Error('Invalid Matter QR code: missing "MT:" prefix');
  }
  const base38Str = trimmed.slice(3);
  const bytes = decodeBase38(base38Str);

  let bitPos = 0;
  const readBits = (numBits: number): number => {
    let val = 0;
    for (let b = 0; b < numBits; b++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      const bit = (bytes[byteIdx] >> bitIdx) & 1;
      val |= bit << b;
      bitPos++;
    }
    return val;
  };

  const version = readBits(3);
  const vendorId = readBits(16);
  const productId = readBits(16);
  const commissioningFlow = readBits(2);
  const discoveryCapabilities = readBits(8);
  const discriminator = readBits(12);
  const passcode = readBits(27);

  return {
    version,
    vendorId,
    productId,
    commissioningFlow,
    discoveryCapabilities,
    discriminator,
    passcode,
  };
}

/**
 * Formats 11-digit manual pairing code: "XXXXX-XXXXXX".
 */
export function formatManualPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 11) return code;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/**
 * Generates an 11-digit manual pairing code from discriminator and passcode.
 */
export function generateManualPairingCode(discriminator: number, passcode: number): string {
  const shortDisc = (discriminator >> 8) & 0x0f; // 4 MSB bits
  const passcodeLow = passcode & 0x3fff; // 14 bits
  const passcodeHigh = (passcode >> 14) & 0x1fff; // 13 bits

  const chunk1 = (shortDisc << 14) | passcodeLow;
  const chunk2 = passcodeHigh;

  const part1 = (chunk1 % 100000).toString().padStart(5, '0');
  const part2 = (chunk2 % 100000).toString().padStart(5, '0');

  // Compute check digit (Luhn-10)
  let sum = 0;
  const tenDigits = `${part1}${part2}`;
  for (let i = 0; i < tenDigits.length; i++) {
    let digit = Number(tenDigits[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return formatManualPairingCode(`${part1}${part2}${checkDigit}`);
}
