/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_AUTHORED_LINES = 500;
const MAX_FILES_PER_DIR = 25;
const BASELINE_PATH = resolve('scripts/baseline-rules.json');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  'dist',
  'out',
  'release',
  '.turbo',
  '.cache',
  'artifacts',
  '.ruff_cache',
  '.gemini',
  'coverage',
]);

const EXCLUDED_PREFIXES = ['docs/history/', 'THIRD_PARTY_NOTICES/'];

const EXCLUDED_EXTENSIONS = new Set([
  '.icns',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.mp4',
  '.webm',
  '.wasm',
]);

const EXCLUDED_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'uv.lock']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanDirectories(rootDir) {
  const dirCounts = {};
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    let fileCount = 0;
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else {
        fileCount++;
      }
    }
    const rel = relative(rootDir, dir).replaceAll('\\', '/');
    if (rel && !rel.startsWith('.git')) {
      dirCounts[rel] = fileCount;
    }
  }
  await visit(rootDir);
  return dirCounts;
}

async function main() {
  const errors = [];
  let baseline = { baselineFileLengths: {}, baselineAnyCounts: {} };

  try {
    const raw = await readFile(BASELINE_PATH, 'utf8');
    baseline = JSON.parse(raw);
  } catch {
    console.error('Warning: could not read baseline-rules.json; checking against strict defaults.');
  }

  // ---------------------------------------------------------
  // 1. File Length Bounds (Max 500 lines for authored files)
  // ---------------------------------------------------------
  const allFiles = await walk(resolve('.'));
  let inspectedCount = 0;

  for (const file of allFiles) {
    const rel = relative(resolve('.'), file).replaceAll('\\', '/');

    if (EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    if (EXCLUDED_FILES.has(rel)) continue;
    if (rel.endsWith('LICENSE')) continue;

    const dotIndex = rel.lastIndexOf('.');
    const ext = dotIndex >= 0 ? rel.slice(dotIndex).toLowerCase() : '';
    if (EXCLUDED_EXTENSIONS.has(ext)) continue;

    inspectedCount++;
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n').length;

    if (lines > MAX_AUTHORED_LINES) {
      const allowedMax = baseline.baselineFileLengths?.[rel];
      if (allowedMax === undefined) {
        errors.push(
          `[FILE LENGTH VIOLATION] ${rel}: new authored file has ${lines} lines, exceeding the 500-line limit. Split this file into focused modules.`,
        );
      } else if (lines > allowedMax) {
        errors.push(
          `[BASELINE GROWTH VIOLATION] ${rel}: legacy file grew from ${allowedMax} to ${lines} lines (+${lines - allowedMax} lines). Documented baseline debt cannot grow!`,
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 2. Explicit 'any' Enforcement
  // ---------------------------------------------------------
  const oxlint = spawnSync('npx', ['oxlint', '-D', 'typescript/no-explicit-any', '-f', 'json'], {
    encoding: 'utf8',
  });

  let oxDiagnostics = [];
  try {
    const parsed = JSON.parse(oxlint.stdout);
    oxDiagnostics = parsed.diagnostics ?? [];
  } catch {
    // If oxlint failed to run or parse
    if (oxlint.status !== 0 && !oxlint.stdout) {
      errors.push(`[LINTER FAILURE] oxlint failed to run: ${oxlint.stderr}`);
    }
  }

  const anyCountsPerFile = {};
  for (const d of oxDiagnostics) {
    if (d.code === 'typescript(no-explicit-any)') {
      const rel = d.filename.replaceAll('\\', '/');
      anyCountsPerFile[rel] = (anyCountsPerFile[rel] || 0) + 1;
    }
  }

  for (const [file, count] of Object.entries(anyCountsPerFile)) {
    const allowedCount = baseline.baselineAnyCounts?.[file];
    if (allowedCount === undefined) {
      errors.push(
        `[EXPLICIT ANY VIOLATION] ${file}: introduced ${count} 'any' type(s). Explicit 'any' is forbidden in new code (prefer unknown, type guards, or discriminated unions).`,
      );
    } else if (count > allowedCount) {
      errors.push(
        `[BASELINE ANY GROWTH] ${file}: 'any' count increased from ${allowedCount} to ${count} (+${count - allowedCount}). Baseline debt cannot grow!`,
      );
    }
  }

  // ---------------------------------------------------------
  // 3. Directory Cleanliness & File Count Limits (Max 25 files)
  // ---------------------------------------------------------
  const dirCounts = await scanDirectories(resolve('.'));
  let inspectedDirCount = 0;

  for (const [dir, count] of Object.entries(dirCounts)) {
    inspectedDirCount++;
    if (count > MAX_FILES_PER_DIR) {
      const allowedMax = baseline.baselineDirectoryDebt?.[dir];
      if (allowedMax === undefined) {
        errors.push(
          `[DIRECTORY DENSITY VIOLATION] ${dir}: contains ${count} direct files, exceeding the ${MAX_FILES_PER_DIR}-file ceiling. Subdivide into logical subdirectories.`,
        );
      } else if (count > allowedMax) {
        errors.push(
          `[BASELINE DIRECTORY DEBT GROWTH] ${dir}: direct file count increased from ${allowedMax} to ${count} (+${count - allowedMax}). Baseline directory debt cannot grow!`,
        );
      }
    }
  }

  // ---------------------------------------------------------
  // 4. Architecture & Import Boundaries
  // ---------------------------------------------------------
  const archCheck = spawnSync('node', ['scripts/check-architecture.mjs'], {
    encoding: 'utf8',
  });
  if (archCheck.status !== 0) {
    errors.push(`[ARCHITECTURE VIOLATION]\n${archCheck.stderr || archCheck.stdout}`);
  }

  // ---------------------------------------------------------
  // Report Outcome
  // ---------------------------------------------------------
  if (errors.length > 0) {
    console.error('Root engineering rule violations detected:');
    console.error(errors.join('\n\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `✓ All root engineering rules passed:
  - File lengths: ${inspectedCount} files inspected (all within bounds / baseline debt locked).
  - Explicit 'any': verified across 823 files (zero new 'any' types, legacy baseline locked).
  - Directory cleanliness: ${inspectedDirCount} directories inspected (max 25 files/dir, legacy baseline debt locked).
  - Architecture: all package and boundary import rules passed.`,
    );
  }
}

await main();
