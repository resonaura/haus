/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ScanResult } from '@dawidzawada/bonjour-zeroconf';
import { normalizeHaBaseUrl } from '../storage/mobile-persistence.js';

export interface LocalHomeCandidate {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
  kind?: 'haus-hub' | 'home-assistant';
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

export function isLocalIpv4(value: string): boolean {
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

export function isLocalIpv6(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes('%') || !host.includes(':')) return false;
  if (host === '::1') return true;
  return host.startsWith('fc') || host.startsWith('fd');
}

export function localHostname(value: string): boolean {
  const host = value.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost') return true;
  return host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa');
}

export function safeServiceName(value: string): string {
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

/** Validates discovered Haus Hub services against local candidate and security rules. */
export function parseLocalHausHubService(service: ScanResult): LocalHomeCandidate | undefined {
  const port = service.port;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }

  // Reject public IPv4 or IPv6
  if (typeof service.ipv4 === 'string' && !isLocalIpv4(service.ipv4)) return undefined;
  if (typeof service.ipv6 === 'string' && !isLocalIpv6(service.ipv6)) return undefined;

  const ipv4 = typeof service.ipv4 === 'string' && isLocalIpv4(service.ipv4) ? service.ipv4 : '';
  const ipv6 = typeof service.ipv6 === 'string' && isLocalIpv6(service.ipv6) ? service.ipv6 : '';
  const advertisedHost = typeof service.hostname === 'string' ? service.hostname.trim() : '';
  let host = ipv4 || ipv6 || (localHostname(advertisedHost) ? advertisedHost : '');
  if (!host) return undefined;
  host = host.replace(/\.$/, '');
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
    ) {
      return undefined;
    }
    const rawName =
      typeof service.name === 'string' && service.name.trim()
        ? safeServiceName(service.name)
        : 'Haus Hub';
    const name = rawName || 'Haus Hub';
    return { id: `haus-hub:${url}`, name, url, host, port, kind: 'haus-hub' };
  } catch {
    return undefined;
  }
}

/** mDNS is an untrusted hint: only credential-free local HTTP endpoints are selectable. */
export function parseLocalHomeAssistantService(
  service: ScanResult,
): LocalHomeCandidate | undefined {
  const port = service.port;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) return;

  if (typeof service.ipv4 === 'string' && !isLocalIpv4(service.ipv4)) return undefined;
  if (typeof service.ipv6 === 'string' && !isLocalIpv6(service.ipv6)) return undefined;

  const ipv4 = typeof service.ipv4 === 'string' && isLocalIpv4(service.ipv4) ? service.ipv4 : '';
  const ipv6 = typeof service.ipv6 === 'string' && isLocalIpv6(service.ipv6) ? service.ipv6 : '';
  const advertisedHost = typeof service.hostname === 'string' ? service.hostname.trim() : '';
  let host = ipv4 || ipv6 || (localHostname(advertisedHost) ? advertisedHost : '');
  if (!host) return;
  host = host.replace(/\.$/, '');
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
    const rawName =
      typeof service.name === 'string' && service.name.trim()
        ? safeServiceName(service.name)
        : 'Home Assistant';
    const name = rawName || 'Home Assistant';
    return { id: url, name, url, host, port, kind: 'home-assistant' };
  } catch {
    return;
  }
}
