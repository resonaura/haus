/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const GPUI_WORKSPACE_MEMBERS: readonly string[] = [
  'crates/collections',
  'crates/gpui',
  'crates/gpui_apple',
  'crates/gpui_linux',
  'crates/gpui_macos',
  'crates/gpui_macros',
  'crates/gpui_platform',
  'crates/gpui_shared_string',
  'crates/gpui_util',
  'crates/gpui_web',
  'crates/gpui_wgpu',
  'crates/gpui_windows',
  'crates/http_client',
  'crates/http_client_tls',
  'crates/media',
  'crates/refineable',
  'crates/refineable/derive_refineable',
  'crates/reqwest_client',
  'crates/scheduler',
  'crates/sum_tree',
  'crates/util_macros',
  'crates/zlog',
  'crates/ztracing',
  'crates/ztracing_macro',
  'tooling/perf',
];

export const GPUI_SPARSE_PATHS: readonly string[] = [
  '/Cargo.toml',
  '/LICENSE-APACHE',
  '/LICENSE-GPL',
  '/clippy.toml',
  '/.cargo/config.toml',
  '/assets/fonts/ibm-plex-sans/',
  '/assets/fonts/lilex/',
  '/crates/collections/',
  '/crates/gpui/',
  '/crates/gpui_apple/',
  '/crates/gpui_linux/',
  '/crates/gpui_macos/',
  '/crates/gpui_macros/',
  '/crates/gpui_platform/',
  '/crates/gpui_shared_string/',
  '/crates/gpui_util/',
  '/crates/gpui_web/',
  '/crates/gpui_wgpu/',
  '/crates/gpui_windows/',
  '/crates/http_client/',
  '/crates/http_client_tls/',
  '/crates/media/',
  '/crates/refineable/',
  '/crates/reqwest_client/',
  '/crates/scheduler/',
  '/crates/sum_tree/',
  '/crates/util_macros/',
  '/crates/zlog/',
  '/crates/ztracing/',
  '/crates/ztracing_macro/',
  '/tooling/perf/',
];

const KEPT_PATCHES = new Set(['async-process', 'async-task', 'calloop', 'windows-capture']);
const EXTRA_KEPT_DEV_PROFILE_CRATES = new Set([
  'quote',
  'syn',
  'proc-macro2',
  'taffy',
  'resvg',
  'serde_json',
]);
const DISALLOWED_ZED_CRATES = [
  'crates/zed',
  'crates/editor',
  'crates/agent',
  'crates/lsp',
  'crates/collab',
  'crates/util',
  'crates/path',
];
const HAUS_EXTRA_WORKSPACE_DEPS: Readonly<Record<string, string>> = {
  naga: 'naga = { version = "29.0.4", default-features = false }',
  'web-time': 'web-time = "1.1.0"',
};

function readSourceCargoToml(
  gpuiDir: string,
  baseCommit: string,
  sourceCargoTomlPath?: string,
): string {
  if (sourceCargoTomlPath) {
    return readFileSync(sourceCargoTomlPath, 'utf8');
  }
  if (existsSync(resolve(gpuiDir, '.git'))) {
    const res = spawnSync('git', ['show', `${baseCommit}:Cargo.toml`], {
      cwd: gpuiDir,
      encoding: 'utf8',
    });
    if (res.status === 0) {
      return res.stdout;
    }
  }
  return readFileSync(resolve(gpuiDir, 'Cargo.toml'), 'utf8');
}

function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDouble && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function isDependencyTableHeader(header: string): boolean {
  return (
    header === 'dependencies' ||
    header === 'build-dependencies' ||
    header === 'dev-dependencies' ||
    /^target\.[^.]+\.(dependencies|build-dependencies|dev-dependencies)$/.test(header) ||
    /^(dependencies|build-dependencies|dev-dependencies)\.[A-Za-z0-9_-]+$/.test(header) ||
    /^target\.[^.]+\.(dependencies|build-dependencies|dev-dependencies)\.[A-Za-z0-9_-]+$/.test(
      header,
    )
  );
}

function updateDelimiterDepth(clean: string, startDepth: number): number {
  let depth = startDepth;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inDouble && ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (!inSingle && !inDouble) {
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    }
  }
  return depth;
}

function collectWorkspaceDepsFromMember(
  tomlText: string,
  needed: Set<string>,
  memberNames: Set<string>,
): void {
  const lines = tomlText.split('\n');
  let section = '';
  let depth = 0;
  let block = '';

  const flushEntry = () => {
    const trimmed = block.trim();
    block = '';
    if (!trimmed || !isDependencyTableHeader(section)) return;
    if (!/\bworkspace\s*=\s*true\b/.test(trimmed)) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return;
    const lhs = trimmed.slice(0, eqIdx).trim();
    const pkgMatch = /\bpackage\s*=\s*"([^"]+)"/.exec(trimmed);
    if (pkgMatch?.[1]) {
      needed.add(pkgMatch[1]);
      return;
    }
    const dotted = lhs.match(/^([A-Za-z0-9_-]+)\.workspace$/);
    if (dotted?.[1]) {
      needed.add(dotted[1]);
      return;
    }
    const subtableKey = section.match(
      /\.(dependencies|build-dependencies|dev-dependencies)\.([A-Za-z0-9_-]+)$/,
    );
    if (lhs === 'workspace' && subtableKey?.[2]) {
      needed.add(subtableKey[2]);
      return;
    }
    if (/^[A-Za-z0-9_-]+$/.test(lhs)) {
      needed.add(lhs);
    }
  };

  for (const rawLine of lines) {
    const clean = stripLineComment(rawLine);
    const trimmedClean = clean.trim();
    if (depth === 0 && /^\[([^[\]]+)\]$/.test(trimmedClean)) {
      flushEntry();
      section = trimmedClean.slice(1, -1).trim();
      continue;
    }
    if (section === 'package') {
      const m = trimmedClean.match(/^name\s*=\s*"([^"]+)"/);
      if (m?.[1]) memberNames.add(m[1]);
      continue;
    }
    if (!isDependencyTableHeader(section)) continue;
    if (!trimmedClean && depth === 0) continue;

    block = block ? `${block}\n${clean}` : clean;
    depth = updateDelimiterDepth(clean, depth);
    if (depth === 0) flushEntry();
  }
  flushEntry();
}

interface TomlSection {
  readonly header: string;
  readonly bodyLines: string[];
}

function splitSections(tomlText: string): TomlSection[] {
  const sections: TomlSection[] = [];
  let current: TomlSection = { header: '', bodyLines: [] };
  let depth = 0;

  for (const rawLine of tomlText.split('\n')) {
    const clean = stripLineComment(rawLine);
    const trimmed = clean.trim();
    if (depth === 0 && /^\[[^[\]]+\]$/.test(trimmed)) {
      sections.push(current);
      current = { header: trimmed.slice(1, -1).trim(), bodyLines: [] };
      continue;
    }
    current.bodyLines.push(rawLine);
    depth = updateDelimiterDepth(clean, depth);
  }
  sections.push(current);
  return sections;
}

function splitKeyEntries(bodyLines: readonly string[]): { key: string; text: string }[] {
  const entries: { key: string; text: string }[] = [];
  let buf: string[] = [];
  let depth = 0;

  const flush = () => {
    const joined = buf.join('\n').trim();
    buf = [];
    if (!joined) return;
    const eq = joined.indexOf('=');
    if (eq < 0) return;
    const key = joined.slice(0, eq).trim();
    if (/^[A-Za-z0-9_-]+$/.test(key)) {
      entries.push({ key, text: joined });
    }
  };

  for (const rawLine of bodyLines) {
    const clean = stripLineComment(rawLine);
    const trimmed = clean.trim();
    if (depth === 0 && !trimmed) {
      continue;
    }
    buf.push(rawLine);
    depth = updateDelimiterDepth(clean, depth);
    if (depth === 0) flush();
  }
  flush();
  return entries;
}

function renderMinimalConfigToml(): string {
  return [
    '# Generated by packages/gpui/scripts/prune-workspace.ts from Zed upstream .cargo/config.toml.',
    '[build]',
    'rustflags = ["-C", "symbol-mangling-version=v0"]',
    '',
    '[target.\'cfg(target_os = "windows")\']',
    'rustflags = ["--cfg", "windows_slim_errors"]',
    '',
    '[env]',
    'MACOSX_DEPLOYMENT_TARGET = "10.15.7"',
    '',
  ].join('\n');
}

function renderToolchainToml(rustToolchain: string): string {
  return [
    '# Generated by packages/gpui/scripts/prune-workspace.ts.',
    '[toolchain]',
    `channel = "${rustToolchain}"`,
    'profile = "minimal"',
    'targets = ["wasm32-unknown-unknown"]',
    '',
  ].join('\n');
}

export function pruneGpuiWorkspace(
  gpuiDir: string,
  baseCommit: string,
  rustToolchain: string,
  sourceCargoTomlPath?: string,
): void {
  for (const bad of DISALLOWED_ZED_CRATES) {
    if (existsSync(resolve(gpuiDir, bad))) {
      throw new Error(`Disallowed full-Zed directory still present: ${bad}`);
    }
  }

  const neededWsDeps = new Set<string>();
  const memberNames = new Set<string>();
  const localPathDeps = new Set<string>(GPUI_WORKSPACE_MEMBERS);

  for (const member of GPUI_WORKSPACE_MEMBERS) {
    const manifestPath = resolve(gpuiDir, member, 'Cargo.toml');
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing required GPUI runtime crate manifest: ${manifestPath}`);
    }
    const text = readFileSync(manifestPath, 'utf8');
    collectWorkspaceDepsFromMember(text, neededWsDeps, memberNames);
  }

  const upstreamCargo = readSourceCargoToml(gpuiDir, baseCommit, sourceCargoTomlPath);
  const sections = splitSections(upstreamCargo);

  const out: string[] = [
    '# Minimal standalone GPUI runtime workspace for @haus/gpui / @gpuix/native.',
    `# Extracted from upstream commit ${baseCommit} by packages/gpui/scripts/prune-workspace.ts.`,
    '[workspace]',
    'resolver = "2"',
    'members = [',
    ...GPUI_WORKSPACE_MEMBERS.map((m) => `    "${m}",`),
    ']',
    'exclude = ["crates/gpui_web/examples/hello_web"]',
    '',
  ];

  const seenExternalDeps = new Set<string>();

  for (const sec of sections) {
    if (
      sec.header === 'workspace.package' ||
      sec.header === 'profile.dev' ||
      sec.header === 'profile.dev.build-override' ||
      sec.header === 'profile.dbg' ||
      sec.header === 'profile.dbg.build-override' ||
      sec.header === 'profile.release' ||
      sec.header === 'profile.release-fast' ||
      sec.header === 'workspace.lints.rust' ||
      sec.header === 'workspace.lints.clippy'
    ) {
      out.push(
        `[${sec.header}]`,
        ...sec.bodyLines
          .map((l) => l.trimEnd())
          .filter((l, idx, arr) => !(idx === arr.length - 1 && l === '')),
        '',
      );
      continue;
    }

    if (sec.header === 'workspace.dependencies') {
      const entries = splitKeyEntries(sec.bodyLines);
      const localEntries: string[] = [];
      const extEntries: string[] = [];
      for (const entry of entries) {
        const pathMatch = /\bpath\s*=\s*"([^"]+)"/.exec(entry.text);
        if (pathMatch?.[1]) {
          if (localPathDeps.has(pathMatch[1])) {
            localEntries.push(entry.text);
            seenExternalDeps.add(entry.key);
          }
          continue;
        }
        if (neededWsDeps.has(entry.key)) {
          extEntries.push(entry.text);
          seenExternalDeps.add(entry.key);
        }
      }
      for (const [dep, line] of Object.entries(HAUS_EXTRA_WORKSPACE_DEPS)) {
        if (neededWsDeps.has(dep) && !seenExternalDeps.has(dep)) {
          extEntries.push(line);
          seenExternalDeps.add(dep);
        }
      }
      out.push(
        '[workspace.dependencies]',
        '# Local GPUI runtime crates',
        ...localEntries,
        '',
        '# External dependencies required by GPUI + GPUIX',
        ...extEntries,
        '',
      );
      continue;
    }

    if (sec.header.startsWith('workspace.dependencies.')) {
      const depName = sec.header.slice('workspace.dependencies.'.length);
      if (neededWsDeps.has(depName)) {
        seenExternalDeps.add(depName);
        out.push(`[${sec.header}]`, ...sec.bodyLines, '');
      }
      continue;
    }

    if (sec.header === 'patch.crates-io') {
      const entries = splitKeyEntries(sec.bodyLines).filter((e) => KEPT_PATCHES.has(e.key));
      if (entries.length > 0) {
        out.push('[patch.crates-io]', ...entries.map((e) => e.text), '');
      }
      continue;
    }

    if (sec.header === 'profile.dev.package') {
      const kept = new Set([...memberNames, ...neededWsDeps, ...EXTRA_KEPT_DEV_PROFILE_CRATES]);
      const entries = splitKeyEntries(sec.bodyLines).filter((e) => kept.has(e.key));
      if (entries.length > 0) {
        out.push('[profile.dev.package]', ...entries.map((e) => e.text), '');
      }
      continue;
    }
  }

  for (const dep of neededWsDeps) {
    if (!seenExternalDeps.has(dep)) {
      throw new Error(
        `Workspace dependency "${dep}" referenced by GPUI crates was missing from upstream Cargo.toml`,
      );
    }
  }

  writeFileSync(resolve(gpuiDir, 'Cargo.toml'), out.join('\n'), 'utf8');
  writeFileSync(resolve(gpuiDir, '.cargo/config.toml'), renderMinimalConfigToml(), 'utf8');
  writeFileSync(
    resolve(gpuiDir, 'rust-toolchain.toml'),
    renderToolchainToml(rustToolchain),
    'utf8',
  );
}
