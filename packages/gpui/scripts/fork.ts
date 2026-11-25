/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { GPUI_SPARSE_PATHS, pruneGpuiWorkspace } from './prune-workspace.ts';

interface RepoRef {
  readonly repo: string;
  readonly branch: string;
  readonly commit: string;
}

interface ForkManifest {
  readonly rustToolchain: string;
  readonly gpuix: RepoRef;
  readonly zed: RepoRef;
  readonly references?: {
    readonly sonoraGpui?: RepoRef;
  };
}

type DiffTarget = 'gpui' | 'gpuix';

const PKG_DIR = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(PKG_DIR, 'manifest.json');
const FORK_DIR = resolve(PKG_DIR, 'vendor/gpuix');
const GPUI_DIR = resolve(PKG_DIR, 'vendor/gpui');
const NATIVE_DIR = resolve(FORK_DIR, 'packages/native');
const REACT_DIR = resolve(FORK_DIR, 'packages/react');

const GPUIX_SPARSE_PATHS: readonly string[] = [
  '/LICENSE',
  '/THIRD_PARTY_NOTICES.md',
  '/package.json',
  '/rust-toolchain.toml',
  '/.gitignore',
  '/packages/native/',
  '/packages/react/',
  '/packages/gpui-terminal/',
];

function readManifest(): ForkManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ForkManifest;
}

function buildEnv(manifest: ForkManifest): NodeJS.ProcessEnv {
  const home = process.env.HOME ?? '';
  const pathParts = [
    '/opt/homebrew/opt/rustup/bin',
    home ? `${home}/.cargo/bin` : '',
    process.env.PATH ?? '',
  ].filter(Boolean);
  return {
    ...process.env,
    PATH: pathParts.join(':'),
    RUSTUP_TOOLCHAIN: manifest.rustToolchain,
  };
}

function runOrThrow(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const res = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Command failed (${String(res.status)}): ${cmd} ${args.join(' ')}`);
  }
}

function captureOrThrow(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(
      `Command failed (${String(res.status)}): ${cmd} ${args.join(' ')}\n${res.stderr}`,
    );
  }
  return res.stdout;
}

function hasMetalCompiler(env: NodeJS.ProcessEnv): boolean {
  if (process.platform !== 'darwin') return false;
  const check = spawnSync('xcrun', ['-sdk', 'macosx', '-f', 'metal'], { env, encoding: 'utf8' });
  return check.status === 0;
}

function checkUpstreamHeads(manifest: ForkManifest, env: NodeJS.ProcessEnv): void {
  const sources: Array<{ readonly name: string; readonly ref: RepoRef }> = [
    { name: 'zed-gpui', ref: manifest.zed },
    { name: 'gpuix', ref: manifest.gpuix },
  ];
  if (manifest.references?.sonoraGpui) {
    sources.push({ name: 'sonora-gpui', ref: manifest.references.sonoraGpui });
  }

  for (const { name, ref } of sources) {
    const out = captureOrThrow(
      'git',
      ['ls-remote', ref.repo, `refs/heads/${ref.branch}`],
      PKG_DIR,
      env,
    ).trim();
    const remoteCommit = out.split(/\s+/)[0] ?? 'unknown';
    const status = remoteCommit === ref.commit ? 'up-to-date' : 'upstream-updated';
    console.log(
      `${name} (${ref.branch}): pinned=${ref.commit.slice(0, 12)} remote=${remoteCommit.slice(0, 12)} [${status}]`,
    );
  }
}

function copyFilteredTree(srcDir: string, destDir: string): void {
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (srcPath) => {
      const name = basename(srcPath);
      if (name === 'target' || name === 'node_modules' || name === 'dist' || name === '.git') {
        return false;
      }
      if (name.endsWith('.node') || name.endsWith('.tsbuildinfo')) {
        return false;
      }
      if (
        srcPath.endsWith('/packages/native/wasm') ||
        srcPath.endsWith('\\packages\\native\\wasm')
      ) {
        return false;
      }
      return true;
    },
  });
}

function sparseCheckoutCommit(
  ref: RepoRef,
  sparsePaths: readonly string[],
  destDir: string,
  env: NodeJS.ProcessEnv,
): void {
  mkdirSync(destDir, { recursive: true });
  runOrThrow('git', ['init'], destDir, env);
  runOrThrow('git', ['remote', 'add', 'origin', ref.repo], destDir, env);
  runOrThrow('git', ['sparse-checkout', 'init', '--no-cone'], destDir, env);
  runOrThrow('git', ['sparse-checkout', 'set', ...sparsePaths], destDir, env);
  runOrThrow('git', ['fetch', '--depth', '1', 'origin', ref.commit], destDir, env);
  runOrThrow('git', ['checkout', '--detach', 'FETCH_HEAD'], destDir, env);
  rmSync(resolve(destDir, '.git'), { recursive: true, force: true });
}

function diffAgainstUpstream(
  target: DiffTarget,
  outFile: string | undefined,
  manifest: ForkManifest,
  env: NodeJS.ProcessEnv,
): void {
  const workDir = mkdtempSync(join(tmpdir(), `haus-${target}-diff-`));
  try {
    const upstreamDir = resolve(workDir, 'upstream');
    const currentDir = resolve(workDir, 'current');
    if (target === 'gpui') {
      sparseCheckoutCommit(manifest.zed, GPUI_SPARSE_PATHS, upstreamDir, env);
      copyFilteredTree(GPUI_DIR, currentDir);
    } else {
      sparseCheckoutCommit(manifest.gpuix, GPUIX_SPARSE_PATHS, upstreamDir, env);
      copyFilteredTree(FORK_DIR, currentDir);
    }

    const args = outFile
      ? ['diff', '--no-index', '--binary', 'upstream', 'current']
      : ['diff', '--no-index', '--stat', 'upstream', 'current'];
    const res = spawnSync('git', args, {
      cwd: workDir,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0 && res.status !== 1) {
      throw new Error(`git diff failed (${String(res.status)}): ${res.stderr}`);
    }
    if (outFile) {
      writeFileSync(resolve(outFile), res.stdout, 'utf8');
      console.log(
        `Wrote ${target} diff vs ${target === 'gpui' ? manifest.zed.commit : manifest.gpuix.commit} to ${outFile}`,
      );
    } else {
      console.log(
        `=== ${target} vs pinned upstream (${target === 'gpui' ? manifest.zed.commit.slice(0, 12) : manifest.gpuix.commit.slice(0, 12)}) ===`,
      );
      console.log(res.stdout || '(no differences)');
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function buildFork(_manifest: ForkManifest, env: NodeJS.ProcessEnv, debug: boolean): void {
  const napiBin = resolve(NATIVE_DIR, 'node_modules/.bin/napi');
  const tscNativeBin = resolve(NATIVE_DIR, 'node_modules/.bin/tsc');
  const tscReactBin = resolve(REACT_DIR, 'node_modules/.bin/tsc');
  if (!existsSync(napiBin) || !existsSync(tscNativeBin) || !existsSync(tscReactBin)) {
    throw new Error(
      'GPUIX build tools are missing. Run `pnpm install` at the repository root first.',
    );
  }
  const features = ['test-support'];
  if (process.platform === 'darwin' && !hasMetalCompiler(env)) {
    features.push('gpui_platform/runtime_shaders');
  }
  const modeArgs = debug ? [] : ['--release'];
  const featArg = features.join(',');
  runOrThrow(
    napiBin,
    ['build', '--platform', '--esm', '--js', 'index.js', ...modeArgs, '--features', featArg],
    NATIVE_DIR,
    env,
  );
  runOrThrow(
    napiBin,
    ['build', '--platform', '--js', 'index.cjs', ...modeArgs, '--features', featArg],
    NATIVE_DIR,
    env,
  );
  runOrThrow(tscNativeBin, [], NATIVE_DIR, env);
  runOrThrow(tscReactBin, [], REACT_DIR, env);
}

function parseOutArg(argv: readonly string[]): string | undefined {
  const idx = argv.indexOf('--out');
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Missing path after --out');
  }
  return value;
}

function parseDiffTargets(argv: readonly string[]): readonly DiffTarget[] {
  const wantsGpui = argv.includes('gpui');
  const wantsGpuix = argv.includes('gpuix');
  if (wantsGpui && wantsGpuix) return ['gpui', 'gpuix'];
  if (wantsGpui) return ['gpui'];
  if (wantsGpuix) return ['gpuix'];
  return ['gpui', 'gpuix'];
}

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const manifest = readManifest();
const env = buildEnv(manifest);

if (args.has('--prune')) {
  pruneGpuiWorkspace(GPUI_DIR, manifest.zed.commit, manifest.rustToolchain);
  console.log('Pruned standalone GPUI workspace in packages/gpui/vendor/gpui.');
} else if (args.has('--upstream-check')) {
  checkUpstreamHeads(manifest, env);
} else if (args.has('--upstream-diff')) {
  const targets = parseDiffTargets(rawArgs);
  const outFile = parseOutArg(rawArgs);
  if (outFile && targets.length > 1) {
    throw new Error('Specify a single target (`gpui` or `gpuix`) when passing --out.');
  }
  for (const target of targets) {
    diffAgainstUpstream(target, outFile, manifest, env);
  }
} else {
  buildFork(manifest, env, args.has('--debug'));
}
