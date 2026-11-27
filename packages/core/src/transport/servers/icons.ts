/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

/** Saved choices are identifiers, never remote URLs or arbitrary SVG. */
export const serverIconOptions = [
  { id: 'server', label: 'Server' },
  { id: 'miku', label: 'Miku' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'laptop', label: 'Laptop' },
  { id: 'nas', label: 'NAS' },
  { id: 'storage', label: 'Storage' },
  { id: 'home-assistant', label: 'Home Assistant' },
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'Mac' },
  { id: 'linux', label: 'Linux' },
  { id: 'ubuntu', label: 'Ubuntu' },
  { id: 'debian', label: 'Debian' },
  { id: 'fedora', label: 'Fedora' },
  { id: 'arch', label: 'Arch Linux' },
  { id: 'nixos', label: 'NixOS' },
  { id: 'alpine', label: 'Alpine Linux' },
  { id: 'raspberry-pi', label: 'Raspberry Pi OS' },
  { id: 'opensuse', label: 'openSUSE' },
] as const;

export type ServerIconId = (typeof serverIconOptions)[number]['id'];

export interface ServerIconSource {
  readonly id?: string;
  readonly name?: string;
  readonly kind?: string;
  readonly osLabel?: string;
  readonly platform?: string | null;
  readonly host?: {
    readonly platform?: string | null;
    readonly release?: string | null;
    readonly distribution?: string | null;
    readonly osName?: string | null;
    readonly metricsScope?: string | null;
    readonly operatingSystem?: {
      readonly name?: string | null;
      readonly platform?: string | null;
    } | null;
  } | null;
}

const iconIds = new Set<string>(serverIconOptions.map(({ id }) => id));

export function isServerIconId(value: unknown): value is ServerIconId {
  return typeof value === 'string' && iconIds.has(value);
}

/** Absence means automatic; it follows future OS metadata instead of freezing a guess. */
export function sanitizeServerIcon(value: unknown): ServerIconId | undefined {
  return isServerIconId(value) ? value : undefined;
}

export function resolveServerIcon(server: ServerIconSource, override?: string): ServerIconId {
  const custom = sanitizeServerIcon(override);
  if (custom) return custom;
  if (server.kind === 'home-assistant') return 'home-assistant';
  if (
    server.id?.toLocaleLowerCase() === 'miku' ||
    server.name?.trim().toLocaleLowerCase() === 'miku'
  ) {
    return 'miku';
  }
  const host = server.host;
  const platform = host?.platform ?? server.platform ?? '';
  const metadata = [
    platform,
    host?.release,
    host?.distribution,
    host?.osName,
    host?.metricsScope,
    host?.operatingSystem?.name,
    host?.operatingSystem?.platform,
    host ? undefined : server.osLabel,
  ]
    .filter(Boolean)
    .join(' ');

  // WSL reports a Linux kernel. Its owning physical machine is still Windows.
  if (/\b(?:win32|win64|windows|wsl2?|microsoft)\b/i.test(metadata)) return 'windows';
  if (/\b(?:darwin|macos|mac\s*os(?:\s*x)?|osx)\b/i.test(metadata)) return 'macos';
  if (/\bhome\s*assistant(?:\s*os)?\b/i.test(metadata)) return 'home-assistant';

  // Only explicit distribution evidence counts. Names and hostnames are intentionally
  // excluded, and generic kernel suffixes such as "-generic" never imply Ubuntu.
  if (/\b(?:raspbian|raspberry\s*pi\s*os)\b/i.test(metadata)) return 'raspberry-pi';
  if (/\bubuntu\b/i.test(metadata)) return 'ubuntu';
  if (/\bdebian\b/i.test(metadata)) return 'debian';
  if (/\bfedora\b/i.test(metadata)) return 'fedora';
  if (/\b(?:archlinux|arch\s*linux)\b/i.test(metadata)) return 'arch';
  if (/\bnixos\b/i.test(metadata)) return 'nixos';
  if (/\balpine(?:\s*linux)?\b/i.test(metadata)) return 'alpine';
  if (/\b(?:opensuse|suse)\b/i.test(metadata)) return 'opensuse';
  if (/\blinux\b/i.test(metadata)) return 'linux';
  return 'server';
}

export function formatHostOperatingSystem(
  host: {
    readonly operatingSystem?: {
      readonly name?: string | null;
      readonly version?: string | null;
      readonly architecture?: string | null;
    } | null;
    readonly osName?: string | null;
    readonly metricsScope?: string | null;
    readonly release?: string | null;
    readonly platform?: string | null;
    readonly arch?: string | null;
  } | null,
): string {
  const os = host?.operatingSystem;
  if (os?.name) return [os.name, os.version, os.architecture].filter(Boolean).join(' · ');
  if (/^(?:Microsoft )?Windows\b/i.test(host?.osName ?? '')) return host!.osName!;
  if (host?.metricsScope === 'wsl' || /microsoft|wsl/i.test(host?.release ?? '')) {
    return 'Windows · version not reported';
  }
  return (
    host?.osName ||
    [
      host?.platform === 'darwin'
        ? 'macOS'
        : host?.platform === 'win32'
          ? 'Windows'
          : host?.platform,
      host?.release,
      host?.arch,
    ]
      .filter(Boolean)
      .join(' · ') ||
    'Not reported'
  );
}

export function formatHostMetricsScope(
  host: {
    readonly metricsScope?: string | null;
    readonly platform?: string | null;
    readonly release?: string | null;
    readonly scope?: 'host' | 'container' | null;
  } | null,
): string {
  if (!host) return 'Not reported';
  if (host.metricsScope === 'windows' || host.platform === 'win32') return 'Windows Host';
  if (host.metricsScope === 'wsl' || /microsoft|wsl/i.test(host.release ?? '')) {
    return 'WSL resources';
  }
  return host.scope === 'container' ? 'Container' : 'Host system';
}

export function formatHostBatteryStatus(
  battery?: {
    readonly charging?: boolean | null;
    readonly powerConnected?: boolean | null;
  } | null,
): string {
  if (battery?.charging === true) return 'Charging';
  if (battery?.powerConnected === true) return 'Plugged in';
  if (battery?.powerConnected === false) return 'On battery';
  return battery?.charging === false ? 'Not charging' : '';
}
