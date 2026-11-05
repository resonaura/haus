/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export interface AdapterLimitConfig {
  readonly maxConcurrency?: number;
  readonly minIntervalMs?: number;
  readonly defaultTimeoutMs?: number;
}

export interface BoundedTask<T = unknown> {
  readonly id: string;
  readonly endpointId: string;
  readonly adapterId?: string;
  readonly dependencies?: readonly string[];
  readonly timeoutMs?: number;
  readonly run: (signal: AbortSignal) => Promise<T>;
}

export interface BoundedExecutionResult<T = unknown> {
  readonly id: string;
  readonly endpointId: string;
  readonly status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  readonly durationMs: number;
  readonly value?: T;
  readonly error?: string;
}

export interface AggregateExecutionReport {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly timedOut: number;
  readonly status: 'completed' | 'partial' | 'failed' | 'cancelled';
  readonly durationMs: number;
  readonly results: readonly BoundedExecutionResult[];
}

export class AdapterConcurrencyLimiter {
  private readonly adapterConfigs = new Map<string, AdapterLimitConfig>();
  private readonly activePerAdapter = new Map<string, number>();
  private readonly lastDispatchPerAdapter = new Map<string, number>();
  private readonly endpointQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly defaultConfig: AdapterLimitConfig = {
      maxConcurrency: 5,
      minIntervalMs: 10,
      defaultTimeoutMs: 5000,
    },
  ) {}

  setAdapterConfig(adapterId: string, config: AdapterLimitConfig): void {
    this.adapterConfigs.set(adapterId, config);
  }

  private getConfig(adapterId: string): AdapterLimitConfig {
    const custom = this.adapterConfigs.get(adapterId);
    return {
      maxConcurrency: custom?.maxConcurrency ?? this.defaultConfig.maxConcurrency ?? 5,
      minIntervalMs: custom?.minIntervalMs ?? this.defaultConfig.minIntervalMs ?? 0,
      defaultTimeoutMs: custom?.defaultTimeoutMs ?? this.defaultConfig.defaultTimeoutMs ?? 5000,
    };
  }

  private async acquireAdapterSlot(adapterId: string, signal?: AbortSignal): Promise<void> {
    const config = this.getConfig(adapterId);
    const maxConcurrency = config.maxConcurrency ?? 5;
    const minIntervalMs = config.minIntervalMs ?? 0;

    while (true) {
      if (signal?.aborted) throw new Error('Action was cancelled.');

      const currentActive = this.activePerAdapter.get(adapterId) ?? 0;
      if (currentActive < maxConcurrency) {
        // Check pacing/interval
        if (minIntervalMs > 0) {
          const last = this.lastDispatchPerAdapter.get(adapterId) ?? 0;
          const elapsed = Date.now() - last;
          if (elapsed < minIntervalMs) {
            await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
            continue;
          }
        }

        this.activePerAdapter.set(adapterId, currentActive + 1);
        this.lastDispatchPerAdapter.set(adapterId, Date.now());
        return;
      }

      // Slot full: wait briefly and retry
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private releaseAdapterSlot(adapterId: string): void {
    const current = this.activePerAdapter.get(adapterId) ?? 1;
    this.activePerAdapter.set(adapterId, Math.max(0, current - 1));
  }

  async executeTask<T>(
    task: BoundedTask<T>,
    signal?: AbortSignal,
  ): Promise<BoundedExecutionResult<T>> {
    const adapterId = task.adapterId ?? 'default';
    const config = this.getConfig(adapterId);
    const timeoutMs = task.timeoutMs ?? config.defaultTimeoutMs ?? 5000;
    const start = Date.now();

    if (signal?.aborted) {
      return {
        id: task.id,
        endpointId: task.endpointId,
        status: 'cancelled',
        durationMs: 0,
        error: 'Execution cancelled before dispatch.',
      };
    }

    // Preserve order for dependent actions targeting the same endpoint
    const previousQueue = this.endpointQueues.get(task.endpointId) ?? Promise.resolve();

    let resolveQueueEntry!: () => void;
    const currentQueueEntry = new Promise<void>((r) => {
      resolveQueueEntry = r;
    });
    this.endpointQueues.set(task.endpointId, currentQueueEntry);

    try {
      await previousQueue;

      if (signal?.aborted) {
        return {
          id: task.id,
          endpointId: task.endpointId,
          status: 'cancelled',
          durationMs: Date.now() - start,
          error: 'Execution cancelled while waiting in queue.',
        };
      }

      await this.acquireAdapterSlot(adapterId, signal);

      try {
        const timeoutCtrl = new AbortController();
        let isTimedOut = false;
        const timer = setTimeout(() => {
          isTimedOut = true;
          timeoutCtrl.abort();
        }, timeoutMs);

        const onParentAbort = () => timeoutCtrl.abort();
        signal?.addEventListener('abort', onParentAbort, { once: true });

        try {
          const value = await task.run(timeoutCtrl.signal);
          return {
            id: task.id,
            endpointId: task.endpointId,
            status: 'completed',
            durationMs: Date.now() - start,
            value,
          };
        } catch (err) {
          if (isTimedOut) {
            return {
              id: task.id,
              endpointId: task.endpointId,
              status: 'timed_out',
              durationMs: Date.now() - start,
              error: `Task timed out after ${timeoutMs}ms.`,
            };
          }
          if (signal?.aborted) {
            return {
              id: task.id,
              endpointId: task.endpointId,
              status: 'cancelled',
              durationMs: Date.now() - start,
              error: 'Task was cancelled.',
            };
          }
          return {
            id: task.id,
            endpointId: task.endpointId,
            status: 'failed',
            durationMs: Date.now() - start,
            error: String(err),
          };
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onParentAbort);
        }
      } finally {
        this.releaseAdapterSlot(adapterId);
      }
    } finally {
      resolveQueueEntry();
    }
  }

  async executeBatch<T>(
    tasks: readonly BoundedTask<T>[],
    signal?: AbortSignal,
  ): Promise<AggregateExecutionReport> {
    const start = Date.now();
    const completedResults: BoundedExecutionResult[] = [];
    const completedTaskIds = new Set<string>();

    const pending = [...tasks];
    const running = new Set<Promise<void>>();

    while (pending.length > 0 || running.size > 0) {
      if (signal?.aborted) {
        // Drain pending tasks as cancelled
        for (const remaining of pending) {
          completedResults.push({
            id: remaining.id,
            endpointId: remaining.endpointId,
            status: 'cancelled',
            durationMs: 0,
            error: 'Batch was cancelled.',
          });
        }
        pending.length = 0;
        await Promise.allSettled(running);
        break;
      }

      // Find tasks whose dependencies are met and maintain FIFO order
      const readyTasks: BoundedTask<T>[] = [];
      const remaining: BoundedTask<T>[] = [];
      for (let i = 0; i < pending.length; i++) {
        const candidate = pending[i];
        if (!candidate) continue;
        const depsMet =
          !candidate.dependencies || candidate.dependencies.every((d) => completedTaskIds.has(d));
        if (depsMet) {
          readyTasks.push(candidate);
        } else {
          remaining.push(candidate);
        }
      }

      if (readyTasks.length === 0 && running.size === 0 && remaining.length > 0) {
        // Circular dependency or unmet requirement: mark remaining as failed
        for (const orphan of remaining) {
          completedResults.push({
            id: orphan.id,
            endpointId: orphan.endpointId,
            status: 'failed',
            durationMs: 0,
            error: 'Unresolvable task dependency.',
          });
        }
        break;
      }

      pending.length = 0;
      pending.push(...remaining);

      // Launch ready tasks in forward FIFO order
      for (const task of readyTasks) {
        const p: Promise<void> = (async () => {
          const res = await this.executeTask(task, signal);
          completedResults.push(res);
          completedTaskIds.add(task.id);
        })().finally(() => {
          running.delete(p);
        });

        running.add(p);
      }

      if (running.size > 0) {
        await Promise.race(running);
      }
    }

    const durationMs = Date.now() - start;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let timedOut = 0;

    for (const res of completedResults) {
      switch (res.status) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
        case 'timed_out':
          timedOut++;
          break;
      }
    }

    let overallStatus: AggregateExecutionReport['status'] = 'completed';
    if (cancelled > 0 && completed === 0) {
      overallStatus = 'cancelled';
    } else if (failed > 0 || timedOut > 0 || cancelled > 0) {
      overallStatus = completed > 0 ? 'partial' : 'failed';
    }

    return {
      total: completedResults.length,
      completed,
      failed,
      cancelled,
      timedOut,
      status: overallStatus,
      durationMs,
      results: completedResults,
    };
  }
}
