/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import type { Server } from 'node:net';
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'expected fixture value'); return value;
}
export function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value)); return value;
}
export function port(server: Server): number {
  const address = server.address(); assert.ok(address && typeof address !== 'string'); return address.port;
}
export function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve: (value: T) => required(resolve)(value) };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export function identifier(value: unknown): string { assert.ok(typeof value === 'string'); return value; }
