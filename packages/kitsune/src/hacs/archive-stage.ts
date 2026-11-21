/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archivePath, tarFiles, writeArchive, zipFiles } from '../runtime/archives.js';
import {
  evaluateHacsCompatibility,
  KNOWN_HACS_REPOS,
  type HacsCompatibilityStatus,
} from './update-types.js';

const MAX_HACS_DOWNLOAD_BYTES = 128 * 1024 * 1024;

export interface HacsInstallReceipt {
  readonly repository: string;
  readonly repositoryId: string;
  readonly domain: string;
  readonly version: string;
  readonly downloadedVersion?: string;
  readonly pendingRestart?: boolean;
  readonly commitOrDigest?: string;
  readonly installedAt: string;
  readonly operationId: string;
}

export interface InstalledCustomComponentInfo {
  readonly domain: string;
  readonly name: string;
  readonly version: string;
  readonly repository?: string;
  readonly documentation?: string;
  readonly configFlow: boolean;
  readonly requirements: readonly string[];
  readonly dependencies: readonly string[];
  readonly manifest: Record<string, unknown>;
  readonly receipt?: HacsInstallReceipt;
}

export async function downloadHacsArchive(input: {
  readonly url: string;
  readonly fetchFn: typeof fetch;
  readonly expectedDigest?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (bytesReceived: number, totalBytes?: number) => void;
}): Promise<{ readonly bytes: Buffer; readonly digest: string; readonly totalBytes?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await input.fetchFn(input.url, {
      headers: {
        Accept: 'application/octet-stream, application/zip, application/gzip, */*',
        'User-Agent': 'Haus-Hub',
      },
      signal: controller.signal,
    });
    if (res.status === 403 || res.status === 429) {
      throw new Error('github_rate_limited');
    }
    if (!res.ok) {
      throw new Error(`hacs_download_failed:${res.status}`);
    }

    const rawLength = res.headers.get('content-length');
    const parsedLength = rawLength ? Number.parseInt(rawLength, 10) : Number.NaN;
    const totalBytes = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : undefined;

    const chunks: Buffer[] = [];
    let bytesReceived = 0;

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      while (true) {
        input.signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          bytesReceived += value.byteLength;
          if (bytesReceived > MAX_HACS_DOWNLOAD_BYTES) {
            throw new Error('kitsune_download_limit');
          }
          chunks.push(Buffer.from(value));
          input.onProgress?.(bytesReceived, totalBytes);
        }
      }
    } else {
      const arrayBuf = await res.arrayBuffer();
      bytesReceived = arrayBuf.byteLength;
      if (bytesReceived > MAX_HACS_DOWNLOAD_BYTES) {
        throw new Error('kitsune_download_limit');
      }
      chunks.push(Buffer.from(arrayBuf));
      input.onProgress?.(bytesReceived, totalBytes);
    }

    const bytes = Buffer.concat(chunks);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (
      input.expectedDigest &&
      input.expectedDigest.trim() &&
      input.expectedDigest.trim().toLowerCase() !== digest.toLowerCase()
    ) {
      throw new Error('artifact_integrity_failed');
    }
    return { bytes, digest, totalBytes };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

function parseArchiveFiles(bytes: Buffer): Promise<Map<string, Buffer>> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip) {
    return tarFiles(bytes);
  }
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;
  if (isZip) {
    return Promise.resolve(zipFiles(bytes));
  }
  // Try zip first, then tar.gz fallback for custom mock fixtures
  try {
    return Promise.resolve(zipFiles(bytes));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('kitsune_')) throw err;
    return tarFiles(bytes);
  }
}

export async function extractAndStageHacsComponent(input: {
  readonly bytes: Buffer;
  readonly expectedDomain: string;
  readonly fallbackVersion: string;
  readonly stageDir: string;
  readonly runtimeHaVersion?: string;
}): Promise<{
  readonly manifest: Record<string, unknown>;
  readonly hacsJson?: Record<string, unknown>;
  readonly version: string;
  readonly requirements: readonly string[];
  readonly compatibility: {
    readonly status: HacsCompatibilityStatus;
    readonly reason?: string;
    readonly minHaVersion?: string;
  };
}> {
  const files = await parseArchiveFiles(input.bytes);
  if (files.size === 0) {
    throw new Error('hacs_empty_archive');
  }

  let hacsJson: Record<string, unknown> | undefined;
  for (const [rawPath, buf] of files) {
    const clean = archivePath(rawPath);
    const parts = clean.split('/');
    if (clean === 'hacs.json' || (parts.length === 2 && parts[1] === 'hacs.json')) {
      try {
        const parsed = JSON.parse(buf.toString('utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          hacsJson = parsed as Record<string, unknown>;
        }
      } catch {
        throw new Error('hacs_invalid_metadata_json');
      }
    }
  }

  // Locate component manifest.json across standard HACS archive layouts
  let selectedPrefix: string | undefined;
  let manifestObj: Record<string, unknown> | undefined;
  const discoveredDomains: string[] = [];

  for (const [rawPath, buf] of files) {
    const clean = archivePath(rawPath);
    if (!clean.endsWith('/manifest.json') && clean !== 'manifest.json') continue;
    const prefix = clean === 'manifest.json' ? '' : clean.slice(0, -'manifest.json'.length);
    const segments = prefix.split('/').filter(Boolean);
    const isCustomComponentsLayout =
      (segments.length === 2 && segments[0] === 'custom_components') ||
      (segments.length === 3 && segments[1] === 'custom_components');
    const isRootLayout = segments.length <= 1;
    if (!isCustomComponentsLayout && !isRootLayout) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('hacs_invalid_manifest_json');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const candidate = parsed as Record<string, unknown>;
    const domain = typeof candidate.domain === 'string' ? candidate.domain.trim() : '';
    if (!domain) continue;
    discoveredDomains.push(domain);

    const dirDomain = isCustomComponentsLayout ? segments[segments.length - 1] : domain;
    if (domain === input.expectedDomain && dirDomain === input.expectedDomain) {
      selectedPrefix = prefix;
      manifestObj = candidate;
      break;
    }
  }

  if (!manifestObj || selectedPrefix === undefined) {
    if (discoveredDomains.length > 0) {
      throw new Error(`unexpected_component_domain:${discoveredDomains.join(',')}`);
    }
    throw new Error('hacs_manifest_missing');
  }

  const compatibility = evaluateHacsCompatibility({
    category: 'integration',
    hacsJson,
    manifest: manifestObj,
    runtimeHaVersion: input.runtimeHaVersion,
  });
  if (compatibility.status === 'incompatible') {
    throw new Error(`incompatible_ha_version:${compatibility.reason ?? 'incompatible'}`);
  }

  const componentFiles = new Map<string, Buffer>();
  for (const [rawPath, buf] of files) {
    const clean = archivePath(rawPath);
    if (selectedPrefix && !clean.startsWith(selectedPrefix)) continue;
    const rel = clean.slice(selectedPrefix.length);
    if (!rel || rel === 'hacs.json') continue;
    archivePath(rel);
    componentFiles.set(rel, buf);
  }

  await mkdir(input.stageDir, { recursive: true, mode: 0o700 });
  await writeArchive(input.stageDir, componentFiles);

  const version =
    typeof manifestObj.version === 'string' && manifestObj.version.trim()
      ? manifestObj.version.trim()
      : input.fallbackVersion;
  const requirements = Array.isArray(manifestObj.requirements)
    ? manifestObj.requirements.filter(
        (r): r is string => typeof r === 'string' && r.trim().length > 0,
      )
    : [];

  return {
    manifest: manifestObj,
    hacsJson,
    version,
    requirements,
    compatibility,
  };
}

function extractGitHubRepoFromUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  const match =
    /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git|\/.*|#.*|\?.*)?$/.exec(
      url.trim(),
    );
  return match?.[1];
}

export async function scanInstalledCustomComponents(
  customComponentsDir: string,
): Promise<Map<string, InstalledCustomComponentInfo>> {
  const out = new Map<string, InstalledCustomComponentInfo>();
  let entries: string[] = [];
  try {
    entries = await readdir(customComponentsDir);
  } catch {
    return out;
  }

  for (const dir of entries.slice(0, 256)) {
    if (dir.startsWith('.') || dir === '__pycache__') continue;
    const compDir = join(customComponentsDir, dir);
    try {
      const rawManifest = await readFile(join(compDir, 'manifest.json'), 'utf8');
      const manifest = JSON.parse(rawManifest) as Record<string, unknown>;
      const domain = typeof manifest.domain === 'string' ? manifest.domain.trim() : dir;
      let receipt: HacsInstallReceipt | undefined;
      try {
        const rawReceipt = await readFile(join(compDir, '.haus-hacs.json'), 'utf8');
        const parsedReceipt = JSON.parse(rawReceipt) as Partial<HacsInstallReceipt>;
        if (typeof parsedReceipt.domain === 'string' && typeof parsedReceipt.version === 'string') {
          receipt = parsedReceipt as HacsInstallReceipt;
        }
      } catch {
        // Optional receipt
      }

      const known = KNOWN_HACS_REPOS[domain];
      const repository =
        receipt?.repository ??
        known?.repo ??
        extractGitHubRepoFromUrl(manifest.documentation) ??
        extractGitHubRepoFromUrl(manifest.issue_tracker);
      const version =
        (typeof manifest.version === 'string' && manifest.version.trim()) ||
        receipt?.version ||
        '0.0.0';
      const name =
        (typeof manifest.name === 'string' && manifest.name.trim()) || known?.title || domain;
      const requirements = Array.isArray(manifest.requirements)
        ? manifest.requirements.filter((r): r is string => typeof r === 'string')
        : [];
      const dependencies = Array.isArray(manifest.dependencies)
        ? manifest.dependencies.filter((d): d is string => typeof d === 'string')
        : [];

      out.set(domain, {
        domain,
        name,
        version,
        repository,
        documentation:
          typeof manifest.documentation === 'string' ? manifest.documentation : undefined,
        configFlow: manifest.config_flow === true,
        requirements,
        dependencies,
        manifest,
        receipt,
      });
    } catch {
      // Ignore directories without a valid manifest.json
    }
  }
  return out;
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeAtomicJson(
  storageDir: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const tmp = join(storageDir, `.${fileName}-${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, join(storageDir, fileName));
}

export async function swapStagedComponent(params: {
  readonly customComponentsDir: string;
  readonly backupRoot: string;
  readonly stageDir: string;
  readonly targetDir: string;
  readonly backupDir: string;
  readonly receipt: HacsInstallReceipt;
}): Promise<{ readonly backupCreated: boolean }> {
  const { customComponentsDir, backupRoot, stageDir, targetDir, backupDir, receipt } = params;
  await mkdir(customComponentsDir, { recursive: true, mode: 0o700 });
  let backupCreated = false;
  try {
    if ((await stat(targetDir)).isDirectory()) {
      await mkdir(backupRoot, { recursive: true, mode: 0o700 });
      await rm(backupDir, { recursive: true, force: true });
      await cp(targetDir, backupDir, { recursive: true });
      backupCreated = true;
    }
  } catch {
    // Target did not exist prior to swap
  }
  await rm(targetDir, { recursive: true, force: true });
  await cp(stageDir, targetDir, { recursive: true });
  await writeFile(join(targetDir, '.haus-hacs.json'), JSON.stringify(receipt, null, 2), {
    mode: 0o600,
  });
  return { backupCreated };
}

export async function rollbackComponentSwap(params: {
  readonly targetDir: string;
  readonly backupDir: string;
  readonly backupCreated?: boolean;
}): Promise<boolean> {
  const { targetDir, backupDir, backupCreated } = params;
  const hasBackup =
    backupCreated ??
    (await stat(backupDir)
      .then((s) => s.isDirectory())
      .catch(() => false));
  await rm(targetDir, { recursive: true, force: true });
  if (hasBackup) {
    await cp(backupDir, targetDir, { recursive: true });
    await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }
  return backupCreated === false;
}
