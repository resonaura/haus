/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type { Command } from '@haus/core/types';
import { Identities } from '@haus/core/types';
import type {
  Provider,
  ProviderContext,
  ProviderInventory,
  ProviderReply,
} from '@haus/core/provider';
import type { RefreshResult } from '@haus/core/session';
import { HaHomeAdapter } from '../adapter.js';
import type { HaCredential } from './credential.js';
import type { HaProviderAddress } from './address.js';
import { refreshHaCredential } from './refresh.js';
import { HaResponseError, OwnedHaTransport, type OwnedTransportOptions } from './transport.js';

export interface HaProviderOptions extends OwnedTransportOptions {
  readonly epoch?: string;
  readonly identities?: Identities;
}

/** Owned Home Assistant provider bound to Hub session and single-writer lifecycle. */
export class HaProvider implements Provider<HaCredential> {
  private readonly transport: OwnedHaTransport;
  private readonly adapter: HaHomeAdapter;
  private readonly epoch: string;
  private closed = false;

  constructor(
    readonly address: HaProviderAddress,
    private readonly context: ProviderContext<HaCredential>,
    options: HaProviderOptions = {},
  ) {
    this.epoch =
      options.epoch ??
      `${context.grant.owner.processId}:${context.grant.generation}:${randomUUID()}`;
    this.transport = new OwnedHaTransport(address, {
      ...options,
      refresh: async () => {
        await context.refresh();
        return context.credential();
      },
    });
    const identities =
      options.identities ??
      new Identities(
        {
          get: () => undefined,
          putIfAbsent: (_src, id) => id,
        },
        () => randomUUID(),
      );
    this.adapter = new HaHomeAdapter({
      id: context.grant.resource.id,
      homeId: context.grant.resource.homeId,
      epoch: this.epoch,
      session: {
        epoch: this.epoch,
        owner: structuredClone(context.grant.owner),
        generation: context.grant.generation,
      },
      identities,
      registry: context.identities,
      transport: this.transport,
    });
  }

  get inventory(): ProviderInventory {
    return {
      id: this.context.grant.resource.id,
      snapshot: (signal) => {
        if (this.closed) return Promise.reject(Error('provider_closed'));
        return this.adapter.snapshot(signal);
      },
      subscribe: (listener) => {
        if (this.closed) throw Error('provider_closed');
        return this.adapter.subscribe(listener);
      },
    };
  }

  async open(credential: HaCredential, signal: AbortSignal): Promise<void> {
    if (this.closed) throw Error('provider_closed');
    signal.throwIfAborted();
    await this.transport.open(credential, signal);
    signal.throwIfAborted();
    await this.adapter.snapshot(signal);
  }

  async execute(
    command: Command,
    _credential: HaCredential,
    signal: AbortSignal,
  ): Promise<ProviderReply> {
    if (this.closed) throw Error('provider_closed');
    signal.throwIfAborted();
    if (!this.transport.connected) throw Error('endpoint_offline');
    try {
      const receipt = await this.adapter.execute(command, signal);
      return { status: receipt.status, correlationId: receipt.correlationId };
    } catch (error: unknown) {
      if (error instanceof HaResponseError) {
        return { status: 'failed' };
      }
      if (error instanceof Error) {
        if (
          error.message === 'unsupported_operation' ||
          error.message === 'invalid_command_value'
        ) {
          return { status: 'failed' };
        }
        if (error.message === 'ha_command_lost' || error.message === 'ha_command_timeout') {
          return { status: 'unknown' };
        }
      }
      throw error;
    }
  }

  refresh(credential: HaCredential, signal: AbortSignal): Promise<RefreshResult<HaCredential>> {
    if (this.closed) return Promise.reject(Error('provider_closed'));
    return refreshHaCredential(this.address, credential, signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.adapter.close();
    await this.transport.close();
  }
}
