/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HaFlowRuntimeOptions } from './types.js';

export class HaFlowWorkerError extends Error {
  readonly code: string;
  readonly domain?: string;
  readonly missingRequirements?: readonly string[];
  readonly remoteTraceback?: string;

  constructor(
    message: string,
    opts: {
      code?: string;
      domain?: string;
      missingRequirements?: readonly string[];
      traceback?: string;
    } = {},
  ) {
    super(message);
    this.name = 'HaFlowWorkerError';
    this.code = opts.code ?? 'worker_error';
    this.domain = opts.domain;
    this.missingRequirements = opts.missingRequirements;
    this.remoteTraceback = opts.traceback;
  }
}

export function buildWorkerEnv(
  options: HaFlowRuntimeOptions,
  scratchDir: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: scratchDir,
    TMP: scratchDir,
    TEMP: scratchDir,
  };
  if (options.frontendBase) env.HA_FLOW_FRONTEND_BASE = options.frontendBase;
  if (options.componentsOverlayDir) env.HA_FLOW_COMPONENTS_DIR = options.componentsOverlayDir;
  if (options.autoInstallReqs !== undefined) {
    env.HAUS_HA_AUTO_INSTALL_REQS = options.autoInstallReqs ? 'true' : 'false';
  }
  if (options.setupOnCreate !== undefined) {
    env.HA_FLOW_SETUP_ON_CREATE = options.setupOnCreate ? 'true' : 'false';
  }
  return env;
}

export function notifyListeners<T>(
  listeners: ReadonlySet<(value: T) => void>,
  value: T,
  warningCode: string,
): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      process.emitWarning(warningCode);
    }
  }
}

export function resolveWorkerDirs(options: HaFlowRuntimeOptions): {
  readonly tempRoot: string | null;
  readonly configDir: string;
  readonly depsDir: string;
} {
  const dataRoot = process.env.HAUS_DATA;
  let tempRoot: string | null = null;
  let configDir: string;
  let depsDir: string;
  if (options.configDir && options.depsDir) {
    configDir = resolve(options.configDir);
    depsDir = resolve(options.depsDir);
  } else if (dataRoot) {
    configDir = resolve(options.configDir ?? join(dataRoot, 'ha-flow-config'));
    depsDir = resolve(options.depsDir ?? join(dataRoot, 'ha-deps'));
  } else {
    tempRoot = mkdtempSync(join(tmpdir(), 'haus-ha-flow-'));
    configDir = resolve(options.configDir ?? join(tempRoot, 'config'));
    depsDir = resolve(options.depsDir ?? join(tempRoot, 'deps'));
  }
  mkdirSync(configDir, { recursive: true });
  mkdirSync(depsDir, { recursive: true });
  return { tempRoot, configDir, depsDir };
}

export function buildWorkerRpcError(raw: unknown): HaFlowWorkerError {
  const errObj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return new HaFlowWorkerError(String(errObj.message ?? 'Unknown HA flow worker error'), {
    code: typeof errObj.code === 'string' ? errObj.code : 'worker_error',
    domain: typeof errObj.domain === 'string' ? errObj.domain : undefined,
    missingRequirements: Array.isArray(errObj.missingRequirements)
      ? errObj.missingRequirements.map(String)
      : undefined,
    traceback: typeof errObj.traceback === 'string' ? errObj.traceback : undefined,
  });
}

export function resolveWorkerScriptPath(metaUrl: string): string {
  const here = dirname(fileURLToPath(metaUrl));
  const local = join(here, 'worker.py');
  if (existsSync(local)) return local;
  const fromSrc = resolve(here, '..', '..', 'src', 'ha-flow', 'worker.py');
  return existsSync(fromSrc) ? fromSrc : local;
}

export function resolveDefaultPythonBin(metaUrl: string, explicit?: string): string {
  if (explicit) return explicit;
  const envBin = process.env.HAUS_HA_PYTHON;
  if (envBin && existsSync(envBin)) return envBin;

  const candidates = [
    '/opt/ha-venv/bin/python',
    resolve(process.cwd(), '.venv', 'bin', 'python'),
    resolve(process.cwd(), '..', '..', '.venv', 'bin', 'python'),
    resolve(dirname(fileURLToPath(metaUrl)), '..', '..', '..', '..', '.venv', 'bin', 'python'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? 'python3';
}
