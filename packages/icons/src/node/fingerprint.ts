/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_ENGINE_REVISION } from '../appearance.js';

const binaryFingerprintCache = new Map<string, { readonly sig: string; readonly hash: string }>();
let tsEngineFingerprintCache: string | null = null;

function hashFileSlice(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 8);
}

function computeCppBinaryFingerprint(binaryPath: string): string | null {
  try {
    const stat = statSync(binaryPath);
    const sig = `${stat.size}:${stat.mtimeMs}`;
    const cached = binaryFingerprintCache.get(binaryPath);
    if (cached && cached.sig === sig) return cached.hash;
    const hash = `cpp-${hashFileSlice(binaryPath)}`;
    binaryFingerprintCache.set(binaryPath, { sig, hash });
    return hash;
  } catch {
    return null;
  }
}

function collectTsEngineFiles(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = resolve(here, '..');
  const files: string[] = [];

  for (const stem of ['appearance', 'squircle']) {
    for (const ext of ['.js', '.ts']) {
      const candidate = join(pkgRoot, `${stem}${ext}`);
      if (existsSync(candidate)) {
        files.push(candidate);
        break;
      }
    }
  }

  const engineDir = join(pkgRoot, 'engine');
  if (existsSync(engineDir)) {
    const entries = readdirSync(engineDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /\.(?:js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
      )
      .map((entry) => entry.name)
      .sort();
    for (const name of entries) {
      files.push(join(engineDir, name));
    }
  }

  return files;
}

function computeTsEngineFingerprint(): string {
  if (tsEngineFingerprintCache) return tsEngineFingerprintCache;
  const hasher = createHash('sha256');
  const files = collectTsEngineFiles();
  for (const filePath of files) {
    hasher.update(filePath.slice(filePath.lastIndexOf('/') + 1));
    hasher.update('\0');
    try {
      hasher.update(readFileSync(filePath));
    } catch {
      // ignore transient unreadable entry
    }
    hasher.update('\0');
  }
  tsEngineFingerprintCache = `ts-${hasher.digest('hex').slice(0, 8)}`;
  return tsEngineFingerprintCache;
}

/**
 * Computes a deterministic short SHA-256 fingerprint for the active rendering engine
 * artifact (`haus-icon-worker` C++ binary or compiled TypeScript engine modules).
 *
 * Any change to the C++ binary or TS rendering pipeline automatically changes the
 * fingerprint, forcing a clean cache namespace rollover without manual bumps.
 */
export function computeEngineFingerprint(options: {
  readonly activeEngine: 'cpp' | 'ts';
  readonly binaryPath?: string | null;
}): string {
  if (options.activeEngine === 'cpp' && options.binaryPath) {
    const cpp = computeCppBinaryFingerprint(options.binaryPath);
    if (cpp) return cpp;
  }
  return computeTsEngineFingerprint();
}

/** Combines the semantic algorithm revision with the deterministic engine artifact fingerprint. */
export function resolveEffectiveIconRevision(options: {
  readonly baseRevision?: string;
  readonly activeEngine: 'cpp' | 'ts';
  readonly binaryPath?: string | null;
}): string {
  const base = options.baseRevision ?? ICON_ENGINE_REVISION;
  return `${base}-${computeEngineFingerprint(options)}`;
}
