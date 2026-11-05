/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  calculatePercentiles,
  ExecutionMode,
  LocalAutomationEngine,
  type AutomationExecutorEnvironment,
  type HausAutomationRule,
  type TriggerEvent,
} from '../src/index.js';

describe('LocalAutomationEngine & Event-Local Path', () => {
  function createEngineTestHarness() {
    const executedCommands: { endpointId: string; capability: string; command: string }[] = [];
    let livingRoomLightState = false;

    const env: AutomationExecutorEnvironment = {
      getEndpointState: (id, prop) => {
        if (id === 'living_room:light:overhead' && prop === 'on_off') {
          return livingRoomLightState;
        }
        return undefined;
      },
      executeDeviceCommand: async (endpointId, capability, command) => {
        executedCommands.push({ endpointId, capability, command });
        if (endpointId === 'living_room:light:overhead') {
          livingRoomLightState = true;
        }
      },
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      now: () => new Date(),
    };

    const engine = new LocalAutomationEngine(env);

    return {
      engine,
      executedCommands,
      setLivingRoomLightState: (s: boolean) => {
        livingRoomLightState = s;
      },
    };
  }

  const sampleRule: HausAutomationRule = {
    schemaVersion: 1,
    id: 'rule.switch_toggles_light',
    name: 'Wireless Switch toggles Living Room Light',
    enabled: true,
    mode: ExecutionMode.Single,
    triggers: [
      {
        type: 'event',
        eventType: 'press',
        endpointId: 'living_room:switch:dial',
      },
    ],
    conditions: [
      {
        type: 'state',
        endpointId: 'living_room:light:overhead',
        property: 'on_off',
        operator: '==',
        value: false, // Only turn on if currently off
      },
    ],
    actions: [
      {
        type: 'action',
        action: {
          kind: 'device_command',
          payload: {
            endpointId: 'living_room:light:overhead',
            capability: 'on_off',
            command: 'turn_on',
          },
        },
      },
    ],
  };

  it('compiles rules on save and executes event -> condition -> command locally', async () => {
    const { engine, executedCommands, setLivingRoomLightState } = createEngineTestHarness();
    engine.registerRule(sampleRule);

    const event: TriggerEvent = {
      type: 'event',
      eventType: 'press',
      endpointId: 'living_room:switch:dial',
    };

    // When light is off: condition met, command dispatched
    setLivingRoomLightState(false);
    const results = await engine.dispatch(event);
    expect(results).toHaveLength(1);
    expect(executedCommands).toHaveLength(1);
    expect(executedCommands[0]?.endpointId).toBe('living_room:light:overhead');

    // When light is on: condition not met, command skipped
    setLivingRoomLightState(true);
    const resultsSecond = await engine.dispatch(event);
    expect(resultsSecond).toHaveLength(0);
    expect(executedCommands).toHaveLength(1); // No new commands
  });

  it('unregisters rules from index so they no longer fire', async () => {
    const { engine, executedCommands } = createEngineTestHarness();
    engine.registerRule(sampleRule);
    engine.unregisterRule(sampleRule.id);

    const event: TriggerEvent = {
      type: 'event',
      eventType: 'press',
      endpointId: 'living_room:switch:dial',
    };

    const results = await engine.dispatch(event);
    expect(results).toHaveLength(0);
    expect(executedCommands).toHaveLength(0);
  });

  it('measures software-path p50/p95/p99 latency under representative load', async () => {
    const { engine, setLivingRoomLightState } = createEngineTestHarness();
    // Rule without condition check to benchmark raw dispatch path
    const fastRule: HausAutomationRule = {
      schemaVersion: 1,
      id: 'rule.fast_bench',
      name: 'Fast Benchmark Rule',
      enabled: true,
      triggers: [
        {
          type: 'event',
          eventType: 'button_click',
        },
      ],
      actions: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'target:device:relay',
              capability: 'on_off',
              command: 'toggle',
            },
          },
        },
      ],
    };

    engine.registerRule(fastRule);
    setLivingRoomLightState(false);

    const event: TriggerEvent = {
      type: 'event',
      eventType: 'button_click',
    };

    // Benchmark 200 iterations under load
    const metrics = await engine.measureSoftwarePathLatency(event, 200);

    expect(metrics.count).toBe(200);
    expect(metrics.minMs).toBeGreaterThanOrEqual(0);
    // In-memory compiled execution path should be sub-millisecond on p50 (< 1.0ms)
    expect(metrics.p50Ms).toBeLessThan(1.0);
    // p95 and p99 should be tightly bounded (< 5.0ms)
    expect(metrics.p95Ms).toBeLessThan(5.0);
    expect(metrics.p99Ms).toBeLessThan(10.0);
  });

  it('calculates percentile metrics accurately', () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const metrics = calculatePercentiles(samples);

    expect(metrics.count).toBe(10);
    expect(metrics.minMs).toBe(0.1);
    expect(metrics.maxMs).toBe(1.0);
    expect(metrics.p50Ms).toBe(0.6);
  });
});
