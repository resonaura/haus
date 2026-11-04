/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Diagnostic, KitsuneEvent } from '../contracts.js';
import type { InstalledPlugin } from './installer.js';
import { webhookToken, protectedEndpoint } from './webhooks.js';

export interface RuntimeOptions {
  dataDirectory: string;
  endpointBase: string;
  publicEndpointBase?: string;
  ffmpegPath: string;
  memoryMb?: number;
  maxPlugins?: number;
  diagnostic: (event: Diagnostic) => void;
  emit: (event: KitsuneEvent) => void;
}
export class PluginProcess extends EventEmitter {
  private child?: ChildProcess;
  private counter = 0;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >();
  constructor(
    readonly plugin: InstalledPlugin,
    private readonly options: RuntimeOptions,
  ) {
    super();
  }
  async start() {
    if (this.child) throw Error('kitsune_plugin_already_running');
    const memory = this.options.memoryMb ?? 192;
    if (!Number.isInteger(memory) || memory < 64 || memory > 4096)
      throw Error('kitsune_invalid_memory_budget');
    const volume = join(
      this.options.dataDirectory,
      'kitsune',
      'state',
      createHash('sha256').update(this.plugin.name).digest('hex'),
    );
    await mkdir(volume, { recursive: true, mode: 0o700 });
    const env: NodeJS.ProcessEnv = { HAUS_KITSUNE_CHILD: '1', SCRYPTED_PLUGIN_VOLUME: volume };
    for (const key of ['PATH', 'LANG', 'TMPDIR', 'TEMP', 'SYSTEMROOT', 'WINDIR'])
      if (process.env[key]) env[key] = process.env[key];
    const token = webhookToken(this.options.dataDirectory, this.plugin.name);
    const child = fork(
      join(dirname(fileURLToPath(import.meta.url)), 'child.js'),
      [
        this.plugin.name,
        join(this.plugin.directory, this.plugin.entry),
        volume,
        protectedEndpoint(this.options.endpointBase, token),
        this.options.ffmpegPath,
        this.options.publicEndpointBase
          ? protectedEndpoint(this.options.publicEndpointBase, token)
          : '',
        JSON.stringify(this.plugin.rootDevice ?? { name: this.plugin.name, interfaces: [] }),
      ],
      {
        cwd: this.plugin.directory,
        env,
        serialization: 'advanced',
        execArgv: [`--max-old-space-size=${memory}`],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        reject(Error('kitsune_plugin_start_timeout'));
        void this.stop();
      }, 30000);
      const fail = () => {
        clearTimeout(timeout);
        if (!ready) reject(Error('kitsune_plugin_start_failed'));
        this.rejectPending();
        if (this.child === child) this.child = undefined;
        this.emit('stopped');
      };
      child.once('error', fail);
      child.once('exit', fail);
      child.on('message', (input: unknown) => {
        const message = input as {
          type?: string;
          id?: number;
          error?: string;
          result?: unknown;
          event?: KitsuneEvent;
          diagnostic?: Diagnostic;
        };
        if (message.type === 'ready') {
          ready = true;
          clearTimeout(timeout);
          resolve();
        } else if (message.type === 'failed') {
          reject(Error('kitsune_plugin_start_failed'));
          void this.stop();
        } else if (message.type === 'event' && message.event) this.options.emit(message.event);
        else if (message.type === 'diagnostic' && message.diagnostic)
          this.options.diagnostic(message.diagnostic);
        else if (message.type === 'result' && message.id && this.pending.has(message.id)) {
          const item = this.pending.get(message.id)!;
          this.pending.delete(message.id);
          clearTimeout(item.timer);
          if (message.error) item.reject(Error(message.error));
          else item.resolve(message.result);
        }
      });
    });
  }
  call<T = unknown>(method: string, args: unknown[] = [], deviceId?: string): Promise<T> {
    const child = this.child;
    if (!child?.connected) return Promise.reject(Error('kitsune_plugin_offline'));
    const id = ++this.counter;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('kitsune_plugin_call_timeout'));
      }, 15000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      child.send({ id, method, args, deviceId }, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(Error('kitsune_plugin_offline'));
        }
      });
    });
  }
  private rejectPending() {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error('kitsune_plugin_offline'));
    }
    this.pending.clear();
  }
  async stop() {
    const child = this.child;
    this.child = undefined;
    this.rejectPending();
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
