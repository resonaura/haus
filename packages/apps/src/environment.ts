/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest } from './manifest.js';

const RESERVED_ENV = new Set(['SUPERVISOR_API', 'SUPERVISOR_TOKEN']);
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function keyOf(entry: string): string {
  const separator = entry.indexOf('=');
  return separator < 0 ? entry : entry.slice(0, separator);
}

export function buildAppEnvironment(
  manifest: AppManifest,
  runtime: Readonly<Record<string, string>> = {},
): string[] {
  for (const key of Object.keys(runtime)) {
    if (!ENV_KEY.test(key)) throw Error('invalid_runtime_environment_key');
  }

  const runtimeKeys = new Set(Object.keys(runtime));
  const values = new Map<string, string>();
  const add = (key: string, value: string) => {
    if (!ENV_KEY.test(key)) throw Error('invalid_app_environment_key');
    if (RESERVED_ENV.has(key) && !runtimeKeys.has(key))
      throw Error('reserved_app_environment_variable');
    if (RESERVED_ENV.has(key) || runtimeKeys.has(key)) return;
    values.set(key, `${key}=${value}`);
  };

  if (Array.isArray(manifest.env)) {
    for (const entry of manifest.env) {
      const key = keyOf(entry);
      if (!entry.includes('=')) {
        if (!ENV_KEY.test(key)) throw Error('invalid_app_environment_key');
        if (RESERVED_ENV.has(key)) throw Error('reserved_app_environment_variable');
        values.set(key, entry);
        continue;
      }
      add(key, entry.slice(entry.indexOf('=') + 1));
    }
  } else if (manifest.env) {
    for (const [key, value] of Object.entries(manifest.env)) add(key, value);
  }

  for (const [key, value] of Object.entries(runtime)) values.set(key, `${key}=${value}`);
  return Array.from(values.values());
}
