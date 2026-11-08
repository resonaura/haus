/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export type ServiceState = 'idle' | 'starting' | 'running' | 'stopping' | 'closed' | 'failed';
export interface RunningService {
  close(): Promise<void>;
}
export class ResourceScope {
  private releases: (() => void | Promise<void>)[] = [];
  defer(release: () => void | Promise<void>) {
    this.releases.push(release);
  }
  commit() {
    this.releases = [];
  }
  async close() {
    const errors: unknown[] = [];
    for (const release of this.releases.splice(0).reverse())
      try {
        await release();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length) throw new AggregateError(errors, 'service_cleanup_failed');
  }
}
export type Bootstrap = (context: {
  signal: AbortSignal;
  scope: ResourceScope;
}) => Promise<RunningService>;
/** Owns exactly one start/stop cycle. Concrete applications compose their own bootstraps. */
export class Service {
  private stateValue: ServiceState = 'idle';
  private readonly controller = new AbortController();
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private running?: RunningService;
  private cleanupFailure?: { error: unknown };
  constructor(private readonly bootstrap: Bootstrap) {}
  get state() {
    return this.stateValue;
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.stateValue === 'running') return Promise.resolve();
    if (this.stateValue !== 'idle') return Promise.reject(Error('service_not_startable'));
    this.stateValue = 'starting';
    const scope = new ResourceScope();
    this.starting = Promise.resolve()
      .then(() => this.bootstrap({ signal: this.controller.signal, scope }))
      .then(async (running) => {
        scope.commit();
        if (this.controller.signal.aborted) {
          await this.closeRunning(running);
          throw Error('service_stopped');
        }
        this.running = running;
        this.stateValue = 'running';
      })
      .catch(async (error) => {
        let failure: unknown = error;
        try {
          await scope.close();
        } catch (cleanup) {
          failure = new AggregateError([error, cleanup], 'service_start_failed');
          this.cleanupFailure = { error: failure };
        }
        if (this.stateValue !== 'stopping') this.stateValue = 'failed';
        throw failure;
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.stateValue === 'closed') return Promise.resolve();
    this.stateValue = 'stopping';
    this.stopping = Promise.resolve()
      .then(async () => {
        // Startup reports its own error; only failed cleanup keeps resources owned here.
        await this.starting?.catch(() => {});
        if (this.cleanupFailure) throw this.cleanupFailure.error;
        const running = this.running;
        this.running = undefined;
        if (running) await this.closeRunning(running);
        this.stateValue = 'closed';
      })
      .catch((error: unknown) => {
        this.stateValue = 'failed';
        throw error;
      });
    // Publish the shared close before synchronous abort listeners can reenter stop().
    this.controller.abort();
    return this.stopping;
  }

  private async closeRunning(running: RunningService): Promise<void> {
    try {
      await running.close();
    } catch (error) {
      this.cleanupFailure = { error };
      throw error;
    }
  }
}
