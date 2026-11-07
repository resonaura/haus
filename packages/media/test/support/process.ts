/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { ChildProcess, spawn, type SpawnOptions } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
export class ProcessFixture extends ChildProcess {
  override exitCode: number | null = null;
  override stdin = new PassThrough();
  override stdout = new PassThrough();
  override stderr = new PassThrough();
  override kill(): boolean {
    this.exitCode = 0;
    queueMicrotask(() => this.emit('close', 0));
    return true;
  }
}
export function spawnFixture(
  factory: (file: string, args: string[], options?: SpawnOptions) => ChildProcess = () =>
    new ProcessFixture(),
): typeof spawn {
  const port = { spawn };
  vi.spyOn(port, 'spawn').mockImplementation((file, args, options) => {
    assert.ok(Array.isArray(args));
    return factory(file, args, options);
  });
  return port.spawn;
}

export async function stopProcess(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.kill('SIGKILL');
  await closed;
}

/** Reclaim every fixture resource and report cleanup failures instead of hiding them. */
export async function cleanup(...actions: Array<() => unknown | Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'media_fixture_cleanup_failed');
}
