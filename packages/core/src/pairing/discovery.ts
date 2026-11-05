/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DiscoveredHub, DiscoveredService } from './types.js';

function ipv4Parts(value: string): number[] | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    if (part.length > 1 && part.startsWith('0')) return undefined;
    const num = Number(part);
    if (num < 0 || num > 255) return undefined;
  }
  return parts.map(Number);
}

export function isPrivateIpv4(value: string): boolean {
  const octets = ipv4Parts(value);
  if (!octets) return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

export function isUniqueLocalIpv6(value: string): boolean {
  const clean = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (clean.includes('%')) return false;
  if (clean === '::1') return true;
  return /^f[cd][0-9a-f]{2}:/u.test(clean);
}

export function isLocalHostname(value: string): boolean {
  const clean = value.toLowerCase().replace(/\.$/u, '');
  if (clean === 'localhost') return true;
  return clean.endsWith('.local') || clean.endsWith('.lan') || clean.endsWith('.home.arpa');
}

export function isLocalTarget(host: string): boolean {
  return isPrivateIpv4(host) || isUniqueLocalIpv6(host) || isLocalHostname(host);
}

export function sanitizeServiceName(value: string): string {
  let result = '';
  let count = 0;
  for (const character of value.trim()) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    result += character;
    if (++count >= 128) break;
  }
  return result.trim();
}

function normalizeServiceType(type?: string): string {
  if (!type) return '';
  return type
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/\._tcp.*$/, '');
}

const ACCEPTED_TYPES = new Set(['haus-hub', 'haus']);
const SENSITIVE_TXT_KEYS = new Set([
  'token',
  'secret',
  'password',
  'key',
  'node_key',
  'credential',
]);

export function parseDiscoveredHub(service: DiscoveredService): DiscoveredHub | undefined {
  const normalizedType = normalizeServiceType(service.type);
  if (!ACCEPTED_TYPES.has(normalizedType)) return undefined;

  const port = service.port;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }

  const txt = service.txt;
  if (!txt || typeof txt !== 'object' || Array.isArray(txt)) return undefined;

  const protocol = String(txt.protocol ?? txt.version ?? '');
  if (protocol !== '1') return undefined;

  // Reject services that attempt to leak or advertise credentials in discovery
  for (const sensitive of SENSITIVE_TXT_KEYS) {
    if (txt[sensitive] !== undefined && String(txt[sensitive]).trim().length > 0) {
      return undefined;
    }
  }

  const hubId = typeof txt.hubId === 'string' && txt.hubId.trim() ? txt.hubId.trim() : '';
  if (!hubId || hubId.length > 128) return undefined;

  const homeId =
    typeof txt.homeId === 'string' && txt.homeId.trim() ? txt.homeId.trim() : undefined;
  const fingerprint =
    typeof txt.fingerprint === 'string' && txt.fingerprint.trim()
      ? txt.fingerprint.trim()
      : undefined;

  // Reject services advertising non-local or public addresses
  const addresses = Array.isArray(service.addresses) ? service.addresses : [];
  if (addresses.some((addr) => typeof addr === 'string' && !isLocalTarget(addr))) {
    return undefined;
  }
  const candidateAddress = addresses.find(
    (addr) => typeof addr === 'string' && (isPrivateIpv4(addr) || isUniqueLocalIpv6(addr)),
  );

  const rawHost = typeof service.host === 'string' ? service.host.trim().replace(/\.$/u, '') : '';
  const host = candidateAddress || (rawHost && isLocalTarget(rawHost) ? rawHost : '');
  if (!host) return undefined;

  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = `http://${authority}:${port}`;

  const name =
    typeof service.name === 'string' && service.name.trim()
      ? sanitizeServiceName(service.name)
      : 'Haus Hub';

  return {
    id: `haus-hub:${hubId}`,
    hubId,
    homeId,
    name: name || 'Haus Hub',
    url,
    host,
    port,
    protocol: '1',
    fingerprint,
    source: 'discovery',
  };
}

export function parseManualHubAddress(
  input: string,
  hints?: { hubId?: string; homeId?: string; name?: string; fingerprint?: string },
): DiscoveredHub {
  const trimmed = input.trim();
  if (!trimmed) throw Error('invalid_manual_address');

  let scheme = 'http:';
  let addressPart = trimmed;
  if (trimmed.startsWith('https://')) {
    scheme = 'https:';
    addressPart = trimmed.slice(8);
  } else if (trimmed.startsWith('http://')) {
    scheme = 'http:';
    addressPart = trimmed.slice(7);
  }

  // Remove any trailing path/query/hash
  const slashIndex = addressPart.indexOf('/');
  if (slashIndex !== -1) {
    const rest = addressPart.slice(slashIndex);
    if (rest !== '/' && rest.length > 1) throw Error('invalid_manual_address');
    addressPart = addressPart.slice(0, slashIndex);
  }

  let host = '';
  let port = scheme === 'https:' ? 8443 : 80;

  if (addressPart.startsWith('[')) {
    const closingBracket = addressPart.indexOf(']');
    if (closingBracket === -1) throw Error('invalid_manual_address');
    host = addressPart.slice(0, closingBracket + 1);
    const after = addressPart.slice(closingBracket + 1);
    if (after.startsWith(':')) {
      const portNum = Number(after.slice(1));
      if (!Number.isSafeInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw Error('invalid_manual_address');
      }
      port = portNum;
    } else if (after.length > 0) {
      throw Error('invalid_manual_address');
    }
  } else {
    const colonIndex = addressPart.lastIndexOf(':');
    if (colonIndex !== -1) {
      host = addressPart.slice(0, colonIndex);
      const portNum = Number(addressPart.slice(colonIndex + 1));
      if (!Number.isSafeInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw Error('invalid_manual_address');
      }
      port = portNum;
    } else {
      host = addressPart;
    }
  }

  host = host.trim().replace(/\.$/u, '');
  if (!host || !isLocalTarget(host)) {
    throw Error('invalid_manual_address');
  }

  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const url = `${scheme}//${authority}:${port}`;
  const hubId = hints?.hubId?.trim() || `manual:${host}:${port}`;
  const name = hints?.name ? sanitizeServiceName(hints.name) : 'Haus Hub (Manual)';

  return {
    id: `haus-hub:${hubId}`,
    hubId,
    homeId: hints?.homeId?.trim(),
    name: name || 'Haus Hub (Manual)',
    url,
    host,
    port,
    protocol: '1',
    fingerprint: hints?.fingerprint?.trim(),
    source: 'manual',
  };
}
