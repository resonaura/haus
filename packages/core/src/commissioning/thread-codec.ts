/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/** Standard Thread TLV Types per OpenThread / Thread specification. */
export const ThreadTlvTag = {
  Channel: 0x00,
  PanId: 0x01,
  ExtendedPanId: 0x02,
  NetworkName: 0x03,
  Pskc: 0x04,
  NetworkKey: 0x05,
  MeshLocalPrefix: 0x07,
} as const;

export interface ParsedThreadDataset {
  readonly networkName: string;
  readonly channel: number;
  readonly panId: number;
  readonly extendedPanId: string;
  readonly networkKey: string;
  readonly meshLocalPrefix?: string;
  readonly rawTlv: Uint8Array;
}

export interface ThreadDatasetFields {
  readonly networkName: string;
  readonly channel: number;
  readonly panId: number;
  readonly extendedPanId: string;
  readonly networkKey: string;
  readonly meshLocalPrefix?: string;
}

/**
 * Parses and validates a raw Thread Active Operational Dataset TLV buffer.
 */
export function validateThreadDatasetTlv(raw: Uint8Array | number[] | string): {
  valid: boolean;
  dataset?: ParsedThreadDataset;
  errors: string[];
} {
  const errors: string[] = [];
  let bytes: Uint8Array;

  if (typeof raw === 'string') {
    const clean = raw.trim().replace(/^0x/i, '');
    if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
      return { valid: false, errors: ['Invalid hex string for Thread dataset'] };
    }
    bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
  } else if (raw instanceof Uint8Array) {
    bytes = raw;
  } else {
    bytes = Uint8Array.from(raw);
  }

  if (bytes.length < 10) {
    return { valid: false, errors: ['Thread dataset TLV too short'] };
  }

  let offset = 0;
  let networkName: string | undefined;
  let channel: number | undefined;
  let panId: number | undefined;
  let extendedPanId: string | undefined;
  let networkKey: string | undefined;
  let meshLocalPrefix: string | undefined;

  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) {
      errors.push('Truncated TLV header');
      break;
    }
    const tag = bytes[offset];
    const len = bytes[offset + 1];
    offset += 2;

    if (offset + len > bytes.length) {
      errors.push(`Truncated TLV value for tag 0x${tag.toString(16).padStart(2, '0')}`);
      break;
    }
    const val = bytes.subarray(offset, offset + len);
    offset += len;

    switch (tag) {
      case ThreadTlvTag.Channel:
        if (len < 3) {
          errors.push('Channel TLV must be at least 3 bytes');
        } else {
          const chan = (val[1] << 8) | val[2];
          if (chan < 11 || chan > 26) {
            errors.push(`Thread channel must be between 11 and 26 (got ${chan})`);
          } else {
            channel = chan;
          }
        }
        break;

      case ThreadTlvTag.PanId:
        if (len !== 2) {
          errors.push('PAN ID TLV must be exactly 2 bytes');
        } else {
          panId = (val[0] << 8) | val[1];
        }
        break;

      case ThreadTlvTag.ExtendedPanId:
        if (len !== 8) {
          errors.push('Extended PAN ID TLV must be exactly 8 bytes');
        } else {
          let hex = '';
          for (let i = 0; i < 8; i++) {
            hex += val[i].toString(16).padStart(2, '0');
          }
          extendedPanId = hex.toLowerCase();
        }
        break;

      case ThreadTlvTag.NetworkName:
        if (len < 1 || len > 16) {
          errors.push('Network Name TLV must be between 1 and 16 bytes');
        } else {
          const decoder = new TextDecoder('utf-8', { fatal: false });
          networkName = decoder.decode(val);
        }
        break;

      case ThreadTlvTag.NetworkKey:
        if (len !== 16) {
          errors.push('Network Key TLV must be exactly 16 bytes (128-bit)');
        } else {
          let hex = '';
          for (let i = 0; i < 16; i++) {
            hex += val[i].toString(16).padStart(2, '0');
          }
          networkKey = hex.toLowerCase();
        }
        break;

      case ThreadTlvTag.MeshLocalPrefix:
        if (len === 8) {
          let hex = '';
          for (let i = 0; i < 8; i++) {
            hex += val[i].toString(16).padStart(2, '0');
          }
          meshLocalPrefix = hex.toLowerCase();
        }
        break;
    }
  }

  if (!networkName) errors.push('Missing Network Name in Thread dataset');
  if (channel === undefined) errors.push('Missing Channel in Thread dataset');
  if (panId === undefined) errors.push('Missing PAN ID in Thread dataset');
  if (!extendedPanId) errors.push('Missing Extended PAN ID in Thread dataset');
  if (!networkKey) errors.push('Missing Network Key in Thread dataset');

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    dataset: {
      networkName: networkName!,
      channel: channel!,
      panId: panId!,
      extendedPanId: extendedPanId!,
      networkKey: networkKey!,
      meshLocalPrefix,
      rawTlv: bytes,
    },
    errors: [],
  };
}

/**
 * Encodes Thread operational fields into standard Thread Active Operational Dataset TLV bytes.
 */
export function encodeThreadDatasetTlv(fields: ThreadDatasetFields): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. Network Name (Type 0x03)
  const nameBytes = new TextEncoder().encode(fields.networkName.slice(0, 16));
  const nameHeader = new Uint8Array([ThreadTlvTag.NetworkName, nameBytes.length]);
  parts.push(nameHeader, nameBytes);

  // 2. Channel (Type 0x00: page 0 + 2-byte BE channel)
  const chanBytes = new Uint8Array([
    ThreadTlvTag.Channel,
    3,
    0, // Channel Page 0
    (fields.channel >> 8) & 0xff,
    fields.channel & 0xff,
  ]);
  parts.push(chanBytes);

  // 3. PAN ID (Type 0x01: 2 bytes BE)
  const panBytes = new Uint8Array([
    ThreadTlvTag.PanId,
    2,
    (fields.panId >> 8) & 0xff,
    fields.panId & 0xff,
  ]);
  parts.push(panBytes);

  // 4. Extended PAN ID (Type 0x02: 8 bytes)
  const extClean = fields.extendedPanId.replace(/^0x/i, '').padStart(16, '0').slice(0, 16);
  const extBytes = new Uint8Array(10);
  extBytes[0] = ThreadTlvTag.ExtendedPanId;
  extBytes[1] = 8;
  for (let i = 0; i < 8; i++) {
    extBytes[2 + i] = parseInt(extClean.slice(i * 2, i * 2 + 2), 16);
  }
  parts.push(extBytes);

  // 5. Network Key (Type 0x05: 16 bytes)
  const keyClean = fields.networkKey.replace(/^0x/i, '').padStart(32, '0').slice(0, 32);
  const keyBytes = new Uint8Array(18);
  keyBytes[0] = ThreadTlvTag.NetworkKey;
  keyBytes[1] = 16;
  for (let i = 0; i < 16; i++) {
    keyBytes[2 + i] = parseInt(keyClean.slice(i * 2, i * 2 + 2), 16);
  }
  parts.push(keyBytes);

  let totalLen = 0;
  for (const p of parts) totalLen += p.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}
