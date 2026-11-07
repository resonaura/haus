/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { record } from '../../nvr/support/values.js';

type LegacyModule = 'backup/backups.mjs' | 'cluster/cluster.mjs' | 'recorder.mjs' | 'config.mjs';

/** Temporary test boundary until P14.3–P14.5 replace the actual runtime implementations. */
export async function loadLegacy(file: LegacyModule): Promise<Record<string, unknown>> {
  const value: unknown = await import(new URL('../../../lib/' + file, import.meta.url).href);
  return record(value);
}

export function construct(
  module: Record<string, unknown>,
  name: string,
  args: unknown[],
): Record<string, unknown> {
  const constructor = module[name];
  assert.ok(typeof constructor === 'function', 'missing legacy constructor: ' + name);
  const value: unknown = Reflect.construct(constructor, args);
  return record(value);
}

export function invoke(
  receiver: Record<string, unknown>,
  name: string,
  ...args: unknown[]
): unknown {
  const method = receiver[name];
  assert.ok(typeof method === 'function', 'missing legacy method: ' + name);
  const result: unknown = Reflect.apply(method, receiver, args);
  return result;
}

export function records(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(record);
}
