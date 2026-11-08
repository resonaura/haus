/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const MAX_AUTHORED_LINES = 500;
const MAX_FILES_PER_DIR = 25;
const BASELINE_PATH = resolve('scripts/baseline-rules.json');
const LOCAL_CREDENTIALS_PATH = resolve('.local/credentials.json');
const SECRET_FIELD_PATTERN = /pass|secret|token|key|pin/i;

interface SecretProbe {
  label: string;
  value: string;
  shortNumericRe: RegExp | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectSecretProbes(node: unknown, prefix: string, out: SecretProbe[]): void {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) {
      collectSecretProbes(item, `${prefix}[${index}]`, out);
    }
    return;
  }
  if (!isRecord(node)) return;

  for (const [key, value] of Object.entries(node)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' && value.length > 0 && SECRET_FIELD_PATTERN.test(key)) {
      const isShortNumeric = value.length < 6 && /^\d+$/.test(value);
      out.push({
        label,
        value,
        shortNumericRe: isShortNumeric
          ? new RegExp(`(?<![#.0-9a-fA-F])\\b${escapeRegExp(value)}\\b(?![0-9a-fA-F])`)
          : null,
      });
    } else if (typeof value === 'object' && value !== null) {
      collectSecretProbes(value, label, out);
    }
  }
}

async function checkTrackedCredentialLeaks(errors: string[]): Promise<string> {
  const lsFiles = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  if (lsFiles.status !== 0) {
    errors.push(`[CREDENTIAL CHECK FAILURE] git ls-files failed: ${lsFiles.stderr}`);
    return 'failed';
  }

  const trackedPaths = lsFiles.stdout.split('\0').filter((entry) => entry.length > 0);
  for (const rel of trackedPaths) {
    const normalized = rel.replaceAll('\\', '/');
    if (normalized === '.local' || normalized.startsWith('.local/')) {
      errors.push(
        `[SECRET LEAK VIOLATION] ${normalized}: private .local/ files must never be git-tracked.`,
      );
    }
  }

  let rawCredentials: string;
  try {
    rawCredentials = await readFile(LOCAL_CREDENTIALS_PATH, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return 'skipped (.local/credentials.json not present)';
    }
    errors.push('[CREDENTIAL CHECK FAILURE] Unable to read .local/credentials.json.');
    return 'failed';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCredentials) as unknown;
  } catch {
    errors.push('[CREDENTIAL CHECK FAILURE] .local/credentials.json is not valid JSON.');
    return 'failed';
  }

  const probes: SecretProbe[] = [];
  collectSecretProbes(parsed, '', probes);
  if (probes.length === 0) {
    return 'verified (0 secret fields in .local/credentials.json)';
  }

  let scannedFiles = 0;
  for (const rel of trackedPaths) {
    const normalized = rel.replaceAll('\\', '/');
    if (EXCLUDED_FILES.has(normalized)) continue;
    const dotIndex = normalized.lastIndexOf('.');
    const ext = dotIndex >= 0 ? normalized.slice(dotIndex).toLowerCase() : '';
    if (EXCLUDED_EXTENSIONS.has(ext)) continue;

    let buf: Buffer;
    try {
      buf = await readFile(resolve(rel));
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;

    scannedFiles++;
    const content = buf.toString('utf8');
    for (const probe of probes) {
      const matched = probe.shortNumericRe
        ? probe.shortNumericRe.test(content)
        : content.includes(probe.value);
      if (matched) {
        errors.push(
          `[SECRET LEAK VIOLATION] ${normalized}: contains redacted credential from .local/credentials.json (${probe.label}).`,
        );
      }
    }
  }

  return `verified (${probes.length} credential fields checked across ${scannedFiles} git-tracked files)`;
}

interface BaselineRules {
  baselineFileLengths?: Record<string, number>;
  baselineAnyCounts?: Record<string, number>;
  baselineDirectoryDebt?: Record<string, number>;
}

interface OxlintDiagnostic {
  code?: string;
  filename?: string;
}

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
  '.local',
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

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
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

async function scanDirectories(rootDir: string): Promise<Record<string, number>> {
  const dirCounts: Record<string, number> = {};
  async function visit(dir: string): Promise<void> {
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

async function main(): Promise<void> {
  const errors: string[] = [];
  let baseline: BaselineRules = { baselineFileLengths: {}, baselineAnyCounts: {} };

  try {
    const raw = await readFile(BASELINE_PATH, 'utf8');
    baseline = JSON.parse(raw) as BaselineRules;
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
  const oxlintBin = resolve('node_modules/.bin/oxlint');
  const oxlint = spawnSync(oxlintBin, ['-D', 'typescript/no-explicit-any', '-f', 'json'], {
    encoding: 'utf8',
  });

  let oxDiagnostics: OxlintDiagnostic[] = [];
  try {
    const parsed = JSON.parse(oxlint.stdout) as { diagnostics?: OxlintDiagnostic[] };
    oxDiagnostics = parsed.diagnostics ?? [];
  } catch {
    if (oxlint.status !== 0 && !oxlint.stdout) {
      errors.push(`[LINTER FAILURE] oxlint failed to run: ${oxlint.stderr}`);
    }
  }

  const anyCountsPerFile: Record<string, number> = {};
  for (const d of oxDiagnostics) {
    if (d.code === 'typescript(no-explicit-any)' && d.filename) {
      const rel = d.filename.replaceAll('\\', '/');
      anyCountsPerFile[rel] = (anyCountsPerFile[rel] ?? 0) + 1;
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
  const archCheck = spawnSync('node', ['scripts/check-architecture.ts'], {
    encoding: 'utf8',
  });
  if (archCheck.status !== 0) {
    errors.push(`[ARCHITECTURE VIOLATION]\n${archCheck.stderr || archCheck.stdout}`);
  }

  // ---------------------------------------------------------
  // 5. Tracked Credential Leak Check (.local/credentials.json)
  // ---------------------------------------------------------
  const credentialSummary = await checkTrackedCredentialLeaks(errors);

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
  - Explicit 'any': verified across workspace TS files (zero new 'any' types, legacy baseline locked).
  - Directory cleanliness: ${inspectedDirCount} directories inspected (max 25 files/dir, legacy baseline debt locked).
  - Architecture: all package and boundary import rules passed.
  - Credential leaks: ${credentialSummary}.`,
    );
  }
}

await main();
