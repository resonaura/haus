/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { AppState } from 'react-native';
import type { ScanResult } from '@dawidzawada/bonjour-zeroconf';
import { normalizeHaBaseUrl } from '../storage/mobile-persistence';

const HOME_ASSISTANT_SERVICE = '_home-assistant._tcp';
const DISCOVERY_SECONDS = 4;
const DISCOVERY_SETUP_TIMEOUT_MS = 30_000;
const ADDRESS_RESOLVE_TIMEOUT_MS = 1_500;

export interface LocalHomeCandidate {
  id: string;
  name: string;
  url: string;
  host: string;
  port: number;
}

export type LocalDiscoveryOutcome =
  | { status: 'complete'; servers: LocalHomeCandidate[] }
  | { status: 'permission-denied'; servers: [] }
  | { status: 'unavailable'; servers: [] }
  | { status: 'cancelled'; servers: LocalHomeCandidate[] };

export interface LocalDiscoveryTask {
  result: Promise<LocalDiscoveryOutcome>;
  cancel(): void;
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

function isLocalIpv4(value: string): boolean {
  const octets = ipv4Parts(value);
  if (!octets) return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function isLocalIpv6(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes('%') || !host.includes(':')) return false;
  // RFC 4193 unique-local addresses. Loopback and interface-scoped link-local
  // addresses are not usable as a portable endpoint for another device.
  return host.startsWith('fc') || host.startsWith('fd');
}

function localHostname(value: string): boolean {
  const host = value.toLowerCase().replace(/\.$/, '');
  return host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa');
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

/** mDNS is an untrusted hint: only credential-free local HTTP endpoints are selectable. */
export function parseLocalHomeAssistantService(
  service: ScanResult,
): LocalHomeCandidate | undefined {
  const port = service.port;
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) return;

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
    return { id: url, name, url, host, port };
  } catch {
    return;
  }
}

/** A bounded native mDNS scan. It always stops on timeout, backgrounding or unmount. */
export function createLocalHomeDiscovery(): LocalDiscoveryTask {
  let resolve!: (outcome: LocalDiscoveryOutcome) => void;
  let settled = false;
  let scanner: import('@dawidzawada/bonjour-zeroconf').BonjourScanner | undefined;
  let resultsListener: { remove(): void } | undefined;
  let failureListener: { remove(): void } | undefined;
  let appStateListener: { remove(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const servers = new Map<string, LocalHomeCandidate>();
  const result = new Promise<LocalDiscoveryOutcome>((done) => (resolve = done));

  const finish = (status: LocalDiscoveryOutcome['status']) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    appStateListener?.remove();
    resultsListener?.remove();
    failureListener?.remove();
    try {
      scanner?.stop();
    } catch {
      // Native cleanup is best-effort; the result still settles promptly.
    }
    resolve(
      status === 'complete' || status === 'cancelled'
        ? {
            status,
            servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)),
          }
        : { status, servers: [] },
    );
  };

  appStateListener = AppState.addEventListener('change', (state) => {
    if (state === 'background') finish('cancelled');
  });
  // Bound native module startup and permission UI; start the short scan window
  // only after the user has answered the OS permission prompt.
  timer = setTimeout(() => finish('complete'), DISCOVERY_SETUP_TIMEOUT_MS);

  void (async () => {
    try {
      const native = await import('@dawidzawada/bonjour-zeroconf');
      if (settled) return;
      if (!(await native.requestLocalNetworkPermission())) {
        finish('permission-denied');
        return;
      }
      if (settled) return;

      scanner = new native.BonjourScanner({ id: 'haus-home' });
      resultsListener = scanner.listenForScanResults((results) => {
        if (settled) return;
        for (const service of results) {
          const candidate = parseLocalHomeAssistantService(service);
          if (candidate) servers.set(candidate.id, candidate);
        }
      });
      failureListener = scanner.listenForScanFail((failure) => {
        if (failure === native.BonjourFail.DISCOVERY_FAILED)
          finish(servers.size > 0 ? 'complete' : 'unavailable');
      });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish('complete'), DISCOVERY_SECONDS * 1_000);
      scanner.scan(HOME_ASSISTANT_SERVICE, 'local', {
        addressResolveTimeout: ADDRESS_RESOLVE_TIMEOUT_MS,
      });
    } catch {
      finish('unavailable');
    }
  })();

  return { result, cancel: () => finish('cancelled') };
}
