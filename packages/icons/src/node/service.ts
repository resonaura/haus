/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile } from 'node:fs/promises';
import {
  resolveEffectiveColorPresentation,
  type IconAppearance,
  type ResolvedIconVariation,
} from '../appearance.js';
import { VersionedIconCache, type RenderedBaseManifest } from './cache.js';
import { NativeIconWorkerPool } from './cpp-worker.js';
import { decodeSourceToPremulRgba, disposeRasterDecoder, parseImageDataUri } from './decode.js';
import { decodePngRgba, encodePngRgba } from './png.js';

const FAILURE_BACKOFF_MS = 5 * 60_000; // 5 minutes (1:1 GNOME icon-render-service.js)

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface IconSourceJob {
  readonly key: string;
  readonly label?: string;
  readonly fetchSource: () => Promise<{ dataUri: string | null; isFallback: boolean }>;
}

export interface RenderedTileResult {
  readonly png: Buffer | null;
  readonly dataUri: string | null;
  readonly rendered: boolean;
  readonly layout: 'fill' | 'inset';
  readonly revision: string;
  readonly cacheHit: boolean;
  readonly engine: 'cpp' | 'ts' | 'passthrough';
}

export interface IconRenderServiceStatus {
  readonly format: number;
  readonly revision: string;
  readonly version: string;
  readonly engine: 'cpp' | 'ts';
  readonly inventory: number;
  readonly planned: number;
  readonly ready: number;
  readonly completed: number;
  readonly generated: number;
  readonly queued: number;
  readonly active: number;
  readonly failures: number;
  readonly lastError: { readonly key: string; readonly message: string } | null;
}

interface QueuedBaseJob {
  readonly job: IconSourceJob;
  readonly urgent: boolean;
  readonly waiters: Array<{
    resolve: (value: PreparedBaseResult | null) => void;
    reject: (err: Error) => void;
  }>;
}

interface PreparedBaseResult {
  readonly manifest: RenderedBaseManifest | null;
  readonly passthroughDataUri: string | null;
  readonly cacheHit: boolean;
}

/**
 * 1:1 GNOME-inspired icon render service (`icon-render-service.js`):
 * - Priority `urgent` queue (live UI requests) preempts `background` pre-generation.
 * - Deduplicates in-flight requests and applies 5-minute backoff to background failures.
 * - Bounded concurrent source fetching + native C++20 worker pool rendering.
 * - Caches all 4 base layers (`default`, `dark`, `clear`, `tinted`) in a versioned
 *   namespace so Clear Light/Dark and all 9 Tinted colors composite instantaneously (<1ms).
 */
export class IconRenderService {
  readonly cache: VersionedIconCache;
  readonly worker: NativeIconWorkerPool;

  private readonly tileSize: number;
  private readonly maxConcurrency: number;
  private readonly jobs = new Map<string, QueuedBaseJob>();
  private readonly urgentQueue: QueuedBaseJob[] = [];
  private readonly backgroundQueue: QueuedBaseJob[] = [];
  private readonly failures = new Map<string, number>();
  private readonly composedLru = new Map<
    string,
    { png: Buffer; dataUri: string; layout: 'fill' | 'inset' }
  >();
  private readonly composedMaxEntries = 800;

  private activeCount = 0;
  private inventory = 0;
  private planned = 0;
  private completed = 0;
  private generated = 0;
  private lastError: { readonly key: string; readonly message: string } | null = null;
  private disposed = false;

  constructor(options: {
    readonly cacheRoot: string;
    readonly revision?: string;
    readonly tileSize?: number;
    readonly concurrency?: number;
    readonly workerThreads?: number;
    readonly workerBinaryPath?: string;
    readonly allowCpp?: boolean;
  }) {
    this.cache = new VersionedIconCache(options.cacheRoot, {
      revision: options.revision,
    });
    this.worker = new NativeIconWorkerPool({
      binaryPath: options.workerBinaryPath,
      threads: options.workerThreads ?? Math.min(4, Math.max(2, options.concurrency ?? 4)),
      allowCpp: options.allowCpp,
    });
    this.tileSize = options.tileSize ?? 256;
    this.maxConcurrency = Math.max(1, Math.min(12, options.concurrency ?? 6));
  }

  async init(): Promise<void> {
    await this.cache.loadIndex();
  }

  getStatus(): IconRenderServiceStatus {
    return {
      format: this.cache.format,
      revision: this.cache.revision,
      version: this.cache.version,
      engine: this.worker.activeEngine,
      inventory: this.inventory,
      planned: this.planned,
      ready: this.cache.getIndexSize(),
      completed: this.completed,
      generated: this.generated,
      queued: Math.max(0, this.jobs.size - this.activeCount),
      active: this.activeCount,
      failures: this.failures.size,
      lastError: this.lastError,
    };
  }

  /** Queues a prioritized inventory of icons for non-blocking background pre-generation. */
  enqueueBackground(items: readonly IconSourceJob[]): number {
    if (this.disposed) return 0;
    const now = Date.now();
    for (const [key, failedAt] of this.failures) {
      if (now - failedAt > FAILURE_BACKOFF_MS) this.failures.delete(key);
    }

    this.inventory = Math.max(this.inventory, items.length);
    this.planned = this.inventory * 4;

    let added = 0;
    for (const item of items) {
      if (this.jobs.has(item.key) || this.failures.has(item.key)) continue;
      const indexed = this.cache.getIndexEntry(item.key);
      if (indexed && !indexed.isFallback) {
        const dir = this.cache.manifestDirFor(indexed.sourceHash);
        if (
          this.cache.manifestFilesExist({
            version: this.cache.version,
            format: this.cache.format,
            revision: this.cache.revision,
            sourceHash: indexed.sourceHash,
            size: indexed.size,
            bodySize: indexed.bodySize,
            tileFraction: indexed.tileFraction,
            layout: indexed.layout,
            segmented: false,
            branch: null,
            engine: this.worker.activeEngine,
            milliseconds: 0,
            defaultPath: `${dir}/default.png`,
            darkPath: `${dir}/dark.png`,
            clearPath: `${dir}/clear.png`,
            tintedPath: `${dir}/tinted.png`,
          })
        ) {
          continue;
        }
      }
      const entry: QueuedBaseJob = { job: item, urgent: false, waiters: [] };
      this.jobs.set(item.key, entry);
      this.backgroundQueue.push(entry);
      added += 1;
    }

    this.pump();
    return added;
  }

  /**
   * Resolves a fully rendered, continuous-corner, 1:1 GNOME tile PNG for any
   * `(appearance, variation, tintHex)`. Interactive calls use the `urgent` queue.
   */
  async resolveTile(options: {
    readonly source: IconSourceJob;
    readonly appearance: IconAppearance;
    readonly variation: ResolvedIconVariation;
    readonly tintHex: string;
    readonly displaySize?: number;
  }): Promise<RenderedTileResult> {
    await this.cache.loadIndex();
    const { source, appearance, variation, tintHex, displaySize = 44 } = options;

    const prepared = await this.ensureBaseLayers(source, true);
    if (!prepared || !prepared.manifest) {
      return {
        png: null,
        dataUri: prepared?.passthroughDataUri ?? null,
        rendered: false,
        layout: 'inset',
        revision: this.cache.version,
        cacheHit: Boolean(prepared?.cacheHit),
        engine: 'passthrough',
      };
    }

    const { manifest, cacheHit } = prepared;
    if (appearance === 'default' || appearance === 'dark') {
      const effectiveColor = resolveEffectiveColorPresentation(appearance, variation);
      const targetPath = effectiveColor === 'dark' ? manifest.darkPath : manifest.defaultPath;
      const lruKey = `${manifest.sourceHash}:${effectiveColor}`;
      const hit = this.getLru(lruKey);
      if (hit) {
        return {
          png: hit.png,
          dataUri: hit.dataUri,
          rendered: true,
          layout: manifest.layout,
          revision: this.cache.version,
          cacheHit: true,
          engine: manifest.engine,
        };
      }
      const png = await readFile(targetPath);
      const dataUri = `data:image/png;base64,${png.toString('base64')}`;
      this.setLru(lruKey, { png, dataUri, layout: manifest.layout });
      return {
        png,
        dataUri,
        rendered: true,
        layout: manifest.layout,
        revision: this.cache.version,
        cacheHit,
        engine: manifest.engine,
      };
    }

    const normalizedTint = tintHex.toLowerCase();
    const lruKey = `${manifest.sourceHash}:${appearance}:${variation}:${appearance === 'tinted' ? normalizedTint : '-'}`;
    const hit = this.getLru(lruKey);
    if (hit) {
      return {
        png: hit.png,
        dataUri: hit.dataUri,
        rendered: true,
        layout: manifest.layout,
        revision: this.cache.version,
        cacheHit: true,
        engine: manifest.engine,
      };
    }

    const semanticPath = appearance === 'tinted' ? manifest.tintedPath : manifest.clearPath;
    const semanticPng = await readFile(semanticPath);
    const decodedSemantic = decodePngRgba(semanticPng);
    const compositedRgba = await this.worker.compositeSemantic(
      decodedSemantic.rgba,
      decodedSemantic.width,
      decodedSemantic.height,
      {
        appearance,
        variation,
        tintHex: normalizedTint,
        tileFraction: manifest.tileFraction,
        displaySize,
      },
    );
    const finalPng = encodePngRgba(compositedRgba, decodedSemantic.width, decodedSemantic.height);
    const dataUri = `data:image/png;base64,${finalPng.toString('base64')}`;
    this.setLru(lruKey, { png: finalPng, dataUri, layout: manifest.layout });
    return {
      png: finalPng,
      dataUri,
      rendered: true,
      layout: manifest.layout,
      revision: this.cache.version,
      cacheHit,
      engine: this.worker.activeEngine,
    };
  }

  private getLru(
    key: string,
  ): { png: Buffer; dataUri: string; layout: 'fill' | 'inset' } | undefined {
    const entry = this.composedLru.get(key);
    if (!entry) return undefined;
    this.composedLru.delete(key);
    this.composedLru.set(key, entry);
    return entry;
  }

  private setLru(
    key: string,
    value: { png: Buffer; dataUri: string; layout: 'fill' | 'inset' },
  ): void {
    if (this.composedLru.has(key)) this.composedLru.delete(key);
    this.composedLru.set(key, value);
    while (this.composedLru.size > this.composedMaxEntries) {
      const oldest = this.composedLru.keys().next().value;
      if (oldest === undefined) break;
      this.composedLru.delete(oldest);
    }
  }

  private async ensureBaseLayers(
    source: IconSourceJob,
    urgent: boolean,
  ): Promise<PreparedBaseResult | null> {
    const indexed = this.cache.getIndexEntry(source.key);
    if (indexed && !indexed.isFallback) {
      const existing = await this.cache.readRenderedManifest(indexed.sourceHash);
      if (existing) {
        return { manifest: existing, passthroughDataUri: null, cacheHit: true };
      }
    }

    let queued = this.jobs.get(source.key);
    if (!queued) {
      queued = { job: source, urgent, waiters: [] };
      this.jobs.set(source.key, queued);
      (urgent ? this.urgentQueue : this.backgroundQueue).push(queued);
    } else if (urgent && !queued.urgent) {
      this.urgentQueue.push(queued);
    }

    const promise = new Promise<PreparedBaseResult | null>((resolve, reject) => {
      queued!.waiters.push({ resolve, reject });
    });
    this.pump();
    return promise;
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.activeCount < this.maxConcurrency) {
      const next = this.dequeueNext();
      if (!next) break;
      this.activeCount += 1;
      void this.executeJob(next).finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private dequeueNext(): QueuedBaseJob | null {
    for (const queue of [this.urgentQueue, this.backgroundQueue]) {
      while (queue.length > 0) {
        const candidate = queue.shift()!;
        if (this.jobs.get(candidate.job.key) === candidate) {
          this.jobs.delete(candidate.job.key);
          return candidate;
        }
      }
    }
    return null;
  }

  private async executeJob(entry: QueuedBaseJob): Promise<void> {
    const { job } = entry;
    try {
      const result = await this.processSourceJob(job);
      this.failures.delete(job.key);
      this.completed += 1;
      for (const waiter of entry.waiters) waiter.resolve(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = { key: job.key, message };
      this.failures.set(job.key, Date.now());
      for (const waiter of entry.waiters) {
        waiter.reject(error instanceof Error ? error : new Error(message));
      }
    }
  }

  private async processSourceJob(job: IconSourceJob): Promise<PreparedBaseResult | null> {
    const started = performance.now();

    // 1. Check raw source disk cache first (survives algorithm revision bumps!).
    let raw = await this.cache.readRawSource(job.key);
    if (!raw) {
      const fetched = await job.fetchSource();
      if (!fetched.dataUri) return null;
      const parsed = parseImageDataUri(fetched.dataUri);
      if (!parsed) {
        return { manifest: null, passthroughDataUri: fetched.dataUri, cacheHit: false };
      }
      const meta = await this.cache.writeRawSource(
        job.key,
        parsed.bytes,
        parsed.mime,
        fetched.isFallback,
      );
      raw = { bytes: parsed.bytes, meta };
    }

    // 2. Check versioned rendered manifest for this exact content hash.
    const cachedManifest = await this.cache.readRenderedManifest(raw.meta.sourceHash);
    if (cachedManifest) {
      this.cache.setIndexEntry(job.key, {
        sourceHash: raw.meta.sourceHash,
        isFallback: raw.meta.isFallback,
        mime: raw.meta.mime,
        layout: cachedManifest.layout,
        size: cachedManifest.size,
        bodySize: cachedManifest.bodySize,
        tileFraction: cachedManifest.tileFraction,
        updatedAt: Date.now(),
      });
      return { manifest: cachedManifest, passthroughDataUri: null, cacheHit: true };
    }

    // 3. Decode raster image (SVG sources pass through cleanly for browser vector rasterization).
    const decoded = await decodeSourceToPremulRgba(raw.bytes, raw.meta.mime);
    if (!decoded) {
      const passthrough = `data:${raw.meta.mime};base64,${raw.bytes.toString('base64')}`;
      return { manifest: null, passthroughDataUri: passthrough, cacheHit: false };
    }

    // 4. Render all 4 base layers in ONE segmentation pass (C++20 worker or TS fallback).
    const base = await this.worker.renderAllBase(
      decoded.rgba,
      decoded.width,
      decoded.height,
      this.tileSize,
    );
    const defaultPng = encodePngRgba(base.defaultRgba, base.width, base.height);
    await yieldToEventLoop();
    const darkPng = encodePngRgba(base.darkRgba, base.width, base.height);
    await yieldToEventLoop();
    const clearSemanticPng = encodePngRgba(base.clearSemanticRgba, base.width, base.height);
    await yieldToEventLoop();
    const tintedSemanticPng = encodePngRgba(base.tintedSemanticRgba, base.width, base.height);

    const manifest = await this.cache.writeRenderedBaseLayers(raw.meta.sourceHash, {
      size: base.width,
      bodySize: base.bodySize,
      tileFraction: base.tileFraction,
      layout: base.layout,
      segmented: base.segmented,
      branch: base.branch,
      engine: base.engine,
      milliseconds: Math.round((performance.now() - started) * 10) / 10,
      defaultPng,
      darkPng,
      clearSemanticPng,
      tintedSemanticPng,
    });

    this.cache.setIndexEntry(job.key, {
      sourceHash: raw.meta.sourceHash,
      isFallback: raw.meta.isFallback,
      mime: raw.meta.mime,
      layout: manifest.layout,
      size: manifest.size,
      bodySize: manifest.bodySize,
      tileFraction: manifest.tileFraction,
      updatedAt: Date.now(),
    });
    this.generated += 1;
    return { manifest, passthroughDataUri: null, cacheHit: false };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.worker.dispose();
    disposeRasterDecoder();
    await this.cache.flushIndex().catch(() => undefined);
  }
}
