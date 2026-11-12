/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { randomUUID } from 'node:crypto';
import type {
  DeviceRegistry,
  EntityActionQueue,
  ExecutionHistoryRecord,
  TriggerEvent,
  SourceServiceRef,
} from '@haus/core';
import type { StandaloneHomePersistence } from './home.persistence.js';
import { findEndpointDevice } from './readings.js';

export type DeviceCommandHandler = (
  endpointId: string,
  capability: string,
  command: string,
  parameters?: Record<string, unknown>,
) => Promise<void> | void;

export interface DeviceCommandHandlerOptions {
  readonly validate?: DeviceCommandHandler;
  readonly optimistic?: boolean;
}
const handlerKey = (source: string | SourceServiceRef): string =>
  typeof source === 'string'
    ? source
    : JSON.stringify([source.protocol, source.externalId, source.domain]);

export interface DeviceCommandReceipt {
  readonly receiptId: string;
  readonly endpointId: string;
  readonly capability: string;
  readonly command: string;
  readonly status: 'accepted';
  readonly observed: false;
  readonly state: Record<string, unknown>;
  readonly triggeredExecutions: readonly ExecutionHistoryRecord[];
}

interface RegisteredHandler {
  readonly execute: DeviceCommandHandler;
  readonly validate?: DeviceCommandHandler;
  readonly optimistic: boolean;
}

export class HomeCommands {
  private readonly handlers = new Map<string, RegisteredHandler>();

  constructor(
    private readonly devices: DeviceRegistry,
    private readonly queue: EntityActionQueue,
    private readonly states: Map<string, Record<string, unknown>>,
    private readonly persistence: Pick<StandaloneHomePersistence, 'save'>,
    private readonly resolveEndpointId: (id: string) => string,
    private readonly publishDevices: () => void,
    private readonly dispatch: (event: TriggerEvent) => Promise<readonly ExecutionHistoryRecord[]>,
  ) {}

  register(
    protocol: string | SourceServiceRef,
    execute: DeviceCommandHandler,
    options: DeviceCommandHandlerOptions = {},
  ): () => void {
    const registered: RegisteredHandler = {
      execute,
      validate: options.validate,
      optimistic: options.optimistic ?? true,
    };
    const key = handlerKey(protocol);
    this.handlers.set(key, registered);
    return () => {
      if (this.handlers.get(key) === registered) this.handlers.delete(key);
    };
  }

  execute(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
    dispatchTriggers = true,
  ): Promise<DeviceCommandReceipt> {
    return this.executeWithPolicy(
      endpointId,
      capability,
      command,
      parameters,
      dispatchTriggers,
      false,
    );
  }

  executeObserved(
    endpointId: string,
    capability: string,
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<DeviceCommandReceipt> {
    return this.executeWithPolicy(endpointId, capability, command, parameters, true, true);
  }

  private executeWithPolicy(
    endpointId: string,
    capability: string,
    command: string,
    parameters: Record<string, unknown> | undefined,
    dispatchTriggers: boolean,
    observedOnly: boolean,
  ): Promise<DeviceCommandReceipt> {
    const canonicalId = this.resolveEndpointId(endpointId);
    return this.queue.run(canonicalId, async () => {
      const device = findEndpointDevice(this.devices.listDevices(), canonicalId);
      if (!device) throw Error('endpoint_not_found');
      const owner = device.endpoints.find((endpoint) => endpoint.id === canonicalId)?.sourceOwner;
      const protocol =
        device.sourceRefs?.[0]?.protocol ??
        device.services?.[0]?.sourceRefs?.[0]?.protocol ??
        device.connectivity?.protocol;
      const handler = owner
        ? this.handlers.get(handlerKey(owner))
        : protocol
          ? this.handlers.get(protocol)
          : undefined;
      if (owner && !handler) throw Error('device_command_handler_unavailable');
      await handler?.validate?.(canonicalId, capability, command, parameters);

      if (observedOnly || (handler && !handler.optimistic)) {
        if (!handler) throw Error('device_command_handler_unavailable');
        await handler.execute(canonicalId, capability, command, parameters);
        return this.receipt(
          canonicalId,
          capability,
          command,
          { ...this.states.get(canonicalId) },
          [],
        );
      }

      const current = { ...this.states.get(canonicalId) };
      const previousValue = current[capability] ?? current.state;
      let nextValue: unknown = parameters?.value;
      if (command === 'turn_on') {
        nextValue = true;
        current.state = 'on';
        current.on_off = true;
      } else if (command === 'turn_off') {
        nextValue = false;
        current.state = 'off';
        current.on_off = false;
      } else if (command === 'toggle') {
        const nextBool = !(current.on_off ?? current.state === 'on');
        nextValue = nextBool;
        current.state = nextBool ? 'on' : 'off';
        current.on_off = nextBool;
      }

      if (nextValue !== undefined) current[capability] = nextValue;
      if (parameters) {
        for (const [key, value] of Object.entries(parameters)) {
          if (key !== 'value') current[key] = value;
        }
      }

      this.states.set(canonicalId, current);
      await this.persistence.save('endpoint_state', canonicalId, current);
      this.publishDevices();
      if (handler) await handler.execute(canonicalId, capability, command, parameters);

      let triggeredExecutions: readonly ExecutionHistoryRecord[] = [];
      if (dispatchTriggers) {
        triggeredExecutions = await this.dispatch({
          type: 'state',
          endpointId: canonicalId,
          property: capability,
          from: previousValue,
          to: current[capability],
        });
      }

      return this.receipt(canonicalId, capability, command, { ...current }, triggeredExecutions);
    });
  }

  private receipt(
    endpointId: string,
    capability: string,
    command: string,
    state: Record<string, unknown>,
    triggeredExecutions: readonly ExecutionHistoryRecord[],
  ): DeviceCommandReceipt {
    return {
      receiptId: `rcpt-${randomUUID()}`,
      endpointId,
      capability,
      command,
      status: 'accepted',
      observed: false,
      state,
      triggeredExecutions,
    };
  }
}
