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

export interface RemoteForwardResult {
  readonly forwarded: boolean;
  readonly state?: Record<string, unknown>;
}

interface QueuedCommandInput {
  readonly capability: string;
  readonly command: string;
  readonly parameters?: Record<string, unknown>;
  readonly dispatchTriggers: boolean;
  readonly observedOnly: boolean;
}

const COALESCEABLE_CAPABILITIES = new Set([
  'on_off',
  'power',
  'brightness',
  'color_temp',
  'color_temp_kelvin',
  'color_hsv',
  'color',
  'hs_color',
  'effect',
]);
const COLOR_PARAM_KEYS = ['color', 'color_hsv', 'hs_color', 'rgb_color', 'xy_color'] as const;
const COLOR_TEMP_PARAM_KEYS = ['color_temp', 'color_temp_kelvin', 'kelvin'] as const;

const STEP_LIMITS = {
  brightness_step_pct: 100,
  brightness_step: 255,
} as const;
type StepParamKey = keyof typeof STEP_LIMITS;

function canonicalCoalesceKey(capability: string): string {
  return capability === 'on_off' ? 'power' : capability;
}

function stepParamKey(params?: Record<string, unknown>): StepParamKey | 'invalid' | undefined {
  if (!params) return undefined;
  const hasPct = params.brightness_step_pct !== undefined;
  const hasRaw = params.brightness_step !== undefined;
  if (!hasPct && !hasRaw) return undefined;
  if (hasPct && hasRaw) return 'invalid';
  if (hasPct) {
    return typeof params.brightness_step_pct === 'number' &&
      Number.isFinite(params.brightness_step_pct)
      ? 'brightness_step_pct'
      : 'invalid';
  }
  return typeof params.brightness_step === 'number' && Number.isFinite(params.brightness_step)
    ? 'brightness_step'
    : 'invalid';
}

function hasAbsoluteBrightness(params?: Record<string, unknown>): boolean {
  return Boolean(
    params &&
    (params.brightness !== undefined ||
      params.brightness_pct !== undefined ||
      typeof params.value === 'number'),
  );
}

function isCoalesceableCommand(input: QueuedCommandInput): boolean {
  if (!COALESCEABLE_CAPABILITIES.has(input.capability)) return false;
  if (input.command !== 'turn_on' && input.command !== 'turn_off' && input.command !== 'set') {
    return false;
  }
  const params = input.parameters;
  if (params && (params.flash !== undefined || stepParamKey(params) === 'invalid')) {
    return false;
  }
  return true;
}

function isExplicitTurnOff(input: QueuedCommandInput): boolean {
  return (
    (input.capability === 'on_off' || input.capability === 'power') &&
    (input.command === 'turn_off' || (input.command === 'set' && input.parameters?.value === false))
  );
}

function mergeCoalescedCommands(
  pending: QueuedCommandInput,
  incoming: QueuedCommandInput,
): QueuedCommandInput | undefined {
  if (pending.observedOnly !== incoming.observedOnly) return undefined;
  if (!isCoalesceableCommand(pending) || !isCoalesceableCommand(incoming)) return undefined;
  const dispatchTriggers = pending.dispatchTriggers || incoming.dispatchTriggers;

  if (isExplicitTurnOff(incoming)) {
    return { ...incoming, dispatchTriggers };
  }
  const pendingStep = stepParamKey(pending.parameters);
  const incomingStep = stepParamKey(incoming.parameters);
  if (pendingStep === 'invalid' || incomingStep === 'invalid') return undefined;

  if (isExplicitTurnOff(pending)) {
    if (incomingStep !== undefined) return undefined;
    return { ...incoming, dispatchTriggers };
  }
  if (
    canonicalCoalesceKey(pending.capability) !== canonicalCoalesceKey(incoming.capability) ||
    pending.command !== incoming.command
  ) {
    return undefined;
  }
  if (incomingStep !== undefined) {
    if (
      pendingStep !== incomingStep ||
      hasAbsoluteBrightness(pending.parameters) ||
      hasAbsoluteBrightness(incoming.parameters)
    ) {
      return undefined;
    }
  }
  const mergedParams: Record<string, unknown> = {
    ...pending.parameters,
    ...incoming.parameters,
  };
  if (incomingStep !== undefined && pendingStep === incomingStep) {
    const limit = STEP_LIMITS[incomingStep];
    const summed =
      (pending.parameters?.[pendingStep] as number) +
      (incoming.parameters?.[incomingStep] as number);
    mergedParams[incomingStep] = Math.max(-limit, Math.min(limit, summed));
  } else if (pendingStep !== undefined && hasAbsoluteBrightness(incoming.parameters)) {
    delete mergedParams[pendingStep];
  }
  if (incoming.parameters) {
    const setsTemp = COLOR_TEMP_PARAM_KEYS.some((key) => incoming.parameters?.[key] !== undefined);
    const setsColor = COLOR_PARAM_KEYS.some((key) => incoming.parameters?.[key] !== undefined);
    if (setsTemp) {
      for (const key of COLOR_PARAM_KEYS) delete mergedParams[key];
    } else if (setsColor) {
      for (const key of COLOR_TEMP_PARAM_KEYS) delete mergedParams[key];
    }
    if ((setsTemp || setsColor) && incoming.parameters.effect === undefined) {
      delete mergedParams.effect;
    }
  }
  return {
    ...incoming,
    parameters: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
    dispatchTriggers,
  };
}

export class HomeCommands {
  private readonly handlers = new Map<string, RegisteredHandler>();

  constructor(
    private readonly devices: DeviceRegistry,
    private readonly queue: EntityActionQueue,
    private readonly states: Map<string, Record<string, unknown>>,
    private readonly persistence: Pick<StandaloneHomePersistence, 'save'>,
    private readonly resolveEndpointId: (id: string) => string,
    private readonly publishState: (endpointId: string, state: Record<string, unknown>) => void,
    private readonly dispatch: (event: TriggerEvent) => Promise<readonly ExecutionHistoryRecord[]>,
    private readonly onStateUpdated?: (
      endpointId: string,
      fullState: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => void,
    private readonly remoteFallback?: (
      device: import('@haus/core').HausDevice,
      endpointId: string,
      capability: string,
      command: string,
      parameters?: Record<string, unknown>,
    ) => Promise<RemoteForwardResult>,
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

  private async executeWithPolicy(
    endpointId: string,
    capability: string,
    command: string,
    parameters: Record<string, unknown> | undefined,
    dispatchTriggers: boolean,
    observedOnly: boolean,
  ): Promise<DeviceCommandReceipt> {
    const canonicalId = this.resolveEndpointId(endpointId);
    const input: QueuedCommandInput = {
      capability,
      command,
      parameters,
      dispatchTriggers,
      observedOnly,
    };
    const runCommand = async (active: QueuedCommandInput) => {
      const resolved = this.devices.getEndpoint(canonicalId);
      if (!resolved) throw Error('endpoint_not_found');
      const { device, endpoint } = resolved;
      const hasOnOff = endpoint.capabilities.some((cap) => cap.id === 'on_off');
      const hasWritablePower = endpoint.capabilities.some(
        (cap) => cap.id === 'power' && cap.operations.length > 0,
      );
      const dispatchCapability =
        active.capability === 'power' && hasOnOff && !hasWritablePower
          ? 'on_off'
          : active.capability === 'on_off' && hasWritablePower && !hasOnOff
            ? 'power'
            : active.capability;
      const owner = endpoint.sourceOwner;
      const protocol =
        device.sourceRefs?.[0]?.protocol ??
        device.services?.[0]?.sourceRefs?.[0]?.protocol ??
        device.connectivity?.protocol;
      const handler = owner
        ? this.handlers.get(handlerKey(owner))
        : protocol
          ? this.handlers.get(protocol)
          : undefined;
      if (owner && !handler) {
        const remote = this.remoteFallback
          ? await this.remoteFallback(
              device,
              canonicalId,
              dispatchCapability,
              active.command,
              active.parameters,
            )
          : { forwarded: false };
        if (!remote.forwarded) throw Error('device_command_handler_unavailable');
        if (remote.state && Object.keys(remote.state).length > 0) {
          const merged = { ...this.states.get(canonicalId), ...remote.state };
          this.states.set(canonicalId, merged);
          void this.persistence.save('endpoint_state', canonicalId, merged).catch(() => {});
          this.publishState(canonicalId, merged);
        }
        return {
          state: { ...this.states.get(canonicalId) },
          triggerEvent: undefined as TriggerEvent | undefined,
        };
      }
      await handler?.validate?.(canonicalId, dispatchCapability, active.command, active.parameters);

      if (active.observedOnly || (handler && !handler.optimistic)) {
        if (!handler) throw Error('device_command_handler_unavailable');
        await handler.execute(canonicalId, dispatchCapability, active.command, active.parameters);
        return {
          state: { ...this.states.get(canonicalId) },
          triggerEvent: undefined as TriggerEvent | undefined,
        };
      }

      const current = { ...this.states.get(canonicalId) };
      const previousValue = current[dispatchCapability] ?? current.state;
      let nextValue: unknown = active.parameters?.value;
      if (active.command === 'turn_on') {
        nextValue = true;
        current.state = 'on';
        current.on_off = true;
      } else if (active.command === 'turn_off') {
        nextValue = false;
        current.state = 'off';
        current.on_off = false;
      } else if (active.command === 'toggle') {
        const nextBool = !(current.on_off ?? current.state === 'on');
        nextValue = nextBool;
        current.state = nextBool ? 'on' : 'off';
        current.on_off = nextBool;
      }

      if (nextValue !== undefined) current[dispatchCapability] = nextValue;
      let clearedEffect = false;
      if (active.parameters) {
        for (const [key, value] of Object.entries(active.parameters)) {
          if (key !== 'value') current[key] = value;
        }
        const setsLightColor =
          COLOR_PARAM_KEYS.some((key) => active.parameters?.[key] !== undefined) ||
          COLOR_TEMP_PARAM_KEYS.some((key) => active.parameters?.[key] !== undefined);
        if (setsLightColor && active.parameters.effect === undefined && current.effect) {
          current.effect = null;
          clearedEffect = true;
        }
      }

      this.states.set(canonicalId, current);
      // Fire hardware I/O before persistence/stats/history bookkeeping to minimize tail latency.
      const execPromise = handler
        ? (async () =>
            handler.execute(canonicalId, dispatchCapability, active.command, active.parameters))()
        : undefined;
      void execPromise?.catch(() => undefined);
      this.publishState(canonicalId, current);
      // Persist asynchronously so device commands never stall 25ms waiting on SQLite batching.
      void this.persistence.save('endpoint_state', canonicalId, current).catch(() => {
        process.emitWarning('home_endpoint_state_persist_failed');
      });
      const patch: Record<string, unknown> = {
        ...active.parameters,
        ...(clearedEffect ? { effect: null } : {}),
      };
      delete patch.value;
      if (nextValue !== undefined) patch[dispatchCapability] = nextValue;
      if (
        active.command === 'turn_on' ||
        active.command === 'turn_off' ||
        active.command === 'toggle'
      ) {
        patch.state = current.state;
        patch.on_off = current.on_off;
      }
      this.onStateUpdated?.(canonicalId, current, patch);
      if (execPromise) {
        await execPromise;
      }

      return {
        state: { ...current },
        triggerEvent: active.dispatchTriggers
          ? ({
              type: 'state',
              endpointId: canonicalId,
              property: dispatchCapability,
              from: previousValue,
              to: current[dispatchCapability],
            } satisfies TriggerEvent)
          : undefined,
      };
    };

    const outcome = isCoalesceableCommand(input)
      ? await this.queue.runCoalesced(canonicalId, input, mergeCoalescedCommands, runCommand)
      : await this.queue.run(canonicalId, () => runCommand(input));

    const triggeredExecutions = outcome.triggerEvent
      ? await this.dispatch(outcome.triggerEvent)
      : [];

    return this.receipt(canonicalId, capability, command, outcome.state, triggeredExecutions);
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
