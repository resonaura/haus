/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type BrandIconKind =
  'integration' | 'addon' | 'app' | 'hacs' | 'homebridge' | 'scrypted' | 'plugin';

export const VALID_BRAND_KINDS: ReadonlySet<string> = new Set<BrandIconKind>([
  'integration',
  'addon',
  'app',
  'hacs',
  'homebridge',
  'scrypted',
  'plugin',
]);

export interface BrandIconHint {
  readonly name?: string;
  readonly supportedBy?: string;
  readonly repositoryUrl?: string;
  readonly category?: string;
  readonly addonSlug?: string;
}

export interface GithubRepoRef {
  readonly owner: string;
  readonly repo: string;
}

const SAFE_BRAND_ID_RE = /^[a-zA-Z0-9._/@-]+$/;
const SAFE_GITHUB_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

/** Maps known Haus app IDs, add-on slugs, vendor bridges, and virtual domains to HA brand domains. */
export const BRAND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  haus: ['homekit'],
  home_assistant: ['homeassistant'],
  supervisor: ['hassio', 'homeassistant'],
  core: ['homeassistant'],
  os: ['homeassistant'],
  'tuya-rtsp-bridge': ['tuya', 'smart_life'],
  tuya_local: ['tuya', 'localtuya'],
  localtuya: ['tuya', 'smart_life'],
  smartlife: ['smart_life', 'tuya'],
  'aqara-cameras': ['aqara', 'xiaomi_aqara', 'homekit_controller'],
  aqara: ['aqara', 'xiaomi_aqara'],
  govee2mqtt: ['govee', 'mqtt'],
  'homebridge-govee': ['govee', 'homebridge'],
  'matter-server': ['matter'],
  matter_server: ['matter'],
  'homebridge-appletv-enhanced': ['apple_tv', 'homekit'],
  appletv: ['apple_tv'],
  meross_lan: ['meross', 'meross_lan'],
  sonoff: ['sonoff', 'ewelink'],
  sonofflan: ['sonoff', 'ewelink'],
  xiaomi_miot: ['xiaomi_miio', 'xiaomi'],
  xiaomi_miot_auto: ['xiaomi_miio', 'xiaomi'],
  eufy_security: ['eufy', 'eufylife_ble'],
  dahua: ['amcrest', 'dahua', 'onvif'],
  amcrest: ['amcrest', 'dahua'],
  zigbee2mqtt: ['zigbee2mqtt', 'mqtt', 'zha'],
  z2m: ['zigbee2mqtt', 'mqtt', 'zha'],
  mosquitto: ['mqtt'],
  wyoming: ['wyoming', 'assist_pipeline'],
  whisper: ['wyoming', 'assist_pipeline'],
  piper: ['wyoming', 'assist_pipeline'],
  openwakeword: ['wyoming', 'assist_pipeline'],
  go2rtc: ['ffmpeg', 'onvif', 'generic'],
  rtsp: ['onvif', 'ffmpeg', 'generic'],
  generic_camera: ['generic', 'ffmpeg'],
  music_assistant: ['music_assistant', 'mass'],
  'music-assistant': ['music_assistant', 'mass'],
  node_red: ['nodered'],
  'node-red': ['nodered'],
  adguard_home: ['adguard'],
  nginx_proxy_manager: ['nginx_proxy_manager'],
  mariadb: ['mariadb', 'sql'],
  terminal: ['ssh'],
  homebridge: ['homebridge', 'homekit'],
  'homebridge-hue': ['hue'],
  'homebridge-ring': ['ring'],
  'homebridge-nest': ['nest'],
  'homebridge-shelly': ['shelly'],
  'homebridge-sonos': ['sonos'],
  'homebridge-tuya': ['tuya', 'smart_life'],
  'homebridge-tuya-platform': ['tuya', 'smart_life'],
  'homebridge-unifi-protect': ['unifiprotect', 'unifi'],
  'unifi-protect': ['unifiprotect', 'unifi'],
  unifi_protect: ['unifiprotect', 'unifi'],
  'homebridge-lgwebos-tv': ['webostv'],
  'homebridge-samsung-tizen': ['samsungtv'],
  'homebridge-mqttthing': ['mqtt', 'homebridge'],
  'homebridge-camera-ui': ['ffmpeg', 'onvif', 'homebridge'],
  'homebridge-camera-ffmpeg': ['ffmpeg', 'onvif', 'homebridge'],
  scrypted: ['scrypted', 'homekit'],
  hacs: ['hacs'],
};

/** Well-known community / HACS / bridge repositories for GitHub icon & avatar fallback. */
export const KNOWN_BRAND_REPOS: Readonly<Record<string, string>> = {
  hacs: 'hacs/integration',
  sonoff: 'AlexxIT/SonoffLAN',
  sonofflan: 'AlexxIT/SonoffLAN',
  xiaomi_miot: 'al-one/hass-xiaomi-miot',
  xiaomi_miot_auto: 'al-one/hass-xiaomi-miot',
  meross_lan: 'krahabb/meross_lan',
  sensibo: 'GuyKh/sensibo-custom-component',
  tuya_local: 'make-all/tuya-local',
  localtuya: 'rospogrigio/localtuya',
  eufy_security: 'fuatakgun/eufy_security',
  govee: 'bwp91/homebridge-govee',
  'homebridge-govee': 'bwp91/homebridge-govee',
  '@homebridge-plugins/homebridge-govee': 'bwp91/homebridge-govee',
  'homebridge-unifi-protect': 'hjdhjd/homebridge-unifi-protect',
  'homebridge-hue': 'ebaauw/homebridge-hue',
  'homebridge-camera-ui': 'seydx/homebridge-camera-ui',
  'homebridge-ring': 'dgreif/ring',
  'homebridge-tuya-platform': '0x5e/homebridge-tuya-platform',
  'homebridge-mqttthing': 'arachnetech/homebridge-mqttthing',
  'homebridge-appletv-enhanced': 'lukasroegner/homebridge-apple-tv-enhanced',
  'tuya-rtsp-bridge': 'resonaura/scrypted-tuya',
  aqara_gateway: 'NiceBoyIT/AqaraGateway',
  bermuda: 'agittins/bermuda',
  adaptive_lighting: 'basnijholt/adaptive-lighting',
  spook: 'frenck/spook',
  browser_mod: 'thomasloven/hass-browser_mod',
  frigate: 'blakeblackshear/frigate-hass-integration',
};

export function validateBrandIconInput(
  kind: unknown,
  id: unknown,
): { kind: BrandIconKind; id: string } {
  const kindStr = String(kind);
  if (!VALID_BRAND_KINDS.has(kindStr)) {
    throw new Error('Invalid brand icon.');
  }
  if (typeof id !== 'string') {
    throw new Error('Invalid brand icon.');
  }
  const trimmed = id.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 160 ||
    !SAFE_BRAND_ID_RE.test(trimmed) ||
    trimmed.includes('..') ||
    trimmed.includes('//') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/')
  ) {
    throw new Error('Invalid brand icon.');
  }
  return { kind: kindStr as BrandIconKind, id: trimmed };
}

export function isValidDomainToken(token: string): boolean {
  return (
    token.length > 0 &&
    token.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(token) &&
    !token.includes('..')
  );
}

export function parseGithubRepo(input: string | undefined): GithubRepoRef | null {
  if (!input) return null;
  const trimmed = input.trim();
  const urlMatch = /^https?:\/\/github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git|\/.*)?$/i.exec(
    trimmed,
  );
  const rawMatch = urlMatch ? null : /^([^/@\s]+)\/([^/\s]+)$/.exec(trimmed);
  const owner = (urlMatch?.[1] ?? rawMatch?.[1] ?? '').trim();
  const repo = (urlMatch?.[2] ?? rawMatch?.[2] ?? '').replace(/\.git$/i, '').trim();
  if (
    !owner ||
    !repo ||
    owner === '..' ||
    repo === '..' ||
    owner.includes('..') ||
    repo.includes('..') ||
    !SAFE_GITHUB_SEGMENT_RE.test(owner) ||
    !SAFE_GITHUB_SEGMENT_RE.test(repo)
  ) {
    return null;
  }
  return { owner, repo };
}

function pushUniqueDomain(out: string[], seen: Set<string>, raw: string | undefined): void {
  if (!raw) return;
  const normalized = raw.trim().toLowerCase();
  if (isValidDomainToken(normalized) && !seen.has(normalized)) {
    seen.add(normalized);
    out.push(normalized);
  }
  const underscored = normalized.replaceAll('-', '_');
  if (isValidDomainToken(underscored) && !seen.has(underscored)) {
    seen.add(underscored);
    out.push(underscored);
  }
}

/** Expands an id and hint into prioritized candidate HA brand domains. */
export function deriveCandidateDomains(
  kind: BrandIconKind,
  id: string,
  hint?: BrandIconHint,
): string[] {
  const seeds: string[] = [];
  const lower = id.toLowerCase();
  const addSeed = (value: string | undefined): void => {
    if (value && !seeds.includes(value)) seeds.push(value);
  };

  addSeed(lower);
  if (hint?.addonSlug) addSeed(hint.addonSlug.toLowerCase());
  if (hint?.supportedBy) addSeed(hint.supportedBy.toLowerCase());

  if (lower.startsWith('@') && lower.includes('/')) {
    const [scope, pkg] = lower.split('/', 2);
    addSeed(pkg);
    addSeed(scope.slice(1));
  } else if (lower.includes('/')) {
    const [owner, repo] = lower.split('/', 2);
    addSeed(repo);
    addSeed(owner);
  }

  // Strip Supervisor repository hash prefixes (e.g. "a0d7b954_zigbee2mqtt" or "core_mosquitto")
  for (const s of Array.from(seeds)) {
    const repoStrip = /^(?:core|local|[a-f0-9]{6,12})_(.+)$/.exec(s);
    if (repoStrip?.[1]) addSeed(repoStrip[1]);
    const prefixStrip = /^(?:homebridge|zigbee2mqtt|wyoming|addon|hass|ha)[-_](.+)$/.exec(s);
    if (prefixStrip?.[1]) addSeed(prefixStrip[1]);
    const suffixStrip =
      /^(.+?)[-_](?:integration|custom|component|bridge|addon|plugin|server|platform|enhanced|local|cloud)$/.exec(
        s,
      );
    if (suffixStrip?.[1]) addSeed(suffixStrip[1]);
  }

  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    pushUniqueDomain(expanded, seen, seed);
    const aliases = BRAND_ALIASES[seed] ?? BRAND_ALIASES[seed.replaceAll('-', '_')];
    if (aliases) {
      for (const alias of aliases) pushUniqueDomain(expanded, seen, alias);
    }
  }

  if (kind === 'homebridge') pushUniqueDomain(expanded, seen, 'homebridge');
  if (kind === 'scrypted') pushUniqueDomain(expanded, seen, 'scrypted');
  if (kind === 'hacs') pushUniqueDomain(expanded, seen, 'hacs');
  return expanded;
}

interface FallbackStyle {
  readonly c1: string;
  readonly c2: string;
  readonly paths: string;
}

const CURATED_FALLBACKS: Readonly<Record<string, FallbackStyle>> = {
  haus: {
    c1: '#0A84FF',
    c2: '#0055D4',
    paths:
      '<path d="M128 54L56 112v86a10 10 0 0 0 10 10h42v-54h40v54h42a10 10 0 0 0 10-10v-86L128 54z" fill="#fff"/>',
  },
  homeassistant: {
    c1: '#41BDF5',
    c2: '#039BE5',
    paths:
      '<path d="M128 54L54 114v86h148v-86L128 54zm0 42a18 18 0 1 1 0 36 18 18 0 0 1 0-36z" fill="#fff"/>',
  },
  hassio: {
    c1: '#38BDF8',
    c2: '#0284C7',
    paths: '<path d="M78 82h100l-16 92H94L78 82zm28-24h44v24h-44V58z" fill="#fff"/>',
  },
  hacs: {
    c1: '#41BDF5',
    c2: '#1E88E5',
    paths:
      '<path d="M128 52l68 38v76l-68 38-68-38V90l68-38zm0 26L82 104v48l46 26 46-26v-48l-46-26z" fill="#fff"/>',
  },
  homebridge: {
    c1: '#7E57C2',
    c2: '#512DA8',
    paths:
      '<path d="M128 58L60 112v82h136v-82L128 58zm0 36c22 0 40 16 40 36v42H88v-42c0-20 18-36 40-36z" fill="#fff"/>',
  },
  scrypted: {
    c1: '#3F51B5',
    c2: '#1A237E',
    paths:
      '<path d="M72 86h78a22 22 0 0 1 22 22v10l26-18v56l-26-18v12a22 22 0 0 1-22 22H72a22 22 0 0 1-22-22v-42a22 22 0 0 1 22-22z" fill="#fff"/>',
  },
  matter: {
    c1: '#0F172A',
    c2: '#334155',
    paths:
      '<circle cx="128" cy="72" r="16" fill="#fff"/><circle cx="76" cy="158" r="16" fill="#fff"/><circle cx="180" cy="158" r="16" fill="#fff"/><path d="M128 96v32m0 0l-34 20m34-20l34 20" stroke="#fff" stroke-width="14" stroke-linecap="round"/>',
  },
  zigbee: {
    c1: '#EB5528',
    c2: '#B91C1C',
    paths:
      '<circle cx="128" cy="128" r="64" fill="none" stroke="#fff" stroke-width="14"/><path d="M90 98h76l-76 60h76" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  mqtt: {
    c1: '#660066',
    c2: '#3B0764',
    paths:
      '<circle cx="80" cy="176" r="14" fill="#fff"/><path d="M80 132a44 44 0 0 1 44 44M80 96a80 80 0 0 1 80 80M80 62a114 114 0 0 1 114 114" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>',
  },
  camera: {
    c1: '#0EA5E9',
    c2: '#0369A1',
    paths:
      '<path d="M68 88h82a18 18 0 0 1 18 18v10l30-20v64l-30-20v10a18 18 0 0 1-18 18H68a18 18 0 0 1-18-18v-44a18 18 0 0 1 18-18z" fill="#fff"/>',
  },
  voice: {
    c1: '#10B981',
    c2: '#047857',
    paths:
      '<rect x="108" y="56" width="40" height="84" rx="20" fill="#fff"/><path d="M84 120a44 44 0 0 0 88 0M128 164v32m-24 0h48" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>',
  },
};

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#3B82F6', '#1D4ED8'],
  ['#10B981', '#047857'],
  ['#8B5CF6', '#6D28D9'],
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#BE185D'],
  ['#06B6D4', '#0E7490'],
  ['#6366F1', '#4338CA'],
  ['#EF4444', '#B91C1C'],
];

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) =>
    ch === '<'
      ? '&lt;'
      : ch === '>'
        ? '&gt;'
        : ch === '&'
          ? '&amp;'
          : ch === '"'
            ? '&quot;'
            : '&#39;',
  );
}

/** Synthesizes a high-contrast rounded icon SVG data URI for any domain/app/add-on without an upstream raster icon. */
export function bundledFallbackSvgDataUri(
  kind: BrandIconKind,
  id: string,
  hint?: BrandIconHint,
): string {
  const candidates = deriveCandidateDomains(kind, id, hint);
  const joined = `${id.toLowerCase()} ${(hint?.name ?? '').toLowerCase()}`;

  let match: FallbackStyle | undefined;
  for (const domain of candidates) {
    if (CURATED_FALLBACKS[domain]) {
      match = CURATED_FALLBACKS[domain];
      break;
    }
  }
  if (!match) {
    if (/camera|rtsp|onvif|nvr|frigate|go2rtc|dahua|amcrest|reolink|ring/.test(joined)) {
      match = CURATED_FALLBACKS.camera;
    } else if (/wyoming|whisper|piper|wake|voice|assist/.test(joined)) {
      match = CURATED_FALLBACKS.voice;
    } else if (/zigbee|zha|z2m/.test(joined)) {
      match = CURATED_FALLBACKS.zigbee;
    } else if (/matter|thread/.test(joined)) {
      match = CURATED_FALLBACKS.matter;
    } else if (/mqtt|mosquitto/.test(joined)) {
      match = CURATED_FALLBACKS.mqtt;
    } else if (kind === 'homebridge') {
      match = CURATED_FALLBACKS.homebridge;
    } else if (kind === 'scrypted') {
      match = CURATED_FALLBACKS.scrypted;
    } else if (kind === 'hacs') {
      match = CURATED_FALLBACKS.hacs;
    }
  }

  let c1: string;
  let c2: string;
  let inner: string;
  if (match) {
    c1 = match.c1;
    c2 = match.c2;
    inner = match.paths;
  } else {
    let hash = 2166136261;
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const pair = PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0];
    c1 = pair[0];
    c2 = pair[1];
    const sourceLabel = (hint?.name || candidates[0] || id).replace(/^@[^/]+\//, '');
    const tokens = sourceLabel.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    const mono =
      tokens.length >= 2
        ? `${tokens[0]![0]}${tokens[1]![0]}`.toUpperCase()
        : sourceLabel.slice(0, 2).toUpperCase() || 'HA';
    inner = `<text x="128" y="152" text-anchor="middle" font-family="system-ui,sans-serif" font-size="88" font-weight="700" letter-spacing="-2" fill="#fff">${escapeXml(mono)}</text>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect x="12" y="12" width="232" height="232" rx="52" fill="url(#bg)"/>` +
    `${inner}</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
