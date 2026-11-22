/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ICON_CACHE_FORMAT, ICON_ENGINE_REVISION } from '../appearance.js';

export interface CachedSourceMeta {
  readonly key: string;
  readonly sourceHash: string;
  readonly mime: string;
  readonly isFallback: boolean;
  readonly fetchedAt: number;
}

export interface RenderedBaseManifest {
  readonly version: string;
  readonly format: number;
  readonly revision: string;
  readonly sourceHash: string;
  readonly size: number;
  readonly bodySize: number;
  readonly tileFraction: number;
  readonly layout: 'fill' | 'inset';
  readonly segmented: boolean;
  readonly branch: string | null;
  readonly engine: 'cpp' | 'ts';
  readonly milliseconds: number;
  readonly defaultPath: string;
  readonly darkPath: string;
  readonly clearPath: string;
  readonly tintedPath: string;
}

export interface IndexEntry {
  readonly sourceHash: string;
  readonly isFallback: boolean;
  readonly mime: string;
  readonly layout: 'fill' | 'inset';
  readonly size: number;
  readonly bodySize: number;
  readonly tileFraction: number;
  readonly updatedAt: number;
}

export interface IconCacheIndexFile {
  readonly format: number;
  readonly revision: string;
  readonly entries: Record<string, IndexEntry>;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

async function atomicWriteFile(filePath: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.next`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
}

/**
 * 1:1 port of GNOME's content-versioned icon cache namespace (`icon-generation-cache.js`):
 * - Creates `<cacheRoot>/v<format>-<revision>/` with `cache-format.json`.
 * - Keeps ONE prior `v<format>-<old-revision>` generation for rollback.
 * - Removes older obsolete version directories automatically.
 * - Keeps raw downloaded sources in `<cacheRoot>/sources/` so algorithm revision bumps
 *   re-render offline without re-fetching 1,300+ upstream icons.
 */
export class VersionedIconCache {
  readonly format: number;
  readonly revision: string;
  readonly version: string;
  readonly cacheRoot: string;
  readonly sourcesDir: string;
  readonly namespaceDir: string;
  readonly indexPath: string;

  private readonly index = new Map<string, IndexEntry>();
  private indexLoaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    cacheRoot: string,
    {
      format = ICON_CACHE_FORMAT,
      revision = ICON_ENGINE_REVISION,
    }: { readonly format?: number; readonly revision?: string } = {},
  ) {
    this.format = format;
    this.revision = revision;
    this.version = `v${format}-${revision}`;
    this.cacheRoot = cacheRoot;
    this.sourcesDir = join(cacheRoot, 'sources');
    this.namespaceDir = join(cacheRoot, this.version);
    this.indexPath = join(cacheRoot, `index-${this.version}.json`);
    this.ensureNamespace();
  }

  private ensureNamespace(): void {
    mkdirSync(this.sourcesDir, { recursive: true, mode: 0o750 });
    mkdirSync(this.namespaceDir, { recursive: true, mode: 0o750 });
    const markerPath = join(this.namespaceDir, 'cache-format.json');
    if (existsSync(markerPath)) return;

    // Prune older generations while retaining the 1 most recent prior generation for rollback.
    const versions: Array<{ name: string; mtimeMs: number }> = [];
    try {
      for (const entry of readdirSync(this.cacheRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === this.version || entry.name === 'sources') continue;
        const fullPath = join(this.cacheRoot, entry.name);
        if (/^[0-9a-f]{64}$/.test(entry.name)) {
          rmSync(fullPath, { recursive: true, force: true });
        } else if (/^v[0-9]+-[a-z0-9-]+$/i.test(entry.name)) {
          try {
            versions.push({ name: entry.name, mtimeMs: statSync(fullPath).mtimeMs });
          } catch {
            // ignore vanished entry
          }
        }
      }
    } catch {
      // ignore read errors on fresh directory
    }

    versions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const obsolete of versions.slice(1)) {
      rmSync(join(this.cacheRoot, obsolete.name), { recursive: true, force: true });
    }

    // Prune obsolete index files keeping current + newest prior index.
    const keepIndexes = new Set([`index-${this.version}.json`]);
    if (versions[0]) keepIndexes.add(`index-${versions[0].name}.json`);
    try {
      for (const entry of readdirSync(this.cacheRoot, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          /^index-v[0-9]+-[a-z0-9-]+\.json$/i.test(entry.name) &&
          !keepIndexes.has(entry.name)
        ) {
          rmSync(join(this.cacheRoot, entry.name), { force: true });
        }
      }
    } catch {
      // ignore
    }

    void writeFile(
      markerPath,
      JSON.stringify({ format: this.format, revision: this.revision, createdAt: Date.now() }),
    ).catch(() => undefined);
  }

  async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<IconCacheIndexFile>;
      if (
        parsed.revision === this.revision &&
        parsed.entries &&
        typeof parsed.entries === 'object'
      ) {
        for (const [key, entry] of Object.entries(parsed.entries)) {
          if (entry && typeof entry.sourceHash === 'string') {
            this.index.set(key, entry);
          }
        }
      }
    } catch {
      // Fresh revision or interrupted index — per-source manifests remain intact on disk.
    }
  }

  getIndexSize(): number {
    return this.index.size;
  }

  getIndexEntry(requestKey: string): IndexEntry | undefined {
    return this.index.get(requestKey);
  }

  setIndexEntry(requestKey: string, entry: IndexEntry): void {
    this.index.set(requestKey, entry);
    this.scheduleIndexFlush();
  }

  private scheduleIndexFlush(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushIndex().catch(() => undefined);
    }, 1_500);
    this.saveTimer.unref();
  }

  async flushIndex(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const payload: IconCacheIndexFile = {
      format: this.format,
      revision: this.revision,
      entries: Object.fromEntries(this.index),
    };
    await atomicWriteFile(this.indexPath, JSON.stringify(payload));
  }

  private sourceFilePaths(requestKey: string): { binPath: string; metaPath: string } {
    const keyHash = sha256Hex(requestKey);
    return {
      binPath: join(this.sourcesDir, `${keyHash}.bin`),
      metaPath: join(this.sourcesDir, `${keyHash}.meta.json`),
    };
  }

  async readRawSource(
    requestKey: string,
    { maxAgeMs = 7 * 24 * 60 * 60_000, fallbackMaxAgeMs = 15 * 60_000 } = {},
  ): Promise<{ bytes: Buffer; meta: CachedSourceMeta } | null> {
    const { binPath, metaPath } = this.sourceFilePaths(requestKey);
    try {
      const [metaRaw, bytes] = await Promise.all([readFile(metaPath, 'utf8'), readFile(binPath)]);
      const meta = JSON.parse(metaRaw) as CachedSourceMeta;
      const age = Date.now() - (meta.fetchedAt ?? 0);
      const ttl = meta.isFallback ? fallbackMaxAgeMs : maxAgeMs;
      if (age > ttl || bytes.length === 0) return null;
      return { bytes, meta };
    } catch {
      return null;
    }
  }

  async writeRawSource(
    requestKey: string,
    bytes: Buffer,
    mime: string,
    isFallback: boolean,
  ): Promise<CachedSourceMeta> {
    const { binPath, metaPath } = this.sourceFilePaths(requestKey);
    const sourceHash = sha256Hex(Buffer.concat([Buffer.from(`${this.version}:${mime}:`), bytes]));
    const meta: CachedSourceMeta = {
      key: requestKey,
      sourceHash,
      mime,
      isFallback,
      fetchedAt: Date.now(),
    };
    await Promise.all([
      atomicWriteFile(binPath, bytes),
      atomicWriteFile(metaPath, JSON.stringify(meta)),
    ]);
    return meta;
  }

  manifestDirFor(sourceHash: string): string {
    return join(this.namespaceDir, sourceHash);
  }

  manifestFilesExist(manifest: RenderedBaseManifest | null | undefined): boolean {
    if (!manifest) return false;
    return [manifest.defaultPath, manifest.darkPath, manifest.clearPath, manifest.tintedPath].every(
      (filePath) => typeof filePath === 'string' && existsSync(filePath),
    );
  }

  async readRenderedManifest(sourceHash: string): Promise<RenderedBaseManifest | null> {
    const manifestPath = join(this.manifestDirFor(sourceHash), 'layers.json');
    try {
      const raw = await readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as RenderedBaseManifest;
      if (parsed.revision !== this.revision || parsed.format !== this.format) return null;
      if (!this.manifestFilesExist(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async writeRenderedBaseLayers(
    sourceHash: string,
    layers: {
      readonly size: number;
      readonly bodySize: number;
      readonly tileFraction: number;
      readonly layout: 'fill' | 'inset';
      readonly segmented: boolean;
      readonly branch: string | null;
      readonly engine: 'cpp' | 'ts';
      readonly milliseconds: number;
      readonly defaultPng: Buffer;
      readonly darkPng: Buffer;
      readonly clearSemanticPng: Buffer;
      readonly tintedSemanticPng: Buffer;
    },
  ): Promise<RenderedBaseManifest> {
    const dir = this.manifestDirFor(sourceHash);
    const defaultPath = join(dir, 'default.png');
    const darkPath = join(dir, 'dark.png');
    const clearPath = join(dir, 'clear.png');
    const tintedPath = join(dir, 'tinted.png');

    await Promise.all([
      atomicWriteFile(defaultPath, layers.defaultPng),
      atomicWriteFile(darkPath, layers.darkPng),
      atomicWriteFile(clearPath, layers.clearSemanticPng),
      atomicWriteFile(tintedPath, layers.tintedSemanticPng),
    ]);

    const manifest: RenderedBaseManifest = {
      version: this.version,
      format: this.format,
      revision: this.revision,
      sourceHash,
      size: layers.size,
      bodySize: layers.bodySize,
      tileFraction: layers.tileFraction,
      layout: layers.layout,
      segmented: layers.segmented,
      branch: layers.branch,
      engine: layers.engine,
      milliseconds: layers.milliseconds,
      defaultPath,
      darkPath,
      clearPath,
      tintedPath,
    };
    await atomicWriteFile(join(dir, 'layers.json'), JSON.stringify(manifest));
    return manifest;
  }
}
