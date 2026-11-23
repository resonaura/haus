/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  HaDiscoveryTriggerResult,
  HaEntityImageResult,
  HaFlowHealth,
  HaFlowProgressItem,
  HaFlowRuntimeOptions,
  HaFlowStepEnvelope,
  HaRuntimeEntity,
  HaRuntimeEvent,
  HaSyncCredentialInput,
  HaSyncStateInput,
  HaEntitySnapshot,
  HaEntryImport,
  HaUpdateReleaseNotesResult,
} from './types.js';
import {
  buildWorkerEnv,
  buildWorkerRpcError,
  HaFlowWorkerError,
  notifyListeners,
  resolveDefaultPythonBin,
  resolveWorkerDirs,
  resolveWorkerScriptPath,
} from './worker-env.js';

export { HaFlowWorkerError };

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
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
  private readonly eventListeners = new Set<(event: HaRuntimeEvent) => void>();
  private readonly entityStateListeners = new Set<(entities: readonly HaRuntimeEntity[]) => void>();
  private readonly workerExitListeners = new Set<(reason: string) => void>();
  private readonly stderrListeners = new Set<(line: string) => void>();
  private stderrTail: string[] = [];
  private ready = false;
  private disposed = false;

  constructor(options: HaFlowRuntimeOptions = {}) {
    this.options = options;
    this.pythonBin = resolveDefaultPythonBin(import.meta.url, options.pythonBin);
    this.workerScript = resolveWorkerScriptPath(import.meta.url);
    const dirs = resolveWorkerDirs(options);
    this.tempRoot = dirs.tempRoot;
    this.configDir = dirs.configDir;
    this.depsDir = dirs.depsDir;
  }

  isRunning(): boolean {
    return this.child !== null && !this.disposed;
  }

  onEvent(listener: (event: HaRuntimeEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onEntityStates(listener: (entities: readonly HaRuntimeEntity[]) => void): () => void {
    this.entityStateListeners.add(listener);
    return () => this.entityStateListeners.delete(listener);
  }

  onWorkerExit(listener: (reason: string) => void): () => void {
    this.workerExitListeners.add(listener);
    return () => this.workerExitListeners.delete(listener);
  }

  onWorkerStderr(listener: (line: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  private async ensureStarted(): Promise<void> {
    if (this.disposed) {
      throw new HaFlowWorkerError('HaFlowRuntime has been disposed', { code: 'disposed' });
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
    const scratch = mkdtempSync(join(tmpdir(), 'haus-ha-worker-'));
    const env = buildWorkerEnv(this.options, scratch);

    this.stderrTail = [];
    const child = spawn(this.pythonBin, [this.workerScript, this.configDir, this.depsDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    child.once('close', () => {
      try {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        process.emitWarning('Could not remove the HA flow worker scratch directory.');
      }
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
        if (line.trim()) {
          notifyListeners(this.stderrListeners, line, 'ha_flow_stderr_listener_failed');
        }
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
        const wasCurrent = this.child === child;
        if (wasCurrent) {
          this.child = null;
          this.startPromise = null;
          this.ready = false;
        }
        const reason = String(code ?? signal ?? 'unknown');
        const tail = this.stderrTail.slice(-10).join('\n');
        const exitErr = new HaFlowWorkerError(
          `HA flow worker exited (${reason})${tail ? `: ${tail}` : ''}`,
          { code: 'worker_exited' },
        );
        if (!readySettled) {
          readySettled = true;
          clearTimeout(readyTimer);
          rejectReady(exitErr);
        }
        failPending(exitErr);
        if (wasCurrent && !this.disposed) {
          notifyListeners(this.workerExitListeners, reason, 'ha_flow_exit_listener_failed');
        }
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
            this.ready = true;
            clearTimeout(readyTimer);
            resolveReady();
          }
          return;
        }
        if (msg.event === 'ha_event' && msg.payload && typeof msg.payload === 'object') {
          notifyListeners(
            this.eventListeners,
            msg.payload as HaRuntimeEvent,
            'ha_flow_event_listener_failed',
          );
          return;
        }
        if (msg.event === 'entity_states' && msg.payload && typeof msg.payload === 'object') {
          const entities = (msg.payload as { entities?: unknown }).entities;
          if (Array.isArray(entities) && entities.length > 0) {
            notifyListeners(
              this.entityStateListeners,
              entities as HaRuntimeEntity[],
              'ha_flow_state_listener_failed',
            );
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

        entry.reject(buildWorkerRpcError(msg.error));
      });
    });
  }

  private async call<T>(cmd: string, params: object = {}, timeoutMs?: number): Promise<T> {
    await this.ensureStarted();
    const child = this.child;
    if (!child || !child.stdin.writable) {
      throw new HaFlowWorkerError('HA flow worker stdin is not writable', { code: 'not_running' });
    }
    return this.dispatchRpc<T>(child, cmd, params, timeoutMs);
  }

  private dispatchRpc<T>(
    child: ChildProcessWithoutNullStreams,
    cmd: string,
    params: object = {},
    timeoutMs?: number,
  ): Promise<T> {
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

  listFlowHandlers(): Promise<{ readonly handlers: readonly string[] }> {
    return this.call('list_flow_handlers');
  }

  reloadCustomComponents(): Promise<{
    readonly handlers: readonly string[];
    readonly customDomains: readonly string[];
  }> {
    return this.call('reload_custom_components');
  }

  setupEntry(entryId: string): Promise<{ ok: boolean; state?: string }> {
    return this.call('setup_entry', { entryId }, 10_000);
  }
  unloadEntry(entryId: string): Promise<{ ok: boolean }> {
    return this.call('unload_entry', { entryId }, 15_000);
  }
  entitySnapshot(since = 0): Promise<HaEntitySnapshot> {
    return this.call('entity_snapshot', { since }, 15_000);
  }
  hueSceneDiagnostics(entryId: string): Promise<{ data: Record<string, unknown> }> {
    return this.call('hue_scene_diagnostics', { entryId });
  }
  entityImage(entityId: string): Promise<HaEntityImageResult> {
    return this.call('entity_image', { entityId }, 15_000);
  }
  updateReleaseNotes(entityId: string): Promise<HaUpdateReleaseNotesResult> {
    return this.call('update_release_notes', { entityId }, 15_000);
  }
  importEntry(input: HaEntryImport): Promise<{ entryId: string; domain: string }> {
    return this.call('import_entry', input);
  }

  entityCommand(
    entryId: string,
    entityId: string,
    service: string,
    data: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ ok: boolean }> {
    const interactive = /^(?:light|switch|fan|cover|lock|input_boolean|button)\./.test(entityId);
    const defaultTimeoutMs = entityId.startsWith('update.') ? 60_000 : interactive ? 3_000 : 15_000;
    const effectiveTimeoutMs =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultTimeoutMs;
    return this.call(
      'entity_command',
      { entryId, entityId, service, data, timeoutMs: effectiveTimeoutMs },
      Math.max(2_000, effectiveTimeoutMs + 1_500),
    );
  }

  removeEntry(entryId: string): Promise<{ removed: boolean }> {
    return this.call('remove_entry', { entryId });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const wasReady = this.ready;
    this.ready = false;
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
              forceTimer.unref();
              activeChild.once('exit', () => {
                clearTimeout(forceTimer);
                resolveExit();
              });
            });

      if (wasReady && activeChild.stdin.writable) {
        try {
          await this.dispatchRpc<{ shutdown: boolean }>(activeChild, 'shutdown', {}, 2_000);
        } catch {
          activeChild.kill('SIGTERM');
        }
      } else {
        activeChild.kill('SIGTERM');
      }
      await waitForExit;
    }
    this.eventListeners.clear();
    this.entityStateListeners.clear();
    this.workerExitListeners.clear();
    this.stderrListeners.clear();
    this.rl?.close();
    this.rl = null;
    this.child = null;
    this.startPromise = null;
    if (this.tempRoot) {
      rmSync(this.tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
