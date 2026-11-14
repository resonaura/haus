/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { globMatches } from './discovery-deduplicator.js';
import type { DiscoveryAdvertisementInput, DiscoveryMatcherRule } from './discovery-types.js';

function normalizeBleUuid(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{4}$/.test(clean)) {
    return `0000${clean}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}$/.test(clean)) {
    return `${clean}-0000-1000-8000-00805f9b34fb`;
  }
  return clean;
}

function bleUuidMatches(pattern: string, actualList: readonly string[]): boolean {
  const normPattern = normalizeBleUuid(pattern);
  return actualList.some((actual) => {
    const normActual = normalizeBleUuid(actual);
    return normActual === normPattern || normActual.includes(pattern.trim().toLowerCase());
  });
}

function toByteArray(raw: unknown): number[] | undefined {
  if (Array.isArray(raw)) {
    const nums = raw.map((item) => Number(item));
    return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : undefined;
  }
  if (raw instanceof Uint8Array) {
    return Array.from(raw);
  }
  if (typeof raw === 'string') {
    const hex = raw.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length >= 2 && hex.length % 2 === 0) {
      const bytes: number[] = [];
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16));
      }
      return bytes;
    }
  }
  return undefined;
}

function matchesManufacturerBytes(
  mfgId: number | undefined,
  expectedPrefix: readonly number[],
  details: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (!details) return false;
  const directStart = toByteArray(details.manufacturer_data_start);
  const mfgMap =
    details.manufacturer_data &&
    typeof details.manufacturer_data === 'object' &&
    !Array.isArray(details.manufacturer_data)
      ? (details.manufacturer_data as Record<string, unknown>)
      : undefined;

  let actualBytes = directStart;
  if (mfgId !== undefined && mfgMap) {
    const candidate = mfgMap[String(mfgId)];
    const parsed = toByteArray(candidate);
    if (parsed) actualBytes = parsed;
  } else if (!actualBytes && mfgMap) {
    const values = Object.values(mfgMap);
    for (const v of values) {
      const parsed = toByteArray(v);
      if (parsed && parsed.length >= expectedPrefix.length) {
        if (expectedPrefix.every((b, idx) => parsed[idx] === b)) return true;
      }
    }
    return false;
  }

  if (!actualBytes || actualBytes.length < expectedPrefix.length) return false;
  return expectedPrefix.every((b, idx) => actualBytes[idx] === b);
}

export function scoreBluetoothRule(
  rule: DiscoveryMatcherRule,
  input: DiscoveryAdvertisementInput,
): number {
  if (!rule.bluetooth?.length) return 0;
  const localName = input.name ?? String(input.details?.local_name ?? '');
  const connectable =
    typeof input.details?.connectable === 'boolean' ? input.details.connectable : undefined;
  const mfgMap =
    input.details?.manufacturer_data &&
    typeof input.details.manufacturer_data === 'object' &&
    !Array.isArray(input.details.manufacturer_data)
      ? (input.details.manufacturer_data as Record<string, unknown>)
      : undefined;
  const legacyMfgId =
    typeof input.details?.manufacturer_id === 'number' ? input.details.manufacturer_id : undefined;

  const serviceUuids: string[] = [];
  if (typeof input.details?.service_uuid === 'string' && input.details.service_uuid) {
    serviceUuids.push(input.details.service_uuid);
  }
  if (Array.isArray(input.details?.service_uuids)) {
    for (const u of input.details.service_uuids) {
      if (typeof u === 'string' && u) serviceUuids.push(u);
    }
  }

  const serviceDataUuids: string[] = [];
  if (typeof input.details?.service_data_uuid === 'string' && input.details.service_data_uuid) {
    serviceDataUuids.push(input.details.service_data_uuid);
  }
  if (
    input.details?.service_data &&
    typeof input.details.service_data === 'object' &&
    !Array.isArray(input.details.service_data)
  ) {
    serviceDataUuids.push(...Object.keys(input.details.service_data));
  }

  let best = 0;

  for (const b of rule.bluetooth) {
    if (
      !b.local_name &&
      b.manufacturer_id === undefined &&
      !b.manufacturer_data_start?.length &&
      !b.service_uuid &&
      !b.service_data_uuid &&
      b.connectable === undefined
    ) {
      continue;
    }
    if (b.connectable !== undefined && connectable !== undefined && b.connectable !== connectable) {
      continue;
    }
    if (b.local_name && !globMatches(b.local_name, localName)) continue;
    if (b.manufacturer_id !== undefined) {
      const hasLegacy = legacyMfgId === b.manufacturer_id;
      const hasMap = mfgMap !== undefined && String(b.manufacturer_id) in mfgMap;
      if (!hasLegacy && !hasMap) continue;
    }
    if (
      b.manufacturer_data_start?.length &&
      !matchesManufacturerBytes(b.manufacturer_id, b.manufacturer_data_start, input.details)
    ) {
      continue;
    }
    if (b.service_uuid && !bleUuidMatches(b.service_uuid, serviceUuids)) continue;
    if (b.service_data_uuid && !bleUuidMatches(b.service_data_uuid, serviceDataUuids)) continue;

    const fields =
      Number(Boolean(b.local_name)) +
      Number(b.manufacturer_id !== undefined) +
      Number(Boolean(b.manufacturer_data_start?.length)) +
      Number(Boolean(b.service_uuid)) +
      Number(Boolean(b.service_data_uuid));
    best = Math.max(best, 40 + fields * 15);
  }
  return best;
}
