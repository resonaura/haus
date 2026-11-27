/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { parseGithubRepo, type BrandIconHint, type GithubRepoRef } from './fallbacks.js';
import { fetchImageDataUri } from './remote.js';

const KNOWN_ADDON_REPOSITORIES: Readonly<
  Record<string, { owner: string; repo?: string; pattern?: 'addon-prefix' }>
> = {
  core: { owner: 'home-assistant', repo: 'addons' },
  a0d7b954: { owner: 'hassio-addons', pattern: 'addon-prefix' },
  '5c53de3b': { owner: 'esphome', repo: 'home-assistant-addon' },
  '45df7312': { owner: 'zigbee2mqtt', repo: 'hassio-zigbee2mqtt' },
  d5369777: { owner: 'music-assistant', repo: 'home-assistant-addon' },
  ccab4aaf: { owner: 'blakeblackshear', repo: 'frigate-hass-addons' },
  c2627b67: { owner: 'AlexxIT', repo: 'hassio-addons' },
};

const KNOWN_ADDON_ICON_REPOS: Readonly<
  Record<string, { readonly owner: string; readonly repo: string; readonly subdir?: string }>
> = {
  mosquitto: { owner: 'home-assistant', repo: 'addons', subdir: 'mosquitto' },
  matter_server: { owner: 'home-assistant', repo: 'addons', subdir: 'matter_server' },
  'matter-server': { owner: 'home-assistant', repo: 'addons', subdir: 'matter_server' },
  mariadb: { owner: 'home-assistant', repo: 'addons', subdir: 'mariadb' },
  samba: { owner: 'home-assistant', repo: 'addons', subdir: 'samba' },
  ssh: { owner: 'home-assistant', repo: 'addons', subdir: 'ssh' },
  duckdns: { owner: 'home-assistant', repo: 'addons', subdir: 'duckdns' },
  letsencrypt: { owner: 'home-assistant', repo: 'addons', subdir: 'letsencrypt' },
  nginx_proxy: { owner: 'home-assistant', repo: 'addons', subdir: 'nginx_proxy' },
  dnsmasq: { owner: 'home-assistant', repo: 'addons', subdir: 'dnsmasq' },
  dhcp_server: { owner: 'home-assistant', repo: 'addons', subdir: 'dhcp_server' },
  rpc_shutdown: { owner: 'home-assistant', repo: 'addons', subdir: 'rpc_shutdown' },
  configurator: { owner: 'home-assistant', repo: 'addons', subdir: 'configurator' },
  check_config: { owner: 'home-assistant', repo: 'addons', subdir: 'check_config' },
  deconz: { owner: 'home-assistant', repo: 'addons', subdir: 'deconz' },
  zwave_js: { owner: 'home-assistant', repo: 'addons', subdir: 'zwave_js' },
  openthread_border_router: {
    owner: 'home-assistant',
    repo: 'addons',
    subdir: 'openthread_border_router',
  },
  otbr: { owner: 'home-assistant', repo: 'addons', subdir: 'openthread_border_router' },
  piper: { owner: 'home-assistant', repo: 'addons', subdir: 'piper' },
  whisper: { owner: 'home-assistant', repo: 'addons', subdir: 'whisper' },
  openwakeword: { owner: 'home-assistant', repo: 'addons', subdir: 'openwakeword' },
  silabs_multiprotocol: { owner: 'home-assistant', repo: 'addons', subdir: 'silabs-multiprotocol' },
  vlc: { owner: 'home-assistant', repo: 'addons', subdir: 'vlc' },
  adguard: { owner: 'hassio-addons', repo: 'addon-adguard-home', subdir: 'adguard' },
  adguard_home: { owner: 'hassio-addons', repo: 'addon-adguard-home', subdir: 'adguard' },
  nodered: { owner: 'hassio-addons', repo: 'addon-node-red', subdir: 'nodered' },
  'node-red': { owner: 'hassio-addons', repo: 'addon-node-red', subdir: 'nodered' },
  node_red: { owner: 'hassio-addons', repo: 'addon-node-red', subdir: 'nodered' },
  vscode: { owner: 'hassio-addons', repo: 'addon-vscode', subdir: 'vscode' },
  studio_code_server: { owner: 'hassio-addons', repo: 'addon-vscode', subdir: 'vscode' },
  wireguard: { owner: 'hassio-addons', repo: 'addon-wireguard', subdir: 'wireguard' },
  tailscale: { owner: 'hassio-addons', repo: 'addon-tailscale', subdir: 'tailscale' },
  nginxproxymanager: {
    owner: 'hassio-addons',
    repo: 'addon-nginx-proxy-manager',
    subdir: 'nginxproxymanager',
  },
  nginx_proxy_manager: {
    owner: 'hassio-addons',
    repo: 'addon-nginx-proxy-manager',
    subdir: 'nginxproxymanager',
  },
  grafana: { owner: 'hassio-addons', repo: 'addon-grafana', subdir: 'grafana' },
  influxdb: { owner: 'hassio-addons', repo: 'addon-influxdb', subdir: 'influxdb' },
  appdaemon: { owner: 'hassio-addons', repo: 'addon-appdaemon', subdir: 'appdaemon' },
  glances: { owner: 'hassio-addons', repo: 'addon-glances', subdir: 'glances' },
  jupyterlab: { owner: 'hassio-addons', repo: 'addon-jupyterlab', subdir: 'jupyterlab' },
  logviewer: { owner: 'hassio-addons', repo: 'addon-log-viewer', subdir: 'logviewer' },
  phpmyAdmin: { owner: 'hassio-addons', repo: 'addon-phpmyadmin', subdir: 'phpmyadmin' },
  phpmyadmin: { owner: 'hassio-addons', repo: 'addon-phpmyadmin', subdir: 'phpmyadmin' },
  portainer: { owner: 'hassio-addons', repo: 'addon-portainer', subdir: 'portainer' },
  ssh_web_terminal: { owner: 'hassio-addons', repo: 'addon-ssh', subdir: 'ssh' },
  tasmoadmin: { owner: 'hassio-addons', repo: 'addon-tasmoadmin', subdir: 'tasmoadmin' },
  unifi: { owner: 'hassio-addons', repo: 'addon-unifi', subdir: 'unifi' },
  zerotier: { owner: 'hassio-addons', repo: 'addon-zerotier', subdir: 'zerotier' },
  zwavejs2mqtt: { owner: 'hassio-addons', repo: 'addon-zwave-js-ui', subdir: 'zwave-js-ui' },
  'zwave-js-ui': { owner: 'hassio-addons', repo: 'addon-zwave-js-ui', subdir: 'zwave-js-ui' },
  zigbee2mqtt: { owner: 'zigbee2mqtt', repo: 'hassio-zigbee2mqtt', subdir: 'zigbee2mqtt' },
  esphome: { owner: 'esphome', repo: 'home-assistant-addon', subdir: 'esphome' },
  music_assistant: {
    owner: 'music-assistant',
    repo: 'home-assistant-addon',
    subdir: 'music_assistant',
  },
  'music-assistant': {
    owner: 'music-assistant',
    repo: 'home-assistant-addon',
    subdir: 'music_assistant',
  },
  frigate: { owner: 'blakeblackshear', repo: 'frigate-hass-addons', subdir: 'frigate' },
  go2rtc: { owner: 'AlexxIT', repo: 'hassio-addons', subdir: 'go2rtc' },
  govee2mqtt: { owner: 'wez', repo: 'govee2mqtt', subdir: 'addon' },
  'aqara-g5pro': { owner: 'resonaura', repo: 'aqara-g5pro-mqtt', subdir: 'app' },
  'nixie-clock': { owner: 'resonaura', repo: 'nixie-clock-mqtt', subdir: 'app' },
  'haus-kettle': { owner: 'resonaura', repo: 'haus-kettle', subdir: 'haus-kettle' },
  'tuya-rtsp-bridge': { owner: 'resonaura', repo: 'scrypted-tuya', subdir: 'bridge' },
};

export function stripAddonRepoPrefix(raw: string): { prefix: string | null; slug: string } {
  const lower = raw.trim().toLowerCase();
  const m = /^(core|local|[a-f0-9]{6,12})_(.+)$/.exec(lower);
  if (m) return { prefix: m[1]!, slug: m[2]! };
  return { prefix: null, slug: lower };
}

export function cleanAddonConfigSubdir(configPath: string | undefined): string | null {
  if (!configPath) return null;
  const trimmed = configPath.trim().replace(/^\/+/, '');
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) return null;
  const dir = trimmed.slice(0, slash);
  if (!dir || dir === '.' || dir.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(dir)) {
    return null;
  }
  return dir;
}

interface AddonRepoCandidate {
  readonly ref: GithubRepoRef;
  readonly subdirs: readonly string[];
}

function deriveAddonRepoCandidates(
  id: string,
  hint: BrandIconHint | undefined,
): AddonRepoCandidate[] {
  const { prefix, slug } = stripAddonRepoPrefix(hint?.addonSlug ?? id);
  const hyphenSlug = slug.replaceAll('_', '-');
  const underscoreSlug = slug.replaceAll('-', '_');
  const configSubdir = cleanAddonConfigSubdir(hint?.addonConfigPath);
  const out: AddonRepoCandidate[] = [];
  const seen = new Set<string>();

  const push = (owner: string, repo: string, subdirs: readonly string[]) => {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}:${subdirs.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ref: { owner, repo }, subdirs });
  };

  const explicitRepo = parseGithubRepo(hint?.repositoryUrl) ?? parseGithubRepo(hint?.repository);
  if (explicitRepo) {
    const dirs = [
      ...(configSubdir ? [configSubdir] : []),
      slug,
      ...(hyphenSlug !== slug ? [hyphenSlug] : []),
      ...(underscoreSlug !== slug ? [underscoreSlug] : []),
      'addon',
      'app',
      '',
    ];
    push(explicitRepo.owner, explicitRepo.repo, dirs);
  }

  const curated =
    KNOWN_ADDON_ICON_REPOS[id.toLowerCase()] ??
    KNOWN_ADDON_ICON_REPOS[slug] ??
    KNOWN_ADDON_ICON_REPOS[underscoreSlug] ??
    KNOWN_ADDON_ICON_REPOS[hyphenSlug];
  if (curated) {
    push(curated.owner, curated.repo, [...(curated.subdir ? [curated.subdir] : []), slug, '']);
  }

  const repoSlug = (hint?.repository ?? prefix ?? '').trim().toLowerCase();
  const knownRepo = KNOWN_ADDON_REPOSITORIES[repoSlug];
  if (knownRepo) {
    if (knownRepo.repo) {
      push(knownRepo.owner, knownRepo.repo, [
        slug,
        ...(underscoreSlug !== slug ? [underscoreSlug] : []),
        ...(hyphenSlug !== slug ? [hyphenSlug] : []),
        '',
      ]);
    } else if (knownRepo.pattern === 'addon-prefix') {
      push(knownRepo.owner, `addon-${hyphenSlug}`, [slug, hyphenSlug, underscoreSlug, '']);
      if (underscoreSlug !== hyphenSlug) {
        push(knownRepo.owner, `addon-${underscoreSlug}`, [slug, underscoreSlug, '']);
      }
    }
  }

  return out;
}

export async function resolveAddonGithubIcon(options: {
  readonly id: string;
  readonly hint?: BrandIconHint;
  readonly githubRawBaseUrl: string;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
}): Promise<string | null> {
  const { id, hint, githubRawBaseUrl, fetchFn, timeoutMs } = options;
  const candidates = deriveAddonRepoCandidates(id, hint);
  const cappedTimeout = Math.min(timeoutMs, 3_500);
  const fileNames = ['icon@2x.png', 'icon.png', 'logo@2x.png', 'logo.png'];

  for (const candidate of candidates) {
    const owner = encodeURIComponent(candidate.ref.owner);
    const repo = encodeURIComponent(candidate.ref.repo);
    const seenSub = new Set<string>();
    for (const sub of candidate.subdirs) {
      if (seenSub.has(sub)) continue;
      seenSub.add(sub);
      const subPrefix = sub
        ? `/${sub
            .split('/')
            .map((seg) => encodeURIComponent(seg))
            .join('/')}`
        : '';
      for (const file of fileNames) {
        try {
          const url = new URL(`/${owner}/${repo}/HEAD${subPrefix}/${file}`, githubRawBaseUrl);
          const hit = await fetchImageDataUri(url, fetchFn, cappedTimeout);
          if (hit) return hit;
        } catch {
          // continue to next candidate
        }
      }
    }
  }
  return null;
}
