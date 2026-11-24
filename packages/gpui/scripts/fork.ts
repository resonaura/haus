/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GPUI_SPARSE_PATHS, pruneGpuiWorkspace } from './prune-workspace.ts';

interface ForkManifest {
  readonly rustToolchain: string;
  readonly gpuix: { readonly repo: string; readonly branch: string; readonly commit: string };
  readonly zed: { readonly repo: string; readonly branch: string; readonly commit: string };
  readonly references?: {
    readonly sonoraGpui?: { readonly repo: string; readonly branch: string; readonly commit: string };
  };
}

const PKG_DIR = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(PKG_DIR, 'manifest.json');
const FORK_DIR = resolve(PKG_DIR, 'vendor/gpuix');
const GPUI_DIR = resolve(PKG_DIR, 'vendor/gpui');
const LEGACY_ZED_DIR = resolve(FORK_DIR, 'zed');
const NATIVE_DIR = resolve(FORK_DIR, 'packages/native');
const REACT_DIR = resolve(FORK_DIR, 'packages/react');
const GPUI_PATCH_DIR = resolve(PKG_DIR, 'patches/gpui');
const GPUIX_PATCH_DIR = resolve(PKG_DIR, 'patches/gpuix');

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
    throw new Error(`Command failed (${String(res.status)}): ${cmd} ${args.join(' ')}\n${res.stderr}`);
  }
  return res.stdout;
}

function hasMetalCompiler(env: NodeJS.ProcessEnv): boolean {
  if (process.platform !== 'darwin') return false;
  const check = spawnSync('xcrun', ['-sdk', 'macosx', '-f', 'metal'], { env, encoding: 'utf8' });
  return check.status === 0;
}

function applyPatches(repoDir: string, patchDir: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(patchDir)) return;
  const patches = readdirSync(patchDir)
    .filter((f) => f.endsWith('.patch'))
    .sort();
  for (const patch of patches) {
    const patchPath = resolve(patchDir, patch);
    if (!readFileSync(patchPath, 'utf8').trim()) continue;
    runOrThrow('git', ['apply', '--3way', patchPath], repoDir, env);
  }
}

function ensureSonoraRemote(manifest: ForkManifest, env: NodeJS.ProcessEnv): void {
  const sonora = manifest.references?.sonoraGpui;
  if (!sonora) return;
  const check = spawnSync('git', ['remote', 'get-url', 'sonora'], { cwd: GPUI_DIR, env, encoding: 'utf8' });
  if (check.status !== 0) {
    runOrThrow('git', ['remote', 'add', 'sonora', sonora.repo], GPUI_DIR, env);
  }
}

function setupFork(manifest: ForkManifest, env: NodeJS.ProcessEnv): void {
  mkdirSync(resolve(PKG_DIR, 'vendor'), { recursive: true });
  if (!existsSync(FORK_DIR)) {
    runOrThrow(
      'git',
      ['clone', '--depth', '50', '--branch', manifest.gpuix.branch, manifest.gpuix.repo, FORK_DIR],
      PKG_DIR,
      env,
    );
  }
  runOrThrow('git', ['checkout', '-B', 'haus/compositor', manifest.gpuix.commit], FORK_DIR, env);
  if (existsSync(LEGACY_ZED_DIR)) {
    rmSync(LEGACY_ZED_DIR, { recursive: true, force: true });
  }

  if (!existsSync(GPUI_DIR) || !existsSync(resolve(GPUI_DIR, '.git'))) {
    runOrThrow(
      'git',
      [
        'clone',
        '--filter=blob:none',
        '--no-checkout',
        '--depth',
        '20',
        '--sparse',
        '--branch',
        manifest.zed.branch,
        manifest.zed.repo,
        GPUI_DIR,
      ],
      PKG_DIR,
      env,
    );
  }
  runOrThrow('git', ['sparse-checkout', 'init', '--no-cone'], GPUI_DIR, env);
  runOrThrow('git', ['sparse-checkout', 'set', ...GPUI_SPARSE_PATHS], GPUI_DIR, env);
  runOrThrow('git', ['fetch', '--depth', '15', 'origin', manifest.zed.commit], GPUI_DIR, env);
  runOrThrow('git', ['checkout', '-B', 'haus/compositor', manifest.zed.commit], GPUI_DIR, env);
  ensureSonoraRemote(manifest, env);
  pruneGpuiWorkspace(GPUI_DIR, manifest.zed.commit, manifest.rustToolchain);
  applyPatches(GPUI_DIR, GPUI_PATCH_DIR, env);
  applyPatches(FORK_DIR, GPUIX_PATCH_DIR, env);
}

function exportPatches(manifest: ForkManifest, env: NodeJS.ProcessEnv): void {
  mkdirSync(GPUI_PATCH_DIR, { recursive: true });
  mkdirSync(GPUIX_PATCH_DIR, { recursive: true });
  const gpuiDiff = captureOrThrow(
    'git',
    ['diff', '--binary', manifest.zed.commit, '--', 'crates/', 'tooling/'],
    GPUI_DIR,
    env,
  );
  writeFileSync(resolve(GPUI_PATCH_DIR, '0001-haus-compositor.patch'), gpuiDiff, 'utf8');
  const gpuixDiff = captureOrThrow(
    'git',
    ['diff', '--binary', manifest.gpuix.commit, '--', '.', ':!zed', ':!bun.lock'],
    FORK_DIR,
    env,
  );
  writeFileSync(resolve(GPUIX_PATCH_DIR, '0001-haus-compositor.patch'), gpuixDiff, 'utf8');
  console.log('Exported patches to packages/gpui/patches/gpui/ and packages/gpui/patches/gpuix/.');
}

function buildFork(manifest: ForkManifest, env: NodeJS.ProcessEnv, debug: boolean): void {
  const napiBin = resolve(NATIVE_DIR, 'node_modules/.bin/napi');
  const tscNativeBin = resolve(NATIVE_DIR, 'node_modules/.bin/tsc');
  const tscReactBin = resolve(REACT_DIR, 'node_modules/.bin/tsc');
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

const args = new Set(process.argv.slice(2));
const manifest = readManifest();
const env = buildEnv(manifest);

if (args.has('--setup')) {
  setupFork(manifest, env);
} else if (args.has('--prune')) {
  pruneGpuiWorkspace(GPUI_DIR, manifest.zed.commit, manifest.rustToolchain);
  console.log('Pruned standalone GPUI workspace in packages/gpui/vendor/gpui.');
} else if (args.has('--export-patches')) {
  exportPatches(manifest, env);
} else {
  buildFork(manifest, env, args.has('--debug'));
}
