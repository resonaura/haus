/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppCatalogCategory, AppCatalogEntry } from './catalog.js';
import { resolveImageArchTemplate } from './image.js';
import {
  validateAppManifest,
  type AppArchitecture,
  type AppBuildRecipe,
  type AppIngress,
  type AppManifest,
  type AppMount,
  type AppOptionSchema,
  type AppPortMapping,
  type AppSecretDeclaration,
} from './manifest.js';

export interface ConvertHaAddonInput {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly repositoryUrl: string;
  readonly repositoryMaintainer?: string;
  readonly commitSha: string;
  readonly addonConfigPath: string;
  readonly hasDockerfile: boolean;
  readonly config: Record<string, unknown>;
}

const ARCH_MAP: Readonly<Record<string, AppArchitecture>> = {
  amd64: 'amd64',
  x86_64: 'amd64',
  arm64: 'arm64',
  aarch64: 'arm64',
  armv7: 'armv7',
  armhf: 'armv7',
  i386: 'i386',
};

const VALID_SERVICE_RE = /^(?:mqtt|mysql):(?:provide|want|need)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeHaAddonAppId(repositoryId: string, addonSlug: string): string {
  const cleanRepo = repositoryId.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const cleanSlug = addonSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  let id = `${cleanRepo}-${cleanSlug || 'addon'}`;
  if (id.length > 64) {
    id = id.slice(0, 64).replace(/-+$/g, '');
  }
  if (id.length < 3) id = `${id}-app`;
  return id;
}

function parseArchitectures(raw: unknown): AppArchitecture[] {
  if (!Array.isArray(raw)) return ['amd64', 'arm64'];
  const out: AppArchitecture[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const mapped = ARCH_MAP[item.trim().toLowerCase()];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out.length > 0 ? out : ['amd64', 'arm64'];
}

function parsePorts(raw: unknown): AppPortMapping[] | undefined {
  if (!isRecord(raw)) return undefined;
  const ports: AppPortMapping[] = [];
  for (const [spec, hostVal] of Object.entries(raw)) {
    const match = /^(\d{1,5})(?:\/(tcp|udp))?$/i.exec(spec.trim());
    if (!match?.[1]) continue;
    const containerPort = Number.parseInt(match[1], 10);
    if (containerPort < 1 || containerPort > 65535) continue;
    const protocol = match[2]?.toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const hostPort =
      typeof hostVal === 'number' && Number.isInteger(hostVal) && hostVal >= 1 && hostVal <= 65535
        ? hostVal
        : typeof hostVal === 'string' && /^\d+$/.test(hostVal.trim())
          ? Number.parseInt(hostVal.trim(), 10)
          : undefined;
    ports.push({
      containerPort,
      ...(hostPort && hostPort >= 1 && hostPort <= 65535 ? { hostPort } : {}),
      protocol,
    });
  }
  return ports.length > 0 ? ports : undefined;
}

function mapSingleHaVolume(
  type: string,
  readOnly: boolean,
  customPath?: string,
): AppMount | undefined {
  const cleanType = type.trim().toLowerCase();
  const safePath =
    typeof customPath === 'string' && customPath.startsWith('/') && !customPath.includes('..')
      ? customPath
      : undefined;
  switch (cleanType) {
    case 'data':
      return {
        target: 'data',
        containerPath: safePath ?? '/data',
        ...(readOnly ? { readOnly } : {}),
      };
    case 'config':
    case 'homeassistant_config':
    case 'addon_config':
    case 'app_config':
      return {
        target: 'config',
        containerPath: safePath ?? '/config',
        ...(readOnly ? { readOnly } : {}),
      };
    case 'share':
      return {
        target: 'share',
        containerPath: safePath ?? '/share',
        ...(readOnly ? { readOnly } : {}),
      };
    case 'media':
      return {
        target: 'media',
        containerPath: safePath ?? '/media',
        ...(readOnly ? { readOnly } : {}),
      };
    case 'backup':
      return {
        target: 'backup',
        containerPath: safePath ?? '/backup',
        ...(readOnly ? { readOnly } : {}),
      };
    default:
      return undefined;
  }
}

function parseMounts(raw: unknown): AppMount[] {
  const mounts: AppMount[] = [{ target: 'data', containerPath: '/data' }];
  const seen = new Set<string>(['data:/data']);
  if (!Array.isArray(raw)) return mounts;

  for (const item of raw) {
    let mapped: AppMount | undefined;
    if (typeof item === 'string') {
      const [typePart, modePart] = item.split(':');
      const readOnly = modePart?.trim().toLowerCase() === 'ro';
      mapped = mapSingleHaVolume(typePart ?? '', readOnly);
    } else if (isRecord(item) && typeof item.type === 'string') {
      const readOnly = item.read_only === true;
      const customPath = typeof item.path === 'string' ? item.path : undefined;
      mapped = mapSingleHaVolume(item.type, readOnly, customPath);
    }
    if (!mapped) continue;
    const key = `${mapped.target}:${mapped.containerPath}`;
    if (!seen.has(key)) {
      seen.add(key);
      mounts.push(mapped);
    }
  }
  return mounts;
}

function parseOptionsAndSecrets(
  rawOptions: unknown,
  rawSchema: unknown,
): {
  readonly options?: readonly AppOptionSchema[];
  readonly secrets?: readonly AppSecretDeclaration[];
} {
  const defaults = isRecord(rawOptions) ? rawOptions : {};
  const schema = isRecord(rawSchema) ? rawSchema : {};
  const keys = Array.from(new Set([...Object.keys(schema), ...Object.keys(defaults)]));
  const options: AppOptionSchema[] = [];
  const secrets: AppSecretDeclaration[] = [];

  for (const key of keys) {
    if (!key || key.length > 80) continue;
    const rule = schema[key];
    const defVal = defaults[key];

    if (typeof rule === 'string') {
      const trimmed = rule.trim();
      const optional = trimmed.endsWith('?');
      const base = optional ? trimmed.slice(0, -1).trim() : trimmed;
      if (base === 'password') {
        secrets.push({ name: key, required: !optional });
        continue;
      }
      const listMatch = /^list\((.+)\)$/i.exec(base);
      if (listMatch?.[1]) {
        const choices = listMatch[1]
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean);
        options.push({
          name: key,
          type: 'select',
          required: !optional,
          ...(defVal !== undefined ? { default: defVal } : {}),
          ...(choices.length > 0 ? { choices } : {}),
        });
        continue;
      }
      const isNum = /^(?:int|float|port)(?:\([^)]*\))?$/i.test(base);
      const isBool = /^bool$/i.test(base);
      options.push({
        name: key,
        type: isBool ? 'boolean' : isNum ? 'number' : 'string',
        required: !optional,
        ...(defVal !== undefined ? { default: defVal } : {}),
      });
      continue;
    }

    if (Array.isArray(rule) || Array.isArray(defVal)) {
      options.push({
        name: key,
        type: 'list',
        required: false,
        ...(Array.isArray(defVal) ? { default: defVal } : {}),
      });
      continue;
    }

    if (typeof defVal === 'boolean') {
      options.push({ name: key, type: 'boolean', required: false, default: defVal });
    } else if (typeof defVal === 'number') {
      options.push({ name: key, type: 'number', required: false, default: defVal });
    } else if (typeof defVal === 'string') {
      if (/pass|secret|token|api[_-]?key/i.test(key)) {
        secrets.push({ name: key, required: false });
      } else {
        options.push({ name: key, type: 'string', required: false, default: defVal });
      }
    }
  }

  return {
    ...(options.length > 0 ? { options } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
  };
}

function classifyAddonCategory(
  name: string,
  description: string,
  slug: string,
): AppCatalogCategory {
  const probe = `${slug} ${name} ${description}`.toLowerCase();
  if (/camera|rtsp|nvr|frigate|doorbell|security|alarm|motion/.test(probe)) return 'security';
  if (/plex|jellyfin|music|audio|media|airplay|dlna|spotify|snapcast/.test(probe)) return 'media';
  if (
    /dns|adguard|pihole|wireguard|tailscale|vpn|proxy|nginx|caddy|network|matter|thread/.test(probe)
  )
    return 'network';
  if (/mqtt|zigbee|zwave|bridge|ble|bluetooth|knx|modbus|govee|tuya|homebridge|esphome/.test(probe))
    return 'bridge';
  if (/node-red|appdaemon|automation|scheduler|cron/.test(probe)) return 'automation';
  return 'utility';
}

function ensureTaggedImage(imageRef: string, version: string): string {
  if (imageRef.includes('@sha256:')) return imageRef;
  const lastSlash = imageRef.lastIndexOf('/');
  const tail = lastSlash >= 0 ? imageRef.slice(lastSlash + 1) : imageRef;
  return tail.includes(':') ? imageRef : `${imageRef}:${version}`;
}

/** Converts a Home Assistant Supervisor add-on `config.yaml`/`config.json` into a validated Haus `AppCatalogEntry`. */
export function convertHaAddonConfigToCatalogEntry(
  input: ConvertHaAddonInput,
): AppCatalogEntry | undefined {
  const { config } = input;
  const name = typeof config.name === 'string' ? config.name.trim() : '';
  const slug = typeof config.slug === 'string' ? config.slug.trim() : '';
  const versionRaw =
    typeof config.version === 'string' || typeof config.version === 'number'
      ? String(config.version).trim()
      : '';
  if (!name || !slug || !versionRaw) return undefined;

  const id = normalizeHaAddonAppId(input.repositoryId, slug);
  const description =
    typeof config.description === 'string' && config.description.trim()
      ? config.description.trim()
      : `${name} from ${input.repositoryName}.`;
  const architectures = parseArchitectures(config.arch);
  const rawImage = typeof config.image === 'string' ? config.image.trim() : '';
  const addonDir = input.addonConfigPath.includes('/')
    ? input.addonConfigPath.slice(0, input.addonConfigPath.lastIndexOf('/'))
    : '.';

  let image: string;
  let build: AppBuildRecipe | undefined;
  if (rawImage) {
    image = ensureTaggedImage(resolveImageArchTemplate(rawImage), versionRaw);
  } else if (input.hasDockerfile && /^[a-f0-9]{40}$/i.test(input.commitSha)) {
    const safeTag = versionRaw.replace(/[^A-Za-z0-9._-]/g, '-');
    image = `haus-local/${id}:${safeTag}`;
    build = {
      repository: input.repositoryUrl.replace(/#.*$/, ''),
      commit: input.commitSha,
      context: addonDir || '.',
      dockerfile: 'Dockerfile',
    };
  } else {
    return undefined;
  }

  const ports = parsePorts(config.ports);
  const mounts = parseMounts(config.map);
  const { options, secrets } = parseOptionsAndSecrets(config.options, config.schema);
  const networkMode = config.host_network === true ? 'host' : 'bridge';

  const ingressPortRaw =
    typeof config.ingress_port === 'number' && Number.isInteger(config.ingress_port)
      ? config.ingress_port
      : 8099;
  const ingress: AppIngress | undefined =
    config.ingress === true && ingressPortRaw >= 1 && ingressPortRaw <= 65535
      ? {
          enabled: true,
          port: ingressPortRaw,
          slug,
          ...(typeof config.panel_title === 'string' && config.panel_title.trim()
            ? { title: config.panel_title.trim() }
            : {}),
        }
      : undefined;

  const services = Array.isArray(config.services)
    ? config.services.filter(
        (s): s is string => typeof s === 'string' && VALID_SERVICE_RE.test(s.trim()),
      )
    : undefined;

  const env: Record<string, string> | undefined = isRecord(config.environment)
    ? Object.fromEntries(
        Object.entries(config.environment)
          .filter(
            ([, val]) =>
              typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean',
          )
          .map(([k, val]) => [k, String(val)]),
      )
    : undefined;

  const candidate: AppManifest = {
    id,
    name,
    version: versionRaw,
    image,
    description,
    architectures,
    network: { mode: networkMode },
    mounts,
    ...(ports ? { ports } : {}),
    ...(options ? { options } : {}),
    ...(secrets ? { secrets } : {}),
    ...(ingress ? { ingress } : {}),
    ...(build ? { build } : {}),
    ...(services && services.length > 0 ? { services } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };

  const validation = validateAppManifest(candidate);
  if (!validation.valid || !validation.manifest) return undefined;

  const docUrl =
    typeof config.url === 'string' && /^https?:\/\//i.test(config.url.trim())
      ? config.url.trim()
      : input.repositoryUrl.replace(/#.*$/, '');
  const stage = typeof config.stage === 'string' ? config.stage.trim().toLowerCase() : 'stable';

  return {
    manifest: validation.manifest,
    category: classifyAddonCategory(name, description, slug),
    runtimeType: 'docker',
    verified: false,
    trustScore: stage === 'experimental' ? 62 : 76,
    stabilityTier: stage === 'experimental' ? 'bronze' : 'silver',
    channel: stage === 'experimental' ? 'beta' : 'stable',
    featured: false,
    author: input.repositoryMaintainer || input.repositoryName,
    documentationUrl: docUrl,
    repositoryUrl: input.repositoryUrl.replace(/#.*$/, ''),
    addonConfigPath: input.addonConfigPath,
    repositoryId: input.repositoryId,
    repositoryName: input.repositoryName,
    customRepository: true,
  };
}
