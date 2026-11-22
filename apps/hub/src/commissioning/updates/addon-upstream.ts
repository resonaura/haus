/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMutableImageTag,
  resolveImageArchTemplate,
  validateAppManifest,
  type AppCatalog,
  type AppCatalogEntry,
  type AppManifest,
} from '@haus/apps';
import { compareHacsVersions } from '@haus/kitsune';
import type { StandaloneHomeService } from '../../home/home.service.js';
import {
  checkRemoteImageExists,
  checkRemoteImageUpdate,
  parseOciImageReference,
} from '../registry-digest.js';
import type { UnifiedUpdateItem, UpdateCategory } from '../updates.js';

const GITHUB_REPO_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const SAFE_CONFIG_PATH_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const FETCH_TIMEOUT_MS = 2_500;
const MAX_CONFIG_BYTES = 32_768;

export interface ParsedAddonConfig {
  readonly version: string;
  readonly image?: string;
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  const doubleQuoted = /^"([^"]*)"(?:\s+#.*)?$/.exec(trimmed);
  if (doubleQuoted) return doubleQuoted[1]!.trim();
  const singleQuoted = /^'([^']*)'(?:\s+#.*)?$/.exec(trimmed);
  if (singleQuoted) return singleQuoted[1]!.trim();
  const commentIdx = trimmed.indexOf(' #');
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
}

/** Extracts top-level `version` and optional `image` from a Home Assistant add-on `config.yaml`. */
export function parseAddonConfigYaml(yaml: string): ParsedAddonConfig | undefined {
  let version: string | undefined;
  let image: string | undefined;
  for (const line of yaml.split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = unquoteYamlScalar(match[2]!);
    if (!value) continue;
    if (key === 'version') version = value;
    else if (key === 'image') image = value;
  }
  if (!version || version.length > 64 || !/^[A-Za-z0-9._+-]+$/.test(version)) return undefined;
  return { version, ...(image ? { image } : {}) };
}

function resolveRawConfigUrl(repositoryUrl?: string, addonConfigPath?: string): string | undefined {
  if (!repositoryUrl || !addonConfigPath) return undefined;
  const repoMatch = GITHUB_REPO_RE.exec(repositoryUrl.trim());
  if (!repoMatch) return undefined;
  const cleanPath = addonConfigPath.trim().replace(/^\/+/, '');
  if (!SAFE_CONFIG_PATH_RE.test(cleanPath) || cleanPath.split('/').includes('..')) {
    return undefined;
  }
  return `https://raw.githubusercontent.com/${repoMatch[1]}/${repoMatch[2]}/main/${cleanPath}`;
}

function ensureTaggedImage(imageRef: string, version: string): string {
  if (imageRef.includes('@sha256:')) return imageRef;
  const lastSlash = imageRef.lastIndexOf('/');
  const tail = lastSlash >= 0 ? imageRef.slice(lastSlash + 1) : imageRef;
  return tail.includes(':') ? imageRef : `${imageRef}:${version}`;
}

function matchesTrustedRepository(baselineImage: string, candidateImage: string): boolean {
  const baseParsed = parseOciImageReference(baselineImage);
  const candParsed = parseOciImageReference(candidateImage);
  if (!baseParsed || !candParsed) return false;
  return (
    baseParsed.registry === candParsed.registry && baseParsed.repository === candParsed.repository
  );
}

/**
 * Checks an add-on's trusted GitHub `config.yaml` and registers any newer published version
 * onto `AppCatalog`, enforcing repository pinning and manifest validation.
 */
export async function syncUpstreamAddonCatalogVersion(
  entry: AppCatalogEntry | undefined,
  catalog: AppCatalog | undefined,
  fetchImpl: typeof fetch = fetch,
  options: {
    readonly architecture?: string;
    readonly verifyImagePublished?: boolean;
  } = {},
): Promise<{ readonly version: string; readonly image: string } | undefined> {
  if (!entry || !catalog || !entry.addonConfigPath) return undefined;
  const rawUrl = resolveRawConfigUrl(entry.repositoryUrl, entry.addonConfigPath);
  if (!rawUrl) return undefined;

  let text: string;
  try {
    const res = await fetchImpl(rawUrl, {
      headers: { Accept: 'text/plain', 'User-Agent': 'Haus-Hub' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    text = await res.text();
    if (text.length > MAX_CONFIG_BYTES) return undefined;
  } catch {
    return undefined;
  }

  const parsed = parseAddonConfigYaml(text);
  if (!parsed) return undefined;

  const arch = options.architecture ?? process.arch;
  const baselineImage = resolveImageArchTemplate(entry.manifest.image, arch);
  const rawCandidate = parsed.image
    ? resolveImageArchTemplate(parsed.image, arch)
    : baselineImage.replace(/:[^/:]+$/, '');
  const resolvedImage = ensureTaggedImage(rawCandidate, parsed.version);

  if (!matchesTrustedRepository(baselineImage, resolvedImage)) {
    return undefined;
  }

  const candidateManifest: AppManifest = {
    ...entry.manifest,
    version: parsed.version,
    image: resolvedImage,
  };
  const validation = validateAppManifest(candidateManifest);
  if (!validation.valid || !validation.manifest) return undefined;

  if (options.verifyImagePublished !== false) {
    const availability = await checkRemoteImageExists(resolvedImage, fetchImpl);
    if (availability === 'missing') return undefined;
  }

  catalog.registerUpstreamVersion(entry.manifest.id, {
    version: parsed.version,
    manifest: validation.manifest,
    releaseNotes: `Upstream release ${parsed.version} from ${entry.repositoryUrl}`,
  });

  return { version: parsed.version, image: resolvedImage };
}

/** Collects update status items for all installed Haus apps/add-ons in parallel. */
export async function collectInstalledAppUpdates(params: {
  readonly homeService: StandaloneHomeService;
  readonly fetchImpl: typeof fetch;
  readonly installing: ReadonlySet<string>;
  readonly checkedAt: string;
}): Promise<UnifiedUpdateItem[]> {
  const inventory = await params.homeService.listApps('hub');
  return Promise.all(
    inventory.apps.map(async (app): Promise<UnifiedUpdateItem> => {
      const appId = app.source.externalId;
      if (typeof params.homeService.inspectApp === 'function') {
        await params.homeService.inspectApp('hub', app.id).catch(() => undefined);
      }
      const catalogEntry = params.homeService.getAppCatalogEntry(appId);
      await syncUpstreamAddonCatalogVersion(
        catalogEntry,
        params.homeService.appManager?.catalog,
        params.fetchImpl,
      );
      const check = params.homeService.checkAppUpdate(appId);
      let updateAvailable = check.updateAvailable;
      let latestVersion = check.latestVersion ?? check.currentVersion;
      let releaseSummary = check.releaseNotes;
      const rawImageRef = catalogEntry?.manifest.image ?? app.image;
      const imageRef = rawImageRef ? resolveImageArchTemplate(rawImageRef) : undefined;
      if (!updateAvailable && imageRef && isMutableImageTag(imageRef)) {
        const installedImage = params.homeService.appManager?.getAppImage?.(appId);
        const digestCheck = await checkRemoteImageUpdate(
          imageRef,
          installedImage?.digest ?? installedImage?.imageId,
          params.fetchImpl,
        );
        if (digestCheck.updateAvailable && digestCheck.remoteDigest) {
          updateAvailable = true;
          latestVersion = `${check.currentVersion} (${digestCheck.remoteDigest.slice(7, 15)})`;
          releaseSummary = 'Newer :latest container image available from registry';
        }
      }
      const category: UpdateCategory =
        catalogEntry?.runtimeType === 'homebridge'
          ? 'homebridge'
          : catalogEntry?.runtimeType === 'hacs'
            ? 'hacs'
            : catalogEntry?.runtimeType === 'scrypted'
              ? 'scrypted'
              : 'addon';
      const id = `app:${appId}`;
      return {
        id,
        domain: appId,
        title: app.name,
        category,
        installedVersion: check.currentVersion,
        latestVersion,
        updateAvailable,
        canInstall: updateAvailable,
        inProgress: params.installing.has(id),
        releaseUrl: catalogEntry?.documentationUrl ?? catalogEntry?.repositoryUrl,
        releaseSummary,
        checkedAt: params.checkedAt,
      };
    }),
  );
}

/** Collects update status items for installed Kitsune npm plugins in parallel. */
export async function collectInstalledNpmPluginUpdates(params: {
  readonly dataDir: string;
  readonly fetchJson: (url: string) => Promise<Record<string, unknown> | undefined>;
  readonly installing: ReadonlySet<string>;
  readonly checkedAt: string;
}): Promise<UnifiedUpdateItem[]> {
  const root = join(params.dataDir, 'kitsune', 'plugins');
  const receipts: Array<{ readonly name: string; readonly version: string }> = [];
  try {
    const dirs = await readdir(root);
    for (const dir of dirs.slice(0, 256)) {
      try {
        const raw = await readFile(join(root, dir, 'kitsune-receipt.json'), 'utf8');
        const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
        if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
          receipts.push({ name: parsed.name, version: parsed.version });
        }
      } catch {
        // ignore non-receipt entry
      }
    }
  } catch {
    return [];
  }

  return Promise.all(
    receipts.map(async (receipt): Promise<UnifiedUpdateItem> => {
      const encoded = encodeURIComponent(receipt.name).replace('%40', '@');
      const npmMeta = await params.fetchJson(`https://registry.npmjs.org/${encoded}/latest`);
      const latestVersion =
        typeof npmMeta?.version === 'string' ? npmMeta.version : receipt.version;
      const updateAvailable = compareHacsVersions(receipt.version, latestVersion) < 0;
      const category: UpdateCategory = receipt.name.startsWith('@scrypted/')
        ? 'scrypted'
        : receipt.name.includes('homebridge')
          ? 'homebridge'
          : 'plugin';
      const id = `npm:${receipt.name}`;
      return {
        id,
        domain: receipt.name,
        title: receipt.name,
        category,
        installedVersion: receipt.version,
        latestVersion,
        updateAvailable,
        canInstall: updateAvailable,
        inProgress: params.installing.has(id),
        releaseUrl: `https://www.npmjs.com/package/${receipt.name}`,
        checkedAt: params.checkedAt,
      };
    }),
  );
}
