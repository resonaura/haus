/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, posix, resolve } from 'node:path';

export interface DeployMapping {
  readonly localDir: string;
  readonly containerDir: string;
}

export interface DeployTargetConfig {
  readonly name: string;
  readonly role: 'standby' | 'primary';
  readonly enabled: boolean;
  readonly ssh: string;
  readonly sshPort?: number;
  readonly container: string;
  readonly containerAppDir: string;
  readonly healthUrl: string;
  readonly healthTimeoutSec: number;
  readonly backupDir: string;
  readonly keepBackups: number;
  readonly chown?: string;
  readonly syncMode: 'changed-only' | 'all';
  readonly include?: readonly string[];
  readonly preservePaths: readonly string[];
  readonly patchNestBodyParser?: boolean;
}

export interface DeployConfig {
  readonly schemaVersion: 1;
  readonly buildCommands: readonly string[];
  readonly mappings: readonly DeployMapping[];
  readonly targets: readonly DeployTargetConfig[];
}

export interface ResolvedFileEntry {
  readonly relPath: string;
  readonly absLocalPath: string;
  readonly sha256: string;
  readonly size: number;
}

export interface DeployCliOptions {
  readonly configPath: string;
  readonly targetNames: readonly string[];
  readonly pathFilters: readonly string[];
  readonly dryRun: boolean;
  readonly skipBuild: boolean;
  readonly rollback: boolean;
  readonly backupId?: string;
  readonly status: boolean;
  readonly help: boolean;
}

const SAFE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SAFE_SSH_RE = /^[a-zA-Z0-9._@-]+$/;
const SAFE_CHOWN_RE = /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/;
const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.py', '.sql']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeRelPath(input: string): string {
  const cleaned = input.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) {
    throw new Error(`Invalid relative deploy path: "${input}"`);
  }
  return cleaned;
}

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing or invalid "${key}" in ${ctx}`);
  }
  return value.trim();
}

function parseStringArray(value: unknown, key: string, ctx: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.trim().length > 0)) {
    throw new Error(`Invalid string array "${key}" in ${ctx}`);
  }
  return value.map((v) => v.trim());
}

export function parseDeployConfig(raw: unknown): DeployConfig {
  if (!isRecord(raw)) throw new Error('Deploy config must be a JSON object.');
  if (raw.schemaVersion !== 1) {
    throw new Error(`Unsupported deploy config schemaVersion: ${String(raw.schemaVersion)}`);
  }

  const buildCommands = parseStringArray(raw.buildCommands, 'buildCommands', 'config');
  if (!Array.isArray(raw.mappings) || raw.mappings.length === 0) {
    throw new Error('Deploy config requires at least one mapping in "mappings".');
  }
  const mappings: DeployMapping[] = raw.mappings.map((item, idx) => {
    const ctx = `mappings[${idx}]`;
    if (!isRecord(item)) throw new Error(`Invalid object at ${ctx}`);
    const localDir = normalizeRelPath(requireString(item, 'localDir', ctx));
    const containerDir = normalizeRelPath(requireString(item, 'containerDir', ctx));
    return { localDir, containerDir };
  });

  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    throw new Error('Deploy config requires at least one target in "targets".');
  }

  const seenNames = new Set<string>();
  const targets: DeployTargetConfig[] = raw.targets.map((item, idx) => {
    const ctx = `targets[${idx}]`;
    if (!isRecord(item)) throw new Error(`Invalid object at ${ctx}`);
    const name = requireString(item, 'name', ctx);
    if (!SAFE_NAME_RE.test(name)) throw new Error(`Unsafe target name "${name}" in ${ctx}`);
    if (seenNames.has(name)) throw new Error(`Duplicate target name "${name}"`);
    seenNames.add(name);

    const roleRaw = item.role ?? 'standby';
    if (roleRaw !== 'standby' && roleRaw !== 'primary') {
      throw new Error(`Invalid role "${String(roleRaw)}" in ${ctx} (use "standby" or "primary")`);
    }
    const ssh = requireString(item, 'ssh', ctx);
    if (!SAFE_SSH_RE.test(ssh)) throw new Error(`Unsafe ssh target "${ssh}" in ${ctx}`);

    const sshPort = item.sshPort !== undefined ? Number(item.sshPort) : undefined;
    if (sshPort !== undefined && (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) {
      throw new Error(`Invalid sshPort in ${ctx}`);
    }

    const container = requireString(item, 'container', ctx);
    if (!SAFE_NAME_RE.test(container)) {
      throw new Error(`Unsafe container name "${container}" in ${ctx}`);
    }

    const containerAppDir = requireString(item, 'containerAppDir', ctx);
    if (!containerAppDir.startsWith('/') || containerAppDir.includes('..')) {
      throw new Error(`Invalid containerAppDir "${containerAppDir}" in ${ctx}`);
    }

    const healthUrl = requireString(item, 'healthUrl', ctx);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(healthUrl);
    } catch {
      throw new Error(`Invalid healthUrl "${healthUrl}" in ${ctx}`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`healthUrl must use http or https in ${ctx}`);
    }

    const healthTimeoutSec = Number(item.healthTimeoutSec ?? 90);
    if (!Number.isFinite(healthTimeoutSec) || healthTimeoutSec < 5 || healthTimeoutSec > 600) {
      throw new Error(`healthTimeoutSec must be between 5 and 600 in ${ctx}`);
    }

    const backupDir = requireString(item, 'backupDir', ctx);
    if (!backupDir.startsWith('/') || backupDir.includes('..')) {
      throw new Error(`Invalid backupDir "${backupDir}" in ${ctx}`);
    }

    const keepBackups = Number(item.keepBackups ?? 5);
    if (!Number.isInteger(keepBackups) || keepBackups < 1 || keepBackups > 50) {
      throw new Error(`keepBackups must be an integer between 1 and 50 in ${ctx}`);
    }

    const chown =
      typeof item.chown === 'string' && item.chown.trim() ? item.chown.trim() : undefined;
    if (chown && !SAFE_CHOWN_RE.test(chown)) {
      throw new Error(`Unsafe chown value "${chown}" in ${ctx}`);
    }

    const syncModeRaw = item.syncMode ?? 'changed-only';
    if (syncModeRaw !== 'changed-only' && syncModeRaw !== 'all') {
      throw new Error(`Invalid syncMode "${String(syncModeRaw)}" in ${ctx}`);
    }

    const include =
      item.include !== undefined
        ? parseStringArray(item.include, 'include', ctx).map(normalizeRelPath)
        : undefined;
    const preservePaths = parseStringArray(item.preservePaths, 'preservePaths', ctx).map(
      normalizeRelPath,
    );

    return {
      name,
      role: roleRaw,
      enabled: item.enabled !== false,
      ssh,
      sshPort,
      container,
      containerAppDir: containerAppDir.replace(/\/+$/, ''),
      healthUrl,
      healthTimeoutSec,
      backupDir: backupDir.replace(/\/+$/, ''),
      keepBackups,
      chown,
      syncMode: syncModeRaw,
      include,
      preservePaths,
      patchNestBodyParser: Boolean(item.patchNestBodyParser),
    };
  });

  return { schemaVersion: 1, buildCommands, mappings, targets };
}

export function shouldPreservePath(relPath: string, preservePaths: readonly string[]): boolean {
  const normalized = relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  for (const rule of preservePaths) {
    if (rule.endsWith('/')) {
      if (normalized.startsWith(rule)) return true;
    } else if (normalized === rule || normalized.startsWith(`${rule}/`)) {
      return true;
    }
  }
  return false;
}

export function matchesIncludePaths(
  relPath: string,
  includePaths: readonly string[] | undefined,
): boolean {
  if (!includePaths || includePaths.length === 0) return true;
  const normalized = relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  for (const rule of includePaths) {
    if (rule.endsWith('/')) {
      if (normalized.startsWith(rule)) return true;
    } else if (normalized === rule || normalized.startsWith(`${rule}/`)) {
      return true;
    }
  }
  return false;
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (
      entry.name.startsWith('._') ||
      entry.name === '.DS_Store' ||
      entry.name === '__pycache__' ||
      entry.name === 'node_modules'
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.map')) continue;
      if (!ALLOWED_EXTENSIONS.has(extname(entry.name))) continue;
      files.push(full);
    }
  }
  return files;
}

export async function collectDeployFiles(
  repoRoot: string,
  mappings: readonly DeployMapping[],
  target: DeployTargetConfig,
  pathFilters: readonly string[] = [],
): Promise<ResolvedFileEntry[]> {
  const normalizedFilters = pathFilters.map(normalizeRelPath);
  const byRelPath = new Map<string, ResolvedFileEntry>();

  for (const mapping of mappings) {
    const absLocalRoot = resolve(repoRoot, mapping.localDir);
    const localFiles = await walkFiles(absLocalRoot);
    for (const absLocalPath of localFiles) {
      const subRel = absLocalPath
        .slice(absLocalRoot.length)
        .replaceAll('\\', '/')
        .replace(/^\/+/, '');
      const relPath = posix.join(mapping.containerDir, subRel);
      if (shouldPreservePath(relPath, target.preservePaths)) continue;
      if (!matchesIncludePaths(relPath, target.include)) continue;
      if (normalizedFilters.length > 0 && !matchesIncludePaths(relPath, normalizedFilters)) {
        continue;
      }
      const bytes = await readFile(absLocalPath);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      byRelPath.set(relPath, { relPath, absLocalPath, sha256, size: bytes.byteLength });
    }
  }

  return Array.from(byRelPath.values()).sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function parseCliArgs(argv: readonly string[]): DeployCliOptions {
  let configPath = '.local/deploy-hubs.json';
  const targetNames: string[] = [];
  const pathFilters: string[] = [];
  let dryRun = false;
  let skipBuild = false;
  let rollback = false;
  let backupId: string | undefined;
  let status = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg === '--') continue;
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--skip-build') skipBuild = true;
    else if (arg === '--status') status = true;
    else if (arg === '--rollback') {
      rollback = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        targetNames.push(next);
        i += 1;
      }
    } else if (arg === '--config' && argv[i + 1]) {
      configPath = argv[i + 1] as string;
      i += 1;
    } else if (arg === '--target' && argv[i + 1]) {
      targetNames.push(...(argv[i + 1] as string).split(',').filter(Boolean));
      i += 1;
    } else if (arg === '--backup' && argv[i + 1]) {
      backupId = argv[i + 1] as string;
      i += 1;
    } else if (arg === '--paths' && argv[i + 1]) {
      pathFilters.push(...(argv[i + 1] as string).split(',').filter(Boolean));
      i += 1;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  return {
    configPath,
    targetNames,
    pathFilters,
    dryRun,
    skipBuild,
    rollback,
    backupId,
    status,
    help,
  };
}
