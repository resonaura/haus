/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Command } from '@haus/core/types';
import type { CommandProvider } from '@haus/core/command';
import type {
  IntegrationRef,
  OwnedCredentials,
  RefreshProvider,
  SessionGrant,
} from '@haus/core/session';
import type { IntegrationProvider } from './types.js';

/** Local admission closes synchronously; the durable owner is released only after actual drainage. */
export class ProviderGate<Credential> implements CommandProvider, RefreshProvider<Credential> {
  readonly resource: IntegrationRef;
  private readonly controller = new AbortController();
  private readonly tasks = new Set<Promise<unknown>>();
  private closing?: Promise<void>;

  constructor(
    private readonly grant: SessionGrant,
    private readonly credentials: OwnedCredentials<Credential>,
    private readonly provider: IntegrationProvider<Credential>,
    private readonly timeoutMs: number,
  ) {
    this.resource = { ...grant.resource };
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('invalid_provider_timeout');
  }

  open(): Promise<void> {
    const timeout = new AbortController(),
      timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    return this.credentials
      .use(this.grant, (credential) =>
        this.invoke(timeout.signal, (signal) => this.provider.open(credential, signal)),
      )
      .finally(() => clearTimeout(timer));
  }

  execute(command: Command, signal: AbortSignal) {
    return this.credentials.use(this.grant, (credential) =>
      this.invoke(signal, (signal) => this.provider.execute(command, credential, signal)),
    );
  }

  refresh(credential: Credential, signal: AbortSignal) {
    return this.invoke(signal, (signal) => this.provider.refresh(credential, signal));
  }

  stopAdmission(): void {
    this.controller.abort();
  }

  get accepting(): boolean {
    return !this.controller.signal.aborted;
  }

  close(): Promise<void> {
    this.stopAdmission();
    if (this.closing) return this.closing;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('provider_fence_unresolved')), this.timeoutMs);
    });
    const drained = Promise.all([
      Promise.resolve().then(() => this.provider.close()),
      Promise.allSettled(this.tasks),
    ]).then(() => {});
    this.closing = Promise.race([drained, deadline])
      .catch(() => {
        this.closing = undefined;
        throw Error('provider_fence_unresolved');
      })
      .finally(() => clearTimeout(timer));
    return this.closing;
  }

  private invoke<T>(
    requested: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const signal = AbortSignal.any([requested, this.controller.signal]);
    if (signal.aborted) return Promise.reject(Error('provider_admission_closed'));
    const task = Promise.resolve()
      .then(() => {
        if (signal.aborted) throw Error('provider_admission_closed');
        return operation(signal);
      })
      .finally(() => this.tasks.delete(task));
    this.tasks.add(task);
    let stop = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      stop = () => reject(Error('provider_operation_interrupted'));
      signal.addEventListener('abort', stop, { once: true });
    });
    return Promise.race([task, interrupted]).finally(() =>
      signal.removeEventListener('abort', stop),
    );
  }
}
