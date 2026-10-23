/** Saved choices are identifiers, never remote URLs or arbitrary SVG. */
export const serverIconOptions = [
  { id: 'server', label: 'Server' },
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
  kind?: string;
  host?: {
    platform?: string | null;
    release?: string | null;
    distribution?: string | null;
    osName?: string | null;
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
  const host = server.host;
  const platform = host?.platform ?? '';
  const metadata = [platform, host?.release, host?.distribution, host?.osName].join(' ');

  // WSL reports a Linux kernel. Its owning physical machine is still Windows.
  if (/\b(?:win32|win64|windows|wsl2?|microsoft)\b/i.test(metadata)) return 'windows';
  if (/\b(?:darwin|macos|mac\s*os(?:\s*x)?|osx)\b/i.test(metadata)) return 'macos';

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
