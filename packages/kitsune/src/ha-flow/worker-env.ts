/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
