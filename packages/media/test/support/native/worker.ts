/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { setTimeout as pause } from 'node:timers/promises';
import { MediaRuntime } from '../../../src/pipeline/tools.js';
import { asEvent } from '../../../src/stream/native-args.js';
import type { NativeMediaEvent } from '../../../src/stream/native-types.js';
import { required } from '../values.js';

export const binary = process.env.HAUS_CAMERA_MEDIA_BIN;

/** Owns one isolated native IPC child and fails loudly on malformed fixture output. */
export class NativeWorker {
  readonly child = new MediaRuntime({ tools: { camera: required(binary) } }).spawn('camera', [], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  readonly events: NativeMediaEvent[] = [];
  private pending = '';
  private failure?: Error;
  private closed = false;
  private readonly exited: Promise<void>;
  private stopping?: Promise<void>;

  constructor() {
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        this.closed = true;
        resolve();
      }),
    );
    this.child.once('error', (error) => {
      this.failure = error;
    });
    required(this.child.stdout).on('data', (chunk: Buffer) => {
      try {
        this.pending += chunk.toString('utf8');
        if (this.pending.length > 256 * 1024) throw Error('native_fixture_output_overflow');
        for (;;) {
          const end = this.pending.indexOf('\n');
          if (end < 0) return;
          const line = this.pending.slice(0, end);
          this.pending = this.pending.slice(end + 1);
          const value: unknown = JSON.parse(line);
          const event = asEvent(value);
          if (!event) throw Error('invalid_native_fixture_event');
          if (this.events.length >= 2048) throw Error('native_fixture_event_overflow');
          this.events.push(event);
        }
      } catch (error) {
        this.failure = error instanceof Error ? error : Error('invalid_native_fixture_output');
        this.child.kill('SIGKILL');
      }
    });
  }

  send(command: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw Error('native_fixture_exited');
    required(this.child.stdin).write(`${JSON.stringify(command)}\n`);
  }

  async waitFor(
    match: string | ((event: NativeMediaEvent) => boolean),
    timeout = 5000,
  ): Promise<NativeMediaEvent> {
    const predicate =
      typeof match === 'string' ? (event: NativeMediaEvent) => event.event === match : match;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (this.failure) throw this.failure;
      const found = this.events.find(predicate);
      if (found) return found;
      if (this.closed) throw Error('native_fixture_exited');
      await pause(10);
    }
    throw Error(`native_fixture_event_timeout: ${typeof match === 'string' ? match : 'predicate'}`);
  }

  event(name: string): Promise<NativeMediaEvent> {
    return this.waitFor(name);
  }

  close(): Promise<void> {
    this.stopping ??= this.stop();
    return this.stopping;
  }

  private async stop(): Promise<void> {
    if (!this.closed) {
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 5000);
      try {
        if (this.failure) this.child.kill('SIGKILL');
        else this.send({ cmd: 'exit' });
        await this.exited;
      } finally {
        clearTimeout(timer);
      }
    }
    if (this.failure) throw this.failure;
  }
}

export const nativeWorker = () => new NativeWorker();
