/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type {
  HacsEntityPayload,
  HacsEntityUpdatePayload,
  HacsServiceCallPayload,
} from './types.js';

export interface PythonSidecarOptions {
  pythonPath?: string;
  maxMemoryMb?: number;
  maxCpuSec?: number;
  harnessPath?: string;
}

export class PythonSidecarHarness extends EventEmitter {
  private child?: ChildProcess;
  private reqCounter = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private lineBuffer = '';

  constructor(private readonly options: PythonSidecarOptions = {}) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    const pythonPath = this.options.pythonPath ?? 'python3';
    let harnessPath = this.options.harnessPath;
    if (!harnessPath) {
      const candidates = [
        join(dirname(fileURLToPath(import.meta.url)), 'harness.py'),
        join(dirname(fileURLToPath(import.meta.url)), '../../src/hacs/harness.py'),
        resolve('packages/kitsune/src/hacs/harness.py'),
      ];
      harnessPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
    }

    const env = {
      ...process.env,
      HAUS_PYTHON_MAX_MEM_MB: (this.options.maxMemoryMb ?? 512).toString(),
      HAUS_PYTHON_MAX_CPU_SEC: (this.options.maxCpuSec ?? 120).toString(),
    };

    const child = spawn(pythonPath, [harnessPath], {
      env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString('utf-8');
      const lines = this.lineBuffer.split('\n');
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line.trim());
          this.handleIncoming(msg);
        } catch {
          // ignore malformed lines
        }
      }
    });

    child.on('error', (err) => {
      this.emit('error', err);
      this.rejectAllPending(err);
    });

    child.on('exit', (code, signal) => {
      this.child = undefined;
      const err = new Error(`Python sidecar exited: code=${code} signal=${signal}`);
      this.rejectAllPending(err);
      this.emit('exit', { code, signal });
    });

    // Verify sidecar responds to ping
    await this.sendRequest('ping', {}, 15000);
  }

  private handleIncoming(msg: Record<string, unknown>): void {
    if (typeof msg.id === 'number' && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        const errorMsg =
          typeof msg.error === 'object' && msg.error !== null && 'message' in msg.error
            ? String((msg.error as Record<string, unknown>).message)
            : 'Unknown RPC error';
        pending.reject(new Error(errorMsg));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (msg.method && typeof msg.method === 'string') {
      const params = (msg.params as Record<string, unknown>) ?? {};
      switch (msg.method) {
        case 'entity_added':
          this.emit('entity_added', params as unknown as HacsEntityPayload);
          break;
        case 'entity_updated':
          this.emit('entity_updated', params as unknown as HacsEntityUpdatePayload);
          break;
        case 'issue_created':
          this.emit('issue_created', params);
          break;
        case 'persistent_notification':
          this.emit('persistent_notification', params);
          break;
      }
    }
  }

  sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000,
  ): Promise<T> {
    const childStdin = this.child?.stdin;
    if (!childStdin || childStdin.destroyed) {
      return Promise.reject(new Error('Python sidecar not running'));
    }

    const id = ++this.reqCounter;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        const err = new Error(
          timeoutMs >= 30000 ? 'SETUP_TIMEOUT' : `Request timeout for ${method}`,
        );
        reject(err);
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (val) => resolve(val as T),
        reject,
        timer,
      });

      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      childStdin.write(payload, 'utf-8', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  async setupEntry(
    domain: string,
    entryId: string,
    data: Record<string, unknown>,
    options: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<unknown> {
    return this.sendRequest('setup_entry', { domain, entryId, data, options }, timeoutMs);
  }

  async registerEntity(payload: HacsEntityPayload): Promise<unknown> {
    return this.sendRequest('register_entity', payload as unknown as Record<string, unknown>);
  }

  async callService(payload: HacsServiceCallPayload): Promise<unknown> {
    return this.sendRequest('call_service', payload as unknown as Record<string, unknown>);
  }

  async unloadEntry(entryId: string): Promise<unknown> {
    return this.sendRequest('unload_entry', { entryId });
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.rejectAllPending(new Error('Python sidecar stopped'));
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
