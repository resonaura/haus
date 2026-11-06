/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ScanResult } from '@dawidzawada/bonjour-zeroconf';
import { normalizeHaBaseUrl } from '../storage/mobile-persistence';

export interface LocalNvrCandidate {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
}

function ipv4Parts(value: string): number[] | undefined {
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0')))
  )
    return;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return;
  return octets;
}

function isPrivateIpv4(value: string): boolean {
  const octets = ipv4Parts(value);
  if (!octets) return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isUniqueLocalIpv6(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  return !host.includes('%') && /^f[cd][0-9a-f]{2}:/u.test(host);
}

function isLocalHostname(value: string): boolean {
  return value.toLowerCase().replace(/\.$/u, '').endsWith('.local');
}

function safeServiceName(value: string): string {
  let result = '';
  let length = 0;
  for (const character of value.trim()) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
    result += character;
    if (++length >= 128) break;
  }
  return result.trim();
}

/** Bonjour results are untrusted pairing hints; only local, credential-free endpoints are accepted. */
export function parseLocalHausNvrService(service: ScanResult): LocalNvrCandidate | undefined {
  const port = service.port;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) return;

  const ipv4 = typeof service.ipv4 === 'string' && isPrivateIpv4(service.ipv4) ? service.ipv4 : '';
  const ipv6 =
    typeof service.ipv6 === 'string' && isUniqueLocalIpv6(service.ipv6) ? service.ipv6 : '';
  const advertisedHost = typeof service.hostname === 'string' ? service.hostname.trim() : '';
  let host = ipv4 || ipv6 || (isLocalHostname(advertisedHost) ? advertisedHost : '');
  if (!host) return;
  host = host.replace(/\.$/u, '');
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  try {
    const url = normalizeHaBaseUrl(`http://${authority}:${port}`);
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      parsed.protocol !== 'http:' ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      return;
    const name =
      typeof service.name === 'string' && service.name.trim()
        ? safeServiceName(service.name)
        : 'Haus NVR';
    return { id: url, name: name || 'Haus NVR', url, host, port };
  } catch {
    return;
  }
}
