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
  override kill(): boolean { this.exitCode=0; queueMicrotask(()=>this.emit('close',0)); return true; }
}
export function spawnFixture(factory: (file: string,args: string[],options?: SpawnOptions) => ChildProcess = () => new ProcessFixture()): typeof spawn {
  const port={spawn};
  vi.spyOn(port,'spawn').mockImplementation((file,args,options)=>{assert.ok(Array.isArray(args));return factory(file,args,options);});
  return port.spawn;
}
