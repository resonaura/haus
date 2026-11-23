/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import type { AppCatalogCategory, AppCatalogEntry, AppStabilityTier } from '@haus/apps';
import { blockedPackages, packageName } from '../runtime/registry.js';
import {
  ACRONYM_MAP,
  BUILTIN_ECOSYSTEM_SEEDS,
  VENDOR_CATALOG_RULES,
  type EcosystemSeedEntry,
} from './seeds.js';

export { BUILTIN_ECOSYSTEM_SEEDS, type EcosystemSeedEntry };

export type EcosystemRuntimeKind = 'homebridge' | 'scrypted';

export interface EcosystemPluginRecord {
  readonly id: string;
  readonly packageName: string;
  readonly displayName: string;
  readonly runtimeType: EcosystemRuntimeKind;
  readonly version: string;
  readonly description: string;
  readonly category: AppCatalogCategory;
  readonly author?: string;
  readonly repositoryUrl?: string;
  readonly documentationUrl?: string;
  readonly verified: boolean;
  readonly featured: boolean;
  readonly trustScore: number;
  readonly stabilityTier: AppStabilityTier;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly keywords: readonly string[];
}

export interface NpmSearchPackage {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly keywords?: unknown;
  readonly publisher?: { readonly username?: unknown };
  readonly author?: { readonly name?: unknown; readonly username?: unknown };
  readonly links?: {
    readonly npm?: unknown;
    readonly homepage?: unknown;
    readonly repository?: unknown;
  };
}

export interface NpmSearchScore {
  readonly final?: unknown;
  readonly detail?: {
    readonly quality?: unknown;
    readonly popularity?: unknown;
    readonly maintenance?: unknown;
  };
}

export interface NpmSearchObject {
  readonly package?: NpmSearchPackage;
  readonly score?: NpmSearchScore;
}

const BLOCKED_SCRYPTED_PACKAGES = new Set<string>([
  ...blockedPackages,
  'scrypted',
  'scrypted-deploy',
  '@scrypted/core',
  '@scrypted/client',
  '@scrypted/cli',
  '@scrypted/cloud',
  '@scrypted/nvr',
  '@scrypted/types',
  '@scrypted/common',
  '@scrypted/webpack',
  '@scrypted/node-pty',
  '@scrypted/prebuild-install',
  '@scrypted/ffmpeg-static',
  '@scrypted/ffmpeg',
  '@scrypted/libav',
  '@scrypted/rpc',
  '@scrypted/rtsp-server',
  '@scrypted/promise',
  '@scrypted/stream-promise',
  '@scrypted/auth-fetch',
  '@scrypted/deferred',
  '@scrypted/h264-repacketizer',
  '@scrypted/deno',
  '@scrypted/vscode-typescript',
]);

const BLOCKED_HOMEBRIDGE_PACKAGES = new Set<string>([
  'homebridge',
  'homebridge-config-ui-x',
  'homebridge-plugin-ui-utils',
  '@homebridge/plugin-ui-utils',
  'hap-nodejs',
  'homebridge-lib',
]);

export function resolvePluginVendor(
  pkgName: string,
  displayName: string,
): { vendorId: string; vendorName: string } {
  const probe = `${pkgName} ${displayName}`;
  for (const rule of VENDOR_CATALOG_RULES) {
    if (rule.match.test(probe)) {
      return { vendorId: rule.vendorId, vendorName: rule.vendorName };
    }
  }
  let base = pkgName.trim().toLowerCase();
  if (base.startsWith('@')) {
    const slash = base.indexOf('/');
    if (slash !== -1) base = base.slice(slash + 1);
  }
  base = base
    .replace(/^(?:homebridge|scrypted)-plugin-/, '')
    .replace(/^(?:homebridge|scrypted)-/, '');
  const primary = base.split(/[-_./]+/).filter(Boolean)[0] ?? 'plugin';
  const label = ACRONYM_MAP[primary] ?? primary.charAt(0).toUpperCase() + primary.slice(1);
  return { vendorId: primary, vendorName: label };
}

export function computePluginTrustAndStability(params: {
  readonly verified: boolean;
  readonly featured: boolean;
  readonly officialScope?: boolean;
  readonly score?: NpmSearchScore;
}): { trustScore: number; stabilityTier: AppStabilityTier } {
  const rawFinal = Number(params.score?.final);
  const rawPop = Number(params.score?.detail?.popularity);
  const rawQual = Number(params.score?.detail?.quality);
  const rawMaint = Number(params.score?.detail?.maintenance);

  const hasScore = Number.isFinite(rawFinal) && rawFinal > 0;
  const finalScore = hasScore ? Math.max(0, Math.min(1, rawFinal)) : undefined;
  const popScore = Number.isFinite(rawPop) ? Math.max(0, Math.min(1, rawPop)) : finalScore;
  const qualScore = Number.isFinite(rawQual) ? Math.max(0, Math.min(1, rawQual)) : finalScore;
  const maintScore = Number.isFinite(rawMaint) ? Math.max(0, Math.min(1, rawMaint)) : finalScore;

  let trustScore: number;
  if (params.verified && params.featured) {
    const bonus = finalScore !== undefined ? Math.round(finalScore * 6) : 4;
    trustScore = Math.min(97, 91 + bonus);
  } else if (params.verified || params.officialScope) {
    const bonus = finalScore !== undefined ? Math.round(finalScore * 8) : 5;
    trustScore = Math.min(95, 86 + bonus);
  } else if (finalScore !== undefined) {
    const weighted =
      finalScore * 0.45 +
      (popScore ?? finalScore) * 0.3 +
      (qualScore ?? finalScore) * 0.15 +
      (maintScore ?? finalScore) * 0.1;
    trustScore = Math.max(24, Math.min(85, Math.round(22 + weighted * 66)));
  } else {
    trustScore = params.featured ? 82 : 58;
  }

  const stabilityTier: AppStabilityTier =
    trustScore >= 88 ? 'gold' : trustScore >= 74 ? 'silver' : trustScore >= 54 ? 'bronze' : 'low';

  return { trustScore, stabilityTier };
}

export function ecosystemAppId(runtime: EcosystemRuntimeKind, pkgName: string): string {
  const trimmed = pkgName.trim().toLowerCase();
  let slug: string;
  if (runtime === 'scrypted') {
    if (trimmed.startsWith('@scrypted/')) {
      slug = `scrypted-${trimmed.slice('@scrypted/'.length)}`;
    } else if (trimmed.startsWith('@')) {
      const withoutAt = trimmed.slice(1).replace('/', '-');
      slug = withoutAt.startsWith('scrypted-') ? withoutAt : `scrypted-${withoutAt}`;
    } else {
      slug = trimmed.startsWith('scrypted-') ? trimmed : `scrypted-${trimmed}`;
    }
  } else if (trimmed.startsWith('@')) {
    const [scopeRaw, nameRaw = 'plugin'] = trimmed.slice(1).split('/');
    const scope = (scopeRaw ?? '').replace(/[^a-z0-9]+/g, '-');
    const cleanName = nameRaw.replace(/^homebridge-/, '');
    slug = `hb-${scope}-${cleanName}`;
  } else {
    slug = trimmed.startsWith('homebridge-') ? trimmed : `homebridge-${trimmed}`;
  }

  slug = slug
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (slug.length < 3) {
    slug = `${runtime}-${slug || 'plugin'}`;
  }
  if (slug.length > 64) {
    const digest = createHash('sha256').update(`${runtime}:${pkgName}`).digest('hex').slice(0, 6);
    const prefix = slug.slice(0, 57).replace(/-+$/g, '');
    slug = `${prefix}-${digest}`;
  }
  return slug;
}

export function formatPluginDisplayName(runtime: EcosystemRuntimeKind, pkgName: string): string {
  let base = pkgName.trim();
  if (base.startsWith('@')) {
    const slash = base.indexOf('/');
    if (slash !== -1) base = base.slice(slash + 1);
  }
  base = base
    .replace(/^homebridge-plugin-/i, '')
    .replace(/^homebridge-/i, '')
    .replace(/^scrypted-plugin-/i, '')
    .replace(/^scrypted-/i, '');

  const tokens = base.split(/[-_./]+/).filter(Boolean);
  if (tokens.length === 0) return pkgName;

  const formatted = tokens.map((token) => {
    const lower = token.toLowerCase();
    if (ACRONYM_MAP[lower]) return ACRONYM_MAP[lower];
    if (lower.length <= 2 && /^\d+$/.test(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  const title = formatted.join(' ');
  return runtime === 'scrypted' ? `${title} (Scrypted)` : title;
}

export function isAllowedScryptedPlugin(
  pkgName: string,
  keywords: readonly string[] = [],
): boolean {
  if (!packageName(pkgName) || BLOCKED_SCRYPTED_PACKAGES.has(pkgName)) return false;
  if (pkgName.includes('homebridge')) return false;
  const lowerKw = new Set(keywords.map((k) => k.toLowerCase()));
  if (lowerKw.has('scrypted')) return true;
  if (pkgName.startsWith('@scrypted/')) return true;
  return /^(@[a-z0-9._-]+\/)?scrypted-[a-z0-9._-]+$/.test(pkgName);
}

export function isAllowedHomebridgePlugin(
  pkgName: string,
  keywords: readonly string[] = [],
): boolean {
  if (!packageName(pkgName) || BLOCKED_HOMEBRIDGE_PACKAGES.has(pkgName)) return false;
  if (BLOCKED_SCRYPTED_PACKAGES.has(pkgName) || pkgName.startsWith('@scrypted/')) return false;
  if (/example|template|boilerplate|mock-plugin/i.test(pkgName)) return false;
  const lowerKw = new Set(keywords.map((k) => k.toLowerCase()));
  const hasNamePattern = /(?:^|\/)homebridge-[a-z0-9]/i.test(pkgName);
  return hasNamePattern || lowerKw.has('homebridge-plugin');
}

export function classifyPluginCategory(
  runtime: EcosystemRuntimeKind,
  pkgName: string,
  description = '',
  keywords: readonly string[] = [],
): AppCatalogCategory {
  const haystack = `${pkgName} ${description} ${keywords.join(' ')}`.toLowerCase();
  if (
    /camera|rtsp|onvif|nvr|doorbell|reolink|hikvision|amcrest|dahua|unifi-protect|arlo|blink|ring|eufy|lock|alarm|security|intercom|webrtc/.test(
      haystack,
    )
  ) {
    return 'security';
  }
  if (
    /tv|appletv|webos|bravia|sonos|spotify|plex|airplay|media|audio|receiver|denon|yamaha|roku|chromecast|speaker/.test(
      haystack,
    )
  ) {
    return 'media';
  }
  if (
    /router|unifi|eero|pihole|adguard|network|dns|wol|wake-on-lan|ping|fritz|ubiquiti/.test(
      haystack,
    )
  ) {
    return 'network';
  }
  if (/zigbee|zwave|matter|mqtt|hub|bridge|gateway|knx|lutron|deconz|conbee/.test(haystack)) {
    return 'bridge';
  }
  if (/dummy|timer|schedule|webhook|cron|automation|scene|trigger/.test(haystack)) {
    return 'automation';
  }
  return runtime === 'scrypted' ? 'security' : 'integration';
}

export function toAppCatalogEntry(record: EcosystemPluginRecord): AppCatalogEntry {
  const npmUrl = `https://www.npmjs.com/package/${record.packageName}`;
  return {
    category: record.category,
    runtimeType: record.runtimeType,
    packageName: record.packageName,
    verified: record.verified,
    trustScore: record.trustScore,
    stabilityTier: record.stabilityTier,
    vendorId: record.vendorId,
    vendorName: record.vendorName,
    featured: record.featured,
    author: record.author,
    repositoryUrl: record.repositoryUrl ?? npmUrl,
    documentationUrl: record.documentationUrl ?? record.repositoryUrl ?? npmUrl,
    manifest: {
      id: record.id,
      name: record.displayName,
      version: record.version || '1.0.0',
      image: 'node:22-bookworm-slim',
      description: record.description,
      architectures: ['amd64', 'arm64'],
      env: {
        HAUS_PLUGIN_RUNTIME: record.runtimeType,
        HAUS_NPM_PACKAGE: record.packageName,
      },
    },
  };
}

export function parseNpmSearchObject(
  runtime: EcosystemRuntimeKind,
  obj: NpmSearchObject,
  verifiedSet: ReadonlySet<string>,
): EcosystemPluginRecord | null {
  const pkg = obj.package;
  if (!pkg || typeof pkg.name !== 'string') return null;
  const pkgName = pkg.name.trim();
  const keywords = Array.isArray(pkg.keywords)
    ? pkg.keywords.filter((k): k is string => typeof k === 'string')
    : [];

  if (runtime === 'scrypted' && !isAllowedScryptedPlugin(pkgName, keywords)) return null;
  if (runtime === 'homebridge' && !isAllowedHomebridgePlugin(pkgName, keywords)) return null;

  const version =
    typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : '1.0.0';
  const description =
    typeof pkg.description === 'string' && pkg.description.trim()
      ? pkg.description.trim()
      : `${runtime === 'scrypted' ? 'Scrypted' : 'Homebridge'} integration package (${pkgName}).`;
  const author =
    (typeof pkg.publisher?.username === 'string' && pkg.publisher.username.trim()) ||
    (typeof pkg.author?.name === 'string' && pkg.author.name.trim()) ||
    (typeof pkg.author?.username === 'string' && pkg.author.username.trim()) ||
    undefined;
  const repoUrl =
    typeof pkg.links?.repository === 'string' && pkg.links.repository.startsWith('https://')
      ? pkg.links.repository
      : undefined;
  const docUrl =
    typeof pkg.links?.homepage === 'string' && pkg.links.homepage.startsWith('https://')
      ? pkg.links.homepage
      : typeof pkg.links?.npm === 'string' && pkg.links.npm.startsWith('https://')
        ? pkg.links.npm
        : undefined;

  const officialScope =
    pkgName.startsWith('@scrypted/') || pkgName.startsWith('@homebridge-plugins/');
  const verified =
    runtime === 'scrypted' ? pkgName.startsWith('@scrypted/') : verifiedSet.has(pkgName);
  const displayName = formatPluginDisplayName(runtime, pkgName);
  const { vendorId, vendorName } = resolvePluginVendor(pkgName, displayName);
  const { trustScore, stabilityTier } = computePluginTrustAndStability({
    verified,
    featured: verified,
    officialScope,
    score: obj.score,
  });

  return {
    id: ecosystemAppId(runtime, pkgName),
    packageName: pkgName,
    displayName,
    runtimeType: runtime,
    version,
    description,
    category: classifyPluginCategory(runtime, pkgName, description, keywords),
    author,
    repositoryUrl: repoUrl,
    documentationUrl: docUrl,
    verified,
    featured: verified,
    trustScore,
    stabilityTier,
    vendorId,
    vendorName,
    keywords,
  };
}
