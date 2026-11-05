/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  AutomationExecutor,
  evaluateCondition,
  ExecutionMode,
  ExecutionStatus,
  matchesTrigger,
  StepStatus,
  validateAutomation,
  validateScene,
  validateScript,
  type AutomationExecutorEnvironment,
  type HausAutomationRule,
  type HausScene,
  type HausScript,
} from '../src/index.js';

describe('Haus Automation Models & Validation', () => {
  it('validates a versioned HausScene schema', () => {
    const validScene: HausScene = {
      schemaVersion: 1,
      id: 'scene.evening_relax',
      name: 'Evening Relax',
      description: 'Dim living room lights and close blinds',
      roomId: 'room.living_room',
      members: [
        {
          endpointId: 'living_room:ceiling_light:light_1',
          targetState: { on_off: true, brightness: 40, color_temp: 2700 },
          transitionSeconds: 2,
        },
        {
          endpointId: 'living_room:window:blind_1',
          targetState: { cover_position: 0 },
        },
      ],
    };

    const validated = validateScene(validScene);
    expect(validated.id).toBe('scene.evening_relax');
    expect(validated.members).toHaveLength(2);
    expect(validated.members[0]?.targetState.brightness).toBe(40);

    expect(() => validateScene({ ...validScene, schemaVersion: 2 })).toThrow(
      /unsupported schemaVersion/,
    );
    expect(() => validateScene({ ...validScene, id: '' })).toThrow(/non-empty string/);
  });

  it('validates a versioned HausScript schema with nested branching', () => {
    const validScript: HausScript = {
      schemaVersion: 1,
      id: 'script.goodnight',
      name: 'Goodnight Sequence',
      mode: ExecutionMode.Single,
      steps: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'entryway:front_door:lock',
              capability: 'lock',
              command: 'set',
              parameters: { state: 'locked' },
            },
          },
          timeoutMs: 5000,
          continueOnError: true,
        },
        {
          type: 'delay',
          durationMs: 100,
        },
        {
          type: 'choose',
          branches: [
            {
              conditions: [
                {
                  type: 'state',
                  endpointId: 'living_room:tv:power',
                  property: 'on_off',
                  operator: '==',
                  value: true,
                },
              ],
              steps: [
                {
                  type: 'action',
                  action: {
                    kind: 'device_command',
                    payload: {
                      endpointId: 'living_room:tv:power',
                      capability: 'on_off',
                      command: 'set',
                      parameters: { value: false },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const validated = validateScript(validScript);
    expect(validated.id).toBe('script.goodnight');
    expect(validated.steps).toHaveLength(3);
    expect(validated.steps[0]?.type).toBe('action');

    expect(() => validateScript({ ...validScript, schemaVersion: 99 })).toThrow(
      /unsupported schemaVersion/,
    );
  });

  it('validates a complete HausAutomationRule with triggers and conditions', () => {
    const rule: HausAutomationRule = {
      schemaVersion: 1,
      id: 'automation.hallway_motion',
      name: 'Turn on hallway light on motion',
      enabled: true,
      mode: ExecutionMode.Restart,
      triggers: [
        {
          type: 'state',
          endpointId: 'hallway:sensor:motion',
          property: 'motion',
          to: true,
        },
        {
          type: 'event',
          eventType: 'button_press',
          endpointId: 'hallway:switch:wall',
        },
      ],
      conditions: [
        {
          type: 'time',
          after: '18:00:00',
          before: '23:59:59',
        },
      ],
      actions: [
        {
          type: 'action',
          action: {
            kind: 'activate_scene',
            payload: { sceneId: 'scene.hallway_dim' },
          },
        },
      ],
    };

    const validated = validateAutomation(rule);
    expect(validated.id).toBe('automation.hallway_motion');
    expect(validated.triggers).toHaveLength(2);
    expect(validated.conditions).toHaveLength(1);
    expect(validated.actions).toHaveLength(1);
  });
});

describe('Condition & Trigger Evaluation', () => {
  const mockContext = {
    getEndpointState: (id: string, prop: string) => {
      if (id === 'living_room:sensor:temp' && prop === 'temperature') return 24.5;
      if (id === 'bedroom:light:ceiling' && prop === 'on_off') return true;
      if (id === 'bedroom:light:ceiling' && prop === 'brightness') return 80;
      return undefined;
    },
    now: () => new Date('2026-11-05T20:30:00'), // Thursday, 20:30
  };

  it('evaluates state conditions with comparison operators', () => {
    expect(
      evaluateCondition(
        {
          type: 'state',
          endpointId: 'living_room:sensor:temp',
          property: 'temperature',
          operator: '>',
          value: 20,
        },
        mockContext,
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        {
          type: 'state',
          endpointId: 'living_room:sensor:temp',
          property: 'temperature',
          operator: '<',
          value: 22,
        },
        mockContext,
      ),
    ).toBe(false);

    expect(
      evaluateCondition(
        {
          type: 'state',
          endpointId: 'bedroom:light:ceiling',
          property: 'brightness',
          operator: 'in',
          value: [50, 80, 100],
        },
        mockContext,
      ),
    ).toBe(true);
  });

  it('evaluates time and logical conditions', () => {
    // 20:30 is after 19:00 and before 22:00
    expect(
      evaluateCondition(
        {
          type: 'time',
          after: '19:00:00',
          before: '22:00:00',
        },
        mockContext,
      ),
    ).toBe(true);

    // Thursday is day 4
    expect(
      evaluateCondition(
        {
          type: 'time',
          weekdays: [4],
        },
        mockContext,
      ),
    ).toBe(true);

    // Compound AND/OR condition
    expect(
      evaluateCondition(
        {
          type: 'and',
          conditions: [
            {
              type: 'state',
              endpointId: 'bedroom:light:ceiling',
              property: 'on_off',
              operator: '==',
              value: true,
            },
            {
              type: 'time',
              after: '12:00:00',
            },
          ],
        },
        mockContext,
      ),
    ).toBe(true);
  });

  it('matches state, event, and numeric state triggers', () => {
    expect(
      matchesTrigger(
        {
          type: 'state',
          endpointId: 'front_door:sensor:contact',
          property: 'contact',
          to: false,
        },
        {
          type: 'state',
          endpointId: 'front_door:sensor:contact',
          property: 'contact',
          from: true,
          to: false,
        },
      ),
    ).toBe(true);

    expect(
      matchesTrigger(
        {
          type: 'event',
          eventType: 'double_press',
          endpointId: 'living_room:switch:dial',
        },
        {
          type: 'event',
          eventType: 'double_press',
          endpointId: 'living_room:switch:dial',
        },
      ),
    ).toBe(true);

    expect(
      matchesTrigger(
        {
          type: 'numeric_state',
          endpointId: 'energy:meter:main',
          property: 'power_watts',
          above: 2000,
        },
        {
          type: 'numeric_state',
          endpointId: 'energy:meter:main',
          property: 'power_watts',
          value: 2500,
        },
      ),
    ).toBe(true);
  });
});

describe('Automation Executor & Partial Failure Semantics', () => {
  function createTestEnvironment() {
    const executedCommands: { endpointId: string; capability: string; command: string }[] = [];
    const activatedScenes: string[] = [];
    const calledScripts: string[] = [];

    const env: AutomationExecutorEnvironment = {
      getEndpointState: (_id, _prop) => true,
      executeDeviceCommand: async (endpointId, capability, command) => {
        if (endpointId === 'faulty:relay:1') {
          throw new Error('Device network timeout.');
        }
        executedCommands.push({ endpointId, capability, command });
      },
      activateScene: async (sceneId) => {
        activatedScenes.push(sceneId);
      },
      callScript: async (scriptId) => {
        calledScripts.push(scriptId);
      },
      sendNotification: async () => {},
      now: () => new Date(),
      sleep: async () => {}, // Instant sleep for tests
    };

    return { env, executedCommands, activatedScenes, calledScripts };
  }

  it('executes scene and reports partial failure when one endpoint fails', async () => {
    const { env, executedCommands } = createTestEnvironment();
    const executor = new AutomationExecutor(env);

    const scene: HausScene = {
      schemaVersion: 1,
      id: 'scene.mixed_devices',
      name: 'Mixed Devices',
      members: [
        {
          endpointId: 'light:bulb:1',
          targetState: { on_off: true },
        },
        {
          endpointId: 'faulty:relay:1', // Fails!
          targetState: { on_off: true },
        },
      ],
    };

    const result = await executor.executeScene(scene);
    expect(result.status).toBe(ExecutionStatus.Partial);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults.some((r) => r.status === StepStatus.Completed)).toBe(true);
    expect(result.stepResults.some((r) => r.status === StepStatus.Failed)).toBe(true);
    expect(executedCommands).toHaveLength(1);
    expect(executor.history.list()).toHaveLength(1);
  });

  it('respects continueOnError in scripts to achieve partial completion', async () => {
    const { env, executedCommands } = createTestEnvironment();
    const executor = new AutomationExecutor(env);

    const script: HausScript = {
      schemaVersion: 1,
      id: 'script.resilient',
      name: 'Resilient Script',
      steps: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'faulty:relay:1', // Will fail!
              capability: 'on_off',
              command: 'set',
            },
          },
          continueOnError: true, // Should not halt script!
        },
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'light:bulb:1', // Should still run!
              capability: 'on_off',
              command: 'set',
            },
          },
        },
      ],
    };

    const result = await executor.executeScript(script);
    expect(result.status).toBe(ExecutionStatus.Partial);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0]?.status).toBe(StepStatus.Failed);
    expect(result.stepResults[1]?.status).toBe(StepStatus.Completed);
    expect(executedCommands).toHaveLength(1);
  });

  it('halts script execution on failure when continueOnError is false', async () => {
    const { env, executedCommands } = createTestEnvironment();
    const executor = new AutomationExecutor(env);

    const script: HausScript = {
      schemaVersion: 1,
      id: 'script.strict',
      name: 'Strict Script',
      steps: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'faulty:relay:1',
              capability: 'on_off',
              command: 'set',
            },
          },
          continueOnError: false, // Halts!
        },
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'light:bulb:1',
              capability: 'on_off',
              command: 'set',
            },
          },
        },
      ],
    };

    const result = await executor.executeScript(script);
    expect(result.status).toBe(ExecutionStatus.Failed);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]?.status).toBe(StepStatus.Failed);
    expect(executedCommands).toHaveLength(0);
  });

  it('cancels in-flight script execution when AbortSignal fires', async () => {
    const { env } = createTestEnvironment();
    const executor = new AutomationExecutor(env);

    const controller = new AbortController();
    controller.abort(); // Pre-aborted

    const script: HausScript = {
      schemaVersion: 1,
      id: 'script.abortable',
      name: 'Abortable Script',
      steps: [
        {
          type: 'delay',
          durationMs: 1000,
        },
      ],
    };

    const result = await executor.executeScript(script, controller.signal);
    expect(result.status).toBe(ExecutionStatus.Cancelled);
  });
});
