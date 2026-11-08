/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { sha256 } from '@haus/core';
import type { HomeKitTxtRecord } from './types.js';

export const MDNS_MAX_TXT_BYTES = 380; // Hard cap below Apple/RFC 400-byte limit

/**
 * Calculates the exact serialized byte length of a HomeKit mDNS TXT record dict.
 * Each entry is encoded as a 1-byte length prefix followed by "key=value".
 */
export function calculateTxtRecordByteLength(
  record: HomeKitTxtRecord | Readonly<Record<string, string | number>>,
): number {
  let total = 0;
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const str = `${key}=${value}`;
    const bytes = new TextEncoder().encode(str);
    total += 1 + bytes.length; // 1 byte for length prefix + entry bytes
  }
  return total;
}

/**
 * Clamps and guards a HomeKit mDNS TXT record to strictly stay below 380 bytes.
 * If model name (md) causes the record to exceed 380 bytes, it truncates or hashes md.
 */
export function guardHomeKitTxtRecord(record: HomeKitTxtRecord): HomeKitTxtRecord {
  const dict: Record<string, string | number> = {
    md: record.md,
    pv: record.pv,
    id: record.id,
    'c#': record['c#'],
    's#': record['s#'],
    sf: record.sf,
    ff: record.ff,
    ci: record.ci,
  };
  if (record.sh) {
    dict.sh = record.sh;
  }

  const currentLength = calculateTxtRecordByteLength(dict);
  if (currentLength <= MDNS_MAX_TXT_BYTES) {
    return record;
  }

  // Calculate maximum bytes available strictly for md
  const withoutMd = { ...dict };
  delete withoutMd.md;
  const otherBytes = calculateTxtRecordByteLength(withoutMd);
  // Entry prefix is 1 byte length + "md=" (3 bytes)
  const maxMdBytes = MDNS_MAX_TXT_BYTES - otherBytes - 4;
  const originalMd = record.md;
  const suffix = `~${sha256(originalMd).slice(0, 4)}`;

  const truncatedLen = Math.max(1, maxMdBytes - suffix.length);
  const shortenedMd = `${originalMd.slice(0, truncatedLen)}${suffix}`;

  return {
    ...record,
    md: shortenedMd,
  };
}

/**
 * Computes a structural hash of accessory topology to decide whether c# must be incremented.
 */
export function computeTopologyHash(
  accessories: readonly {
    id: string;
    services: readonly { type: string; characteristics: readonly string[] }[];
  }[],
): string {
  const canonical = accessories.map((acc) => ({
    id: acc.id,
    services: acc.services.map((s) => ({
      type: s.type,
      chars: [...s.characteristics].sort(),
    })),
  }));

  return sha256(JSON.stringify(canonical));
}
