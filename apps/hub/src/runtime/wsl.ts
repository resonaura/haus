/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { endianness, networkInterfaces, release } from 'node:os';
import { posix, resolve } from 'node:path';

export type WslNetworkingMode = 'not_wsl' | 'mirrored' | 'nat' | 'unknown';

export type WslDiagnosticCode =
  | 'wsl_nat_networking_detected'
  | 'wsl_nat_mdns_limited'
  | 'wsl_data_on_windows_mount'
  | 'wsl_systemd_inactive'
  | 'wsl_mirrored_networking_active';

export interface WslEnvironmentProbe {
  readonly env?: NodeJS.ProcessEnv;
  readonly kernelRelease?: string;
  readonly hasWslInterop?: boolean;
  readonly hasDockerEnv?: boolean;
  readonly systemdActive?: boolean;
  readonly wslConfContent?: string;
  readonly wslConfigContent?: string;
  readonly routeTableContent?: string;
  readonly interfaces?: ReturnType<typeof networkInterfaces>;
}

export interface WslEnvironmentInfo {
  readonly isWsl: boolean;
  readonly isContainer: boolean;
  readonly distroName?: string;
  readonly kernelRelease: string;
}

export interface WslAssessmentOptions extends WslEnvironmentProbe {
  readonly dataDirectory?: string;
  readonly mediaDirectory?: string;
  readonly nvrDirectory?: string;
  readonly relayPort?: number;
}

export interface WslEnvironmentAssessment extends WslEnvironmentInfo {
  readonly networkingMode: WslNetworkingMode;
  readonly systemdActive: boolean;
  readonly wslConfSystemd?: boolean;
  readonly wslConfigNetworkingMode?: 'mirrored' | 'nat';
  readonly dataOnWindowsMount: boolean;
  readonly unsafeWindowsMountPaths: readonly string[];
  readonly defaultGatewayIp?: string;
  readonly lanIps: readonly string[];
  readonly natIps: readonly string[];
  readonly recommendedRelayUrl?: string;
  readonly diagnostics: readonly WslDiagnosticCode[];
  readonly warnings: readonly string[];
}

const VIRTUAL_BRIDGE_PATTERN =
  /^(?:lo|docker\d*|br-[a-f0-9]+|veth[a-f0-9]+|virbr\d*|tun\d*|tap\d*|tailscale\d*|wg\d*|dummy\d*|vethernet(?:\s|\(|$)|wsl\d*)/i;

const DEFAULT_RELAY_PORT = 8791;

export function isPrivateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isVirtualBridgeInterface(name: string): boolean {
  return VIRTUAL_BRIDGE_PATTERN.test(name.trim());
}

export function isWindowsMountPath(candidatePath: string | undefined): boolean {
  if (!candidatePath?.trim()) return false;
  const normalized = posix.normalize(candidatePath.trim().replaceAll('\\', '/'));
  return /^\/mnt\/[a-z](?:\/|$)/i.test(normalized);
}

function readOptionalText(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function parseProcNetRouteDefaultGateway(
  raw: string,
  hostEndianness: 'BE' | 'LE' = endianness(),
): string | undefined {
  const bigEndianHost = hostEndianness === 'BE';
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    const [, destinationHex, gatewayHex] = cols;
    if (destinationHex !== '00000000') continue;
    if (!gatewayHex || gatewayHex === '00000000' || !/^[0-9a-fA-F]{8}$/.test(gatewayHex)) {
      continue;
    }
    const bytes = [
      Number.parseInt(gatewayHex.slice(0, 2), 16),
      Number.parseInt(gatewayHex.slice(2, 4), 16),
      Number.parseInt(gatewayHex.slice(4, 6), 16),
      Number.parseInt(gatewayHex.slice(6, 8), 16),
    ];
    const octets = bigEndianHost ? bytes : bytes.reverse();
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) continue;
    const ip = octets.join('.');
    if (ip === '0.0.0.0' || ip.startsWith('127.')) continue;
    return ip;
  }
  return undefined;
}

function parseIniSection(
  raw: string | undefined,
  targetSection: string,
): Map<string, string> | undefined {
  if (!raw) return undefined;
  const wanted = targetSection.trim().toLowerCase();
  const entries = new Map<string, string>();
  let inTarget = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const stripped = rawLine.replace(/^\uFEFF/, '').trim();
    if (!stripped || stripped.startsWith('#') || stripped.startsWith(';')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(stripped);
    if (sectionMatch) {
      inTarget = sectionMatch[1].trim().toLowerCase() === wanted;
      continue;
    }
    if (!inTarget) continue;
    const eqIndex = stripped.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = stripped.slice(0, eqIndex).trim().toLowerCase();
    const val = stripped
      .slice(eqIndex + 1)
      .split(/[;#]/, 1)[0]
      .trim();
    if (key) entries.set(key, val);
  }
  return entries;
}

export function parseWslConfSystemd(raw: string | undefined): boolean | undefined {
  const boot = parseIniSection(raw, 'boot');
  const val = boot?.get('systemd')?.toLowerCase();
  if (!val) return undefined;
  if (val === 'true' || val === '1' || val === 'yes') return true;
  if (val === 'false' || val === '0' || val === 'no') return false;
  return undefined;
}

export function parseWslConfigNetworkingMode(
  raw: string | undefined,
): 'mirrored' | 'nat' | undefined {
  const wsl2 = parseIniSection(raw, 'wsl2');
  const val = wsl2?.get('networkingmode')?.toLowerCase();
  if (val === 'mirrored' || val === 'nat') return val;
  return undefined;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isHyperVNatRange(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [first, second] = ip.split('.').map(Number);
  return first === 172 && second >= 16 && second <= 31;
}

function sharesSubnet20(a: string, b: string): boolean {
  if (isIP(a) !== 4 || isIP(b) !== 4) return false;
  return ((ipv4ToInt(a) ^ ipv4ToInt(b)) & 0xfffff000) === 0;
}

export function detectWslEnvironment(probe: WslEnvironmentProbe = {}): WslEnvironmentInfo {
  const env = probe.env ?? process.env;
  const kernelRelease = probe.kernelRelease ?? release();
  const hasWslInterop = probe.hasWslInterop ?? existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  const isContainer =
    probe.hasDockerEnv ??
    (existsSync('/.dockerenv') || env.CONTAINER === 'true' || env.HAUS_CONTAINER === 'true');
  const distroName = env.WSL_DISTRO_NAME?.trim() || undefined;
  const isWsl = Boolean(
    hasWslInterop || /microsoft|wsl/i.test(kernelRelease) || distroName || env.WSL_INTEROP?.trim(),
  );
  return { isWsl, isContainer, distroName, kernelRelease };
}

export function assessWslEnvironment(options: WslAssessmentOptions = {}): WslEnvironmentAssessment {
  const env = options.env ?? process.env;
  const info = detectWslEnvironment(options);
  const wslConfRaw = options.wslConfContent ?? readOptionalText('/etc/wsl.conf');
  const wslConfSystemd = parseWslConfSystemd(wslConfRaw);
  const systemdActive = options.systemdActive ?? existsSync('/run/systemd/system');
  const wslConfigNetworkingMode = parseWslConfigNetworkingMode(options.wslConfigContent);

  const routeRaw =
    options.routeTableContent ??
    readOptionalText(env.HAUS_PROC_ROUTE_FILE?.trim() || '/proc/net/route');
  const defaultGatewayIp = routeRaw ? parseProcNetRouteDefaultGateway(routeRaw) : undefined;

  const ifaces = options.interfaces ?? networkInterfaces();
  const hasLoopback0 = Object.keys(ifaces).some((name) => name.toLowerCase() === 'loopback0');

  const lanIps = new Set<string>();
  const natIps = new Set<string>();
  for (const [ifaceName, entries] of Object.entries(ifaces)) {
    if (isVirtualBridgeInterface(ifaceName)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isPrivateIpv4(entry.address)) continue;
      if (
        info.isWsl &&
        isHyperVNatRange(entry.address) &&
        (!defaultGatewayIp ||
          isHyperVNatRange(defaultGatewayIp) ||
          sharesSubnet20(entry.address, defaultGatewayIp))
      ) {
        natIps.add(entry.address);
      } else {
        lanIps.add(entry.address);
      }
    }
  }

  let networkingMode: WslNetworkingMode = 'not_wsl';
  if (info.isWsl) {
    const explicitMode = env.HAUS_WSL_NETWORKING?.trim().toLowerCase();
    if (explicitMode === 'mirrored' || explicitMode === 'nat') {
      networkingMode = explicitMode;
    } else if (wslConfigNetworkingMode) {
      networkingMode = wslConfigNetworkingMode;
    } else if (hasLoopback0 || lanIps.size > 0) {
      networkingMode = 'mirrored';
    } else if (!info.isContainer && natIps.size > 0) {
      networkingMode = 'nat';
    } else {
      networkingMode = 'unknown';
    }
  }

  const candidatePaths = [
    options.dataDirectory ?? env.HAUS_DATA_DIR ?? env.HAUS_DATA,
    options.mediaDirectory ?? env.HAUS_MEDIA,
    options.nvrDirectory ?? env.HAUS_NVR_DATA_DIR,
  ];
  const unsafeWindowsMountPaths = Array.from(
    new Set(
      candidatePaths
        .map((p) => (p?.trim() ? resolve(p.trim()) : undefined))
        .filter((p): p is string => Boolean(p && isWindowsMountPath(p))),
    ),
  );
  const dataOnWindowsMount = unsafeWindowsMountPaths.length > 0;

  const rawRelayPort = options.relayPort ?? Number.parseInt(env.HAUS_LAN_RELAY_PORT ?? '', 10);
  const relayPort =
    Number.isInteger(rawRelayPort) && rawRelayPort > 0 && rawRelayPort <= 65535
      ? rawRelayPort
      : DEFAULT_RELAY_PORT;
  const recommendedRelayUrl =
    networkingMode === 'nat' && defaultGatewayIp
      ? `http://${defaultGatewayIp}:${relayPort}`
      : undefined;

  const diagnostics: WslDiagnosticCode[] = [];
  const warnings: string[] = [];

  if (info.isWsl) {
    if (networkingMode === 'mirrored') {
      diagnostics.push('wsl_mirrored_networking_active');
    } else if (networkingMode === 'nat') {
      diagnostics.push('wsl_nat_networking_detected');
      warnings.push(
        'WSL2 NAT networking detected: LAN clients and smart-home discovery need networkingMode=mirrored in %UserProfile%\\.wslconfig or Windows portproxy + lan-relay (see apps/hub/docs/install.md).',
      );
      if (!env.HAUS_MDNS_ADDRESS?.trim() && !/^(0|false)$/i.test(env.HAUS_MDNS_ADVERTISE || '')) {
        diagnostics.push('wsl_nat_mdns_limited');
      }
    }

    if (dataOnWindowsMount) {
      diagnostics.push('wsl_data_on_windows_mount');
      warnings.push(
        `WSL data path(s) on Windows /mnt drive (${unsafeWindowsMountPaths.join(', ')}) harm performance and SQLite WAL locking; store Hub data inside Linux ext4 (e.g. /var/lib/haus).`,
      );
    }

    if (!info.isContainer && !systemdActive) {
      diagnostics.push('wsl_systemd_inactive');
      warnings.push(
        'WSL systemd is inactive: enable [boot] systemd=true in /etc/wsl.conf and run wsl --shutdown on Windows so Haus Hub can run persistently in the background.',
      );
    }
  }

  return {
    ...info,
    networkingMode,
    systemdActive,
    wslConfSystemd,
    wslConfigNetworkingMode,
    dataOnWindowsMount,
    unsafeWindowsMountPaths,
    defaultGatewayIp,
    lanIps: Array.from(lanIps),
    natIps: Array.from(natIps),
    recommendedRelayUrl,
    diagnostics,
    warnings,
  };
}
