/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type {
  HaDiscoveryTriggerResult,
  HaFlowHealth,
  HaFlowProgressItem,
  HaFlowRuntimeOptions,
  HaFlowStepEnvelope,
  HaSyncCredentialInput,
  HaSyncStateInput,
} from './types.js';

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

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function resolveWorkerScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const local = join(here, 'worker.py');
  if (existsSync(local)) return local;
  const fromSrc = resolve(here, '..', '..', 'src', 'ha-flow', 'worker.py');
  if (existsSync(fromSrc)) return fromSrc;
  return local;
}

function resolveDefaultPythonBin(explicit?: string): string {
  if (explicit) return explicit;
  const envBin = process.env.HAUS_HA_PYTHON;
  if (envBin && existsSync(envBin)) return envBin;

  const candidates = [
    '/opt/ha-venv/bin/python',
    resolve(process.cwd(), '.venv', 'bin', 'python'),
    resolve(process.cwd(), '..', '..', '.venv', 'bin', 'python'),
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '.venv',
      'bin',
      'python',
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return 'python3';
}

export class HaFlowRuntime {
  private readonly options: HaFlowRuntimeOptions;
  private readonly pythonBin: string;
  private readonly workerScript: string;
  private readonly tempRoot: string | null;
  private readonly configDir: string;
  private readonly depsDir: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail: string[] = [];
  private disposed = false;

  constructor(options: HaFlowRuntimeOptions = {}) {
    this.options = options;
    this.pythonBin = resolveDefaultPythonBin(options.pythonBin);
    this.workerScript = resolveWorkerScriptPath();

    const dataRoot = process.env.HAUS_DATA;
    if (options.configDir && options.depsDir) {
      this.tempRoot = null;
      this.configDir = resolve(options.configDir);
      this.depsDir = resolve(options.depsDir);
    } else if (dataRoot) {
      this.tempRoot = null;
      this.configDir = resolve(options.configDir ?? join(dataRoot, 'ha-flow-config'));
      this.depsDir = resolve(options.depsDir ?? join(dataRoot, 'ha-deps'));
    } else {
      this.tempRoot = mkdtempSync(join(tmpdir(), 'haus-ha-flow-'));
      this.configDir = resolve(options.configDir ?? join(this.tempRoot, 'config'));
      this.depsDir = resolve(options.depsDir ?? join(this.tempRoot, 'deps'));
    }

    mkdirSync(this.configDir, { recursive: true });
    mkdirSync(this.depsDir, { recursive: true });
  }

  isRunning(): boolean {
    return this.child !== null && !this.disposed;
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed) {
      throw new HaFlowWorkerError('HaFlowRuntime has been disposed', { code: 'disposed' });
    }
    if (this.child && this.startPromise) {
      await this.startPromise;
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.spawnWorker();
    try {
      await this.startPromise;
    } catch (err) {
      this.startPromise = null;
      throw err;
    }
  }

  private spawnWorker(): Promise<void> {
    const startupTimeoutMs = this.options.startupTimeoutMs ?? 30_000;
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.options.frontendBase) env.HA_FLOW_FRONTEND_BASE = this.options.frontendBase;
    if (this.options.componentsOverlayDir) {
      env.HA_FLOW_COMPONENTS_DIR = this.options.componentsOverlayDir;
    }
    if (this.options.autoInstallReqs !== undefined) {
      env.HAUS_HA_AUTO_INSTALL_REQS = this.options.autoInstallReqs ? 'true' : 'false';
    }
    if (this.options.setupOnCreate !== undefined) {
      env.HA_FLOW_SETUP_ON_CREATE = this.options.setupOnCreate ? 'true' : 'false';
    }

    this.stderrTail = [];
    const child = spawn(this.pythonBin, [this.workerScript, this.configDir, this.depsDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child = child;

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl = rl;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      for (const line of text.split('\n')) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 40) this.stderrTail.shift();
      }
    });

    return new Promise<void>((resolveReady, rejectReady) => {
      let readySettled = false;
      const readyTimer = setTimeout(() => {
        if (readySettled) return;
        readySettled = true;
        child.kill('SIGKILL');
        rejectReady(
          new HaFlowWorkerError(
            `HA flow worker timed out after ${startupTimeoutMs}ms: ${this.stderrTail.join(' | ')}`,
            { code: 'startup_timeout' },
          ),
        );
      }, startupTimeoutMs);

      const failPending = (err: Error) => {
        for (const [id, req] of this.pending.entries()) {
          clearTimeout(req.timer);
          req.reject(err);
          this.pending.delete(id);
        }
      };

      child.on('error', (err) => {
        const wrapped = new HaFlowWorkerError(
          `Failed launching Python HA flow worker (${this.pythonBin}): ${err.message}`,
          { code: 'spawn_error' },
        );
        if (!readySettled) {
          readySettled = true;
          clearTimeout(readyTimer);
          rejectReady(wrapped);
        }
        failPending(wrapped);
      });

      child.on('exit', (code, signal) => {
        this.rl?.close();
        this.rl = null;
        if (this.child === child) {
          this.child = null;
          this.startPromise = null;
        }
        const tail = this.stderrTail.slice(-10).join('\n');
        const exitErr = new HaFlowWorkerError(
          `HA flow worker exited (${code ?? signal})${tail ? `: ${tail}` : ''}`,
          { code: 'worker_exited' },
        );
        if (!readySettled) {
          readySettled = true;
          clearTimeout(readyTimer);
          rejectReady(exitErr);
        }
        failPending(exitErr);
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg.event === 'ready') {
          if (!readySettled) {
            readySettled = true;
            clearTimeout(readyTimer);
            resolveReady();
          }
          return;
        }

        const reqId = typeof msg.id === 'number' ? msg.id : Number(msg.id);
        const entry = this.pending.get(reqId);
        if (!entry) return;
        this.pending.delete(reqId);
        clearTimeout(entry.timer);

        if (msg.ok) {
          entry.resolve(msg.result);
          return;
        }

        const errObj = (msg.error ?? {}) as Record<string, unknown>;
        entry.reject(
          new HaFlowWorkerError(String(errObj.message ?? 'Unknown HA flow worker error'), {
            code: typeof errObj.code === 'string' ? errObj.code : 'worker_error',
            domain: typeof errObj.domain === 'string' ? errObj.domain : undefined,
            missingRequirements: Array.isArray(errObj.missingRequirements)
              ? errObj.missingRequirements.map(String)
              : undefined,
            traceback: typeof errObj.traceback === 'string' ? errObj.traceback : undefined,
          }),
        );
      });
    });
  }

  private async call<T>(cmd: string, params: object = {}, timeoutMs?: number): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new HaFlowWorkerError('HA flow worker stdin is not writable', { code: 'not_running' });
    }
    const id = this.nextId++;
    const effectiveTimeout = timeoutMs ?? this.options.requestTimeoutMs ?? 120_000;

    return new Promise<T>((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(
          new HaFlowWorkerError(`HA flow command '${cmd}' timed out after ${effectiveTimeout}ms`, {
            code: 'request_timeout',
          }),
        );
      }, effectiveTimeout);

      this.pending.set(id, {
        resolve: (value) => resolveCall(value as T),
        reject: rejectCall,
        timer,
      });

      child.stdin.write(`${JSON.stringify({ id, cmd, params })}\n`);
    });
  }

  async health(): Promise<HaFlowHealth> {
    return this.call<HaFlowHealth>('health');
  }

  async syncState(input: HaSyncStateInput): Promise<{ ok: boolean; entriesCount: number }> {
    return this.call<{ ok: boolean; entriesCount: number }>('sync_state', input);
  }

  async initFlow(input: {
    readonly domain: string;
    readonly source?: string;
    readonly entryId?: string;
    readonly flowKind?: 'config' | 'options';
    readonly showAdvancedOptions?: boolean;
    readonly data?: unknown;
  }): Promise<HaFlowStepEnvelope> {
    return this.call<HaFlowStepEnvelope>('flow_init', input);
  }

  async configureFlow(input: {
    readonly flowId: string;
    readonly userInput?: Record<string, unknown>;
    readonly flowKind?: 'config' | 'options';
  }): Promise<HaFlowStepEnvelope> {
    return this.call<HaFlowStepEnvelope>('flow_configure', input);
  }

  async getFlow(flowId: string, flowKind?: 'config' | 'options'): Promise<HaFlowStepEnvelope> {
    return this.call<HaFlowStepEnvelope>('flow_get', { flowId, flowKind });
  }

  async abortFlow(flowId: string, flowKind?: 'config' | 'options'): Promise<{ aborted: boolean }> {
    return this.call<{ aborted: boolean }>('flow_abort', { flowId, flowKind });
  }

  async listProgressFlows(): Promise<{ readonly flows: readonly HaFlowProgressItem[] }> {
    return this.call<{ readonly flows: readonly HaFlowProgressItem[] }>('flow_progress');
  }

  async completeExternal(input: {
    readonly flowId?: string;
    readonly state?: unknown;
    readonly code?: string;
    readonly error?: string;
  }): Promise<HaFlowStepEnvelope> {
    return this.call<HaFlowStepEnvelope>('external_complete', input);
  }

  async triggerDiscovery(input: {
    readonly domain: string;
    readonly protocol: string;
    readonly info: Record<string, unknown>;
    readonly discoveryKey?: string;
  }): Promise<HaDiscoveryTriggerResult> {
    return this.call<HaDiscoveryTriggerResult>('discovery_trigger', input);
  }

  async uploadFile(
    filename: string,
    contentBase64: string,
  ): Promise<{ fileId: string; filename: string }> {
    return this.call<{ fileId: string; filename: string }>('upload_file', {
      filename,
      contentBase64,
    });
  }

  async listApplicationCredentials(): Promise<{
    readonly items: readonly Record<string, unknown>[];
  }> {
    return this.call<{ readonly items: readonly Record<string, unknown>[] }>(
      'application_credentials_list',
    );
  }

  async addApplicationCredential(input: HaSyncCredentialInput): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>('application_credentials_add', input);
  }

  async getTranslations(input: {
    readonly language?: string;
    readonly categories?: readonly string[];
    readonly integrations?: readonly string[];
  }): Promise<{ readonly translations: Readonly<Record<string, string>> }> {
    return this.call<{ readonly translations: Readonly<Record<string, string>> }>(
      'get_translations',
      input,
    );
  }

  async listFlowHandlers(): Promise<{ readonly handlers: readonly string[] }> {
    return this.call<{ readonly handlers: readonly string[] }>('list_flow_handlers');
  }

  async setupEntry(entryId: string): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>('setup_entry', { entryId });
  }

  async removeEntry(entryId: string): Promise<{ removed: boolean }> {
    return this.call<{ removed: boolean }>('remove_entry', { entryId });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    const activeChild = this.child;
    if (activeChild) {
      const waitForExit =
        activeChild.exitCode !== null || activeChild.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolveExit) => {
              const forceTimer = setTimeout(() => {
                activeChild.kill('SIGKILL');
                resolveExit();
              }, 3_000);
              activeChild.once('exit', () => {
                clearTimeout(forceTimer);
                resolveExit();
              });
            });

      if (activeChild.stdin.writable) {
        try {
          await this.call<{ shutdown: boolean }>('shutdown', {}, 4_000);
        } catch {
          activeChild.kill('SIGTERM');
        }
      } else {
        activeChild.kill('SIGTERM');
      }
      await waitForExit;
    }
    this.disposed = true;
    this.rl?.close();
    this.rl = null;
    this.child = null;
    this.startPromise = null;
    if (this.tempRoot) {
      rmSync(this.tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
