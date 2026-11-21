/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';

export const GENERIC_NETWORK_DOMAIN = 'generic_network';

export type NetworkDeviceType =
  | 'router'
  | 'network_switch'
  | 'repeater'
  | 'access_point'
  | 'modem'
  | 'firewall'
  | 'nas'
  | 'bridge';

export interface NetworkDeviceTypeOption {
  readonly value: NetworkDeviceType;
  readonly label: string;
}

export const NETWORK_DEVICE_TYPE_OPTIONS: readonly NetworkDeviceTypeOption[] = [
  { value: 'router', label: 'Router' },
  { value: 'network_switch', label: 'Switch' },
  { value: 'repeater', label: 'Repeater' },
  { value: 'access_point', label: 'Access Point' },
  { value: 'modem', label: 'Modem' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'nas', label: 'NAS / Server' },
  { value: 'bridge', label: 'Bridge' },
];

const NETWORK_TYPE_SET = new Set<string>(NETWORK_DEVICE_TYPE_OPTIONS.map((opt) => opt.value));

export function isNetworkDeviceType(value: unknown): value is NetworkDeviceType {
  return typeof value === 'string' && NETWORK_TYPE_SET.has(value);
}

export function networkDeviceTypeLabel(type: NetworkDeviceType): string {
  return NETWORK_DEVICE_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? 'Network Device';
}

export interface NormalizedNetworkTarget {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port?: number;
  readonly probePort: number;
  readonly managementUrl: string;
}

export interface NetworkDeviceEntryConfig extends NormalizedNetworkTarget {
  readonly name: string;
  readonly deviceType: NetworkDeviceType;
}

export type TargetValidationError = 'invalid_host' | 'invalid_port';

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (code < 0x20 || (code >= 0x7f && code <= 0x9f))) return true;
  }
  return false;
}

function isValidHostOrIp(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!bare || bare.length > 253) return false;
  if (isIP(bare) !== 0) return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
    bare,
  );
}

function parseOptionalPort(raw: unknown): { port?: number; error?: TargetValidationError } {
  if (raw === undefined || raw === null || raw === '') return {};
  const numeric = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return { error: 'invalid_port' };
  }
  return { port: numeric };
}

/**
 * Validates and normalizes a user-supplied network device IP, hostname, or web UI URL.
 * Rejects URL credentials, unsupported schemes, control characters, and out-of-range ports.
 */
export function normalizeNetworkDeviceTarget(input: {
  readonly host: unknown;
  readonly scheme?: unknown;
  readonly port?: unknown;
}):
  | { readonly ok: true; readonly target: NormalizedNetworkTarget }
  | { readonly ok: false; readonly field: 'host' | 'port'; readonly error: TargetValidationError } {
  if (typeof input.host !== 'string') {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }
  const trimmedHost = input.host.trim();
  if (!trimmedHost || trimmedHost.length > 2048 || hasControlChars(trimmedHost)) {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }
  if (/\s/.test(trimmedHost)) {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }

  const portResult = parseOptionalPort(input.port);
  if (portResult.error) {
    return { ok: false, field: 'port', error: portResult.error };
  }

  const explicitScheme =
    input.scheme === 'https' || input.scheme === 'http' ? input.scheme : undefined;
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedHost);

  let candidateUrl: string;
  if (hasExplicitScheme) {
    candidateUrl = trimmedHost;
  } else {
    const scheme = explicitScheme ?? 'http';
    const needsBrackets =
      trimmedHost.includes(':') && !trimmedHost.startsWith('[') && isIP(trimmedHost) === 6;
    candidateUrl = `${scheme}://${needsBrackets ? `[${trimmedHost}]` : trimmedHost}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }
  if (parsed.username || parsed.password || !isValidHostOrIp(parsed.hostname)) {
    return { ok: false, field: 'host', error: 'invalid_host' };
  }

  if (explicitScheme && !hasExplicitScheme) {
    parsed.protocol = `${explicitScheme}:`;
  }
  if (portResult.port !== undefined) {
    parsed.port = String(portResult.port);
  }

  const finalScheme: 'http' | 'https' = parsed.protocol === 'https:' ? 'https' : 'http';
  const defaultPort = finalScheme === 'https' ? 443 : 80;
  const parsedPort = parsed.port ? Number(parsed.port) : undefined;
  if (
    parsedPort !== undefined &&
    (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)
  ) {
    return { ok: false, field: 'port', error: 'invalid_port' };
  }

  const displayHost = parsed.hostname.replace(/^\[|\]$/g, '');
  const effectivePort = parsedPort && parsedPort !== defaultPort ? parsedPort : undefined;

  return {
    ok: true,
    target: {
      scheme: finalScheme,
      host: displayHost,
      ...(effectivePort !== undefined ? { port: effectivePort } : {}),
      probePort: parsedPort ?? defaultPort,
      managementUrl: parsed.href,
    },
  };
}
