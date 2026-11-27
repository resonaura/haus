/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isPrivateIpv4 } from '../pairing/discovery.js';
import { isRecord } from '../record.js';

function isIpv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isIpv6Literal(host: string): boolean {
  if (!host.includes(':')) return false;
  return /^[0-9a-f:.]+$/i.test(host);
}

/** True for RFC1918/CGNAT/loopback/link-local IPs and `.local`/`.lan`/`.home.arpa` LAN hosts. */
export function isLocalServerHostname(value: string): boolean {
  const host = value
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isIpv4Literal(host)) return isPrivateIpv4(host);
  if (isIpv6Literal(host)) return host === '::1' || /^(fc|fd|fe[89ab])[0-9a-f]{0,2}:/.test(host);
  return /^[a-z0-9][a-z0-9-]*$/.test(host) || host.endsWith('.lan') || host.endsWith('.home.arpa');
}

/** Allow cleartext HTTP only on local networks; reject embedded credentials, paths, or queries. */
export function normalizeServerUrl(input: unknown, serverName = 'Home Assistant'): string {
  if (typeof input !== 'string' || input.length > 2048) {
    throw new Error(`Enter a valid ${serverName} URL.`);
  }
  const candidate = input.trim();
  let url: URL;
  try {
    url = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
  } catch {
    throw new Error(`Enter a valid ${serverName} URL.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`Use the ${serverName} base URL without credentials, a path, or query.`);
  }
  if (url.protocol === 'http:' && !isLocalServerHostname(url.hostname)) {
    throw new Error(`Use HTTPS for ${serverName} outside your local network.`);
  }
  return url.origin;
}

export function validatePreferences(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || JSON.stringify(input).length > 100_000) {
    throw new Error('Invalid preferences.');
  }
  if (Object.keys(input).some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) {
    throw new Error('Invalid preference key.');
  }
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

const DOCUMENTATION_HOSTS = new Set([
  'github.com',
  'www.home-assistant.io',
  'home-assistant.io',
  'developers.home-assistant.io',
  'www.nabucasa.com',
  'www.electronjs.org',
]);

export function validateExternalUrl(input: unknown, serverUrl?: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Invalid external URL.');
  const url = new URL(input);
  const sameServer = Boolean(serverUrl && url.origin === new URL(serverUrl).origin);
  const localDevice = isLocalServerHostname(url.hostname);
  if (
    url.username ||
    url.password ||
    !['http:', 'https:'].includes(url.protocol) ||
    (!sameServer &&
      !localDevice &&
      !(url.protocol === 'https:' && DOCUMENTATION_HOSTS.has(url.hostname)))
  ) {
    throw new Error(
      'Haus can only open local network devices, your Home Assistant server, or supported documentation links.',
    );
  }
  return url.href;
}

export const HUB_DESKTOP_RPC_COMMANDS = new Set([
  'haus/updates/list',
  'haus/updates/check',
  'haus/updates/install',
  'haus/updates/batch',
  'haus/updates/operations',
  'haus/discovery/scan',
  'haus/integration_meta',
  'apps/logs',
]);

export function isHubDesktopRpcCommand(type: string): boolean {
  return HUB_DESKTOP_RPC_COMMANDS.has(type);
}

/** Validates Haus Hub native desktop RPC commands (`haus/updates/*`, `haus/discovery/scan`, `apps/logs`, etc.). */
export function validateHubDesktopRpcCommand(input: unknown): Record<string, unknown> {
  if (!isRecord(input) || typeof input.type !== 'string' || !isHubDesktopRpcCommand(input.type)) {
    throw new Error('This Haus Hub command is not available in Haus.');
  }
  if ('id' in input || 'access_token' in input || 'refresh_token' in input) {
    throw new Error('Native transport owns command identifiers and authentication.');
  }
  if (
    input.type === 'apps/logs' &&
    (typeof input.appId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.appId) ||
      (input.tail !== undefined &&
        (typeof input.tail !== 'number' ||
          !Number.isInteger(input.tail) ||
          input.tail < 1 ||
          input.tail > 2000)) ||
      Object.keys(input).some((key) => !['type', 'appId', 'tail'].includes(key)))
  ) {
    throw new Error('Choose a valid App log stream.');
  }
  if (JSON.stringify(input).length > 256_000) {
    throw new Error('Haus Hub command is too large.');
  }
  return input;
}
