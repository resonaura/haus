/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), 'expected an object report');
  return value;
}
export function rows(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value) && value.every(isRecord), 'expected object rows');
  return value;
}
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== undefined && value !== null, 'expected fixture value');
  return value;
}
interface Snapshot extends Record<string, unknown> {
  sampledAt: string;
  release: string;
  platform: string;
  cpu: Record<string, unknown>;
  memory: Record<string, unknown>;
  disks: Record<string, unknown>[];
}
function isSnapshot(value: unknown): value is Snapshot {
  return (
    isRecord(value) &&
    typeof value.sampledAt === 'string' &&
    typeof value.release === 'string' &&
    typeof value.platform === 'string' &&
    isRecord(value.cpu) &&
    isRecord(value.memory) &&
    Array.isArray(value.disks) &&
    value.disks.every(isRecord)
  );
}
export function snapshot(value: unknown): Snapshot {
  assert.ok(isSnapshot(value), 'expected complete host metadata');
  return value;
}
export interface Invocation {
  file: string;
  args: string[];
  options: Record<string, unknown>;
}
export function encodedScript(args: string[]): string {
  const encoded = args.at(-1);
  assert.ok(encoded, 'expected an encoded read-only command');
  return Buffer.from(encoded, 'base64').toString('utf16le');
}
