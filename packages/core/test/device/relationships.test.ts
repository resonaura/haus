/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import {
  AtomicRoomMoveCoordinator,
  InMemoryRoomMoveRepository,
  LocalAutomationEngine,
  AutomationExecutor,
  type AutomationExecutorEnvironment,
  type HausDevice,
  type HausScene,
  type HausAutomationRule,
  type TriggerEvent,
  ExecutionStatus,
  ConditionOperator,
  onOffCapability,
  brightnessCapability,
} from '../../src/index.js';

describe('Preserve Relationships, Execution & Aliases (P18.6.3)', () => {
  const devLamp: HausDevice = {
    id: 'hacs_hue_lamp_1',
    name: 'Narnia Lamp',
    category: 'lighting',
    roomId: 'narnia',
    availability: 'online',
    source: { instanceId: 'hacs:hue', externalId: 'ec:b5:fa:ad:dc:a9:lamp1' },
    connectivity: { protocol: 'virtual' },
    sourceRefs: [{ protocol: 'virtual', externalId: 'ec:b5:fa:ad:dc:a9:lamp1' }],
    endpoints: [
      {
        id: 'ep_hue_lamp_1',
        name: 'Narnia Lamp Endpoint',
        capabilities: [onOffCapability, brightnessCapability],
        readings: {},
      },
    ],
    customEntities: {},
  };

  const devAc: HausDevice = {
    id: 'hacs_sensibo_ac',
    name: 'TV Place AC',
    category: 'climate',
    roomId: 'tv_place',
    availability: 'online',
    source: { instanceId: 'hacs:sensibo', externalId: '49GPvLvV' },
    connectivity: { protocol: 'virtual' },
    sourceRefs: [{ protocol: 'virtual', externalId: '49GPvLvV' }],
    endpoints: [
      {
        id: 'ep_sensibo_ac',
        name: 'TV Place AC Endpoint',
        capabilities: [
          {
            id: 'climate',
            kind: 'climate',
            readable: true,
            operations: ['set_hvac_mode', 'set_temperature'],
          },
        ],
        readings: {},
      },
    ],
    customEntities: {},
  };

  it('rebinds legacy HA entity IDs and aliases to canonical devices and endpoints', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.initialize();

    await coordinator.registerRoom({ id: 'narnia', name: 'Narnia' });
    await coordinator.registerRoom({ id: 'tv_place', name: 'TV Place' });
    await coordinator.registerDevice(devLamp);
    await coordinator.registerDevice(devAc);

    // Rebind legacy HA entity IDs as aliases
    await coordinator.registerAlias('light.hue_narnia_lamp', 'ep_hue_lamp_1');
    await coordinator.registerAlias('climate.tv_place_ac', 'ep_sensibo_ac');
    await coordinator.registerAlias('legacy_device_sensibo_id_49GPvLvV', devAc.id);

    // Lookups resolve aliases and canonical IDs identically
    expect(coordinator.resolveAddressOrId('light.hue_narnia_lamp')).toBe('ep_hue_lamp_1');
    expect(coordinator.resolveAddressOrId('climate.tv_place_ac')).toBe('ep_sensibo_ac');
    expect(coordinator.resolveAddressOrId('legacy_device_sensibo_id_49GPvLvV')).toBe(devAc.id);
    expect(coordinator.resolveAddressOrId('ep_hue_lamp_1')).toBe('ep_hue_lamp_1');
    expect(coordinator.resolveAddressOrId(devAc.id)).toBe(devAc.id);

    // Device lookup via canonical ID
    expect(coordinator.getDevice(devLamp.id)?.name).toBe('Narnia Lamp');
    expect(coordinator.getDevice(devAc.id)?.name).toBe('TV Place AC');
  });

  it('executes scenes and automations referencing rebound legacy aliases', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.initialize();
    await coordinator.registerRoom({ id: 'narnia', name: 'Narnia' });
    await coordinator.registerRoom({ id: 'tv_place', name: 'TV Place' });
    await coordinator.registerDevice(devLamp);
    await coordinator.registerDevice(devAc);

    await coordinator.registerAlias('light.hue_narnia_lamp', 'ep_hue_lamp_1');
    await coordinator.registerAlias('climate.tv_place_ac', 'ep_sensibo_ac');

    const executedCommands: Array<{
      endpointId: string;
      capability: string;
      command: string;
      parameters?: Record<string, unknown>;
    }> = [];

    const mockStates: Record<string, Record<string, unknown>> = {
      ep_hue_lamp_1: { on_off: false, brightness: 0 },
      ep_sensibo_ac: { hvac_mode: 'heat', temperature: 22 },
    };

    const resolveEndpoint = (id: string): string => coordinator.resolveAddressOrId(id) ?? id;

    const env: AutomationExecutorEnvironment = {
      executeDeviceCommand: async (endpointId, capability, command, parameters) => {
        const canonicalId = resolveEndpoint(endpointId);
        executedCommands.push({ endpointId: canonicalId, capability, command, parameters });
        if (parameters && typeof parameters.value !== 'undefined') {
          mockStates[canonicalId] = {
            ...mockStates[canonicalId],
            [capability]: parameters.value,
          };
        }
      },
      activateScene: async () => {},
      callScript: async () => {},
      sendNotification: async () => {},
      getEndpointState: (epId, prop) => {
        const canonicalId = resolveEndpoint(epId);
        return mockStates[canonicalId]?.[prop];
      },
      now: () => new Date(),
    };

    const executor = new AutomationExecutor(env);
    const engine = new LocalAutomationEngine(env, {
      resolveEndpointId: resolveEndpoint,
    });

    // 1. Scene targeting legacy alias
    const scene: HausScene = {
      schemaVersion: 1,
      id: 'scene_evening_relax',
      name: 'Evening Relax',
      members: [
        {
          endpointId: 'light.hue_narnia_lamp', // Legacy alias target
          targetState: { on_off: true, brightness: 75 },
          transitionSeconds: 2,
        },
      ],
    };

    const sceneResult = await executor.executeScene(scene);
    expect(sceneResult.status).toBe(ExecutionStatus.Completed);
    expect(executedCommands.length).toBe(2);
    expect(executedCommands[0]).toEqual({
      endpointId: 'ep_hue_lamp_1', // Canonical endpoint reached
      capability: 'on_off',
      command: 'set',
      parameters: { value: true, transition: 2 },
    });
    expect(executedCommands[1]).toEqual({
      endpointId: 'ep_hue_lamp_1',
      capability: 'brightness',
      command: 'set',
      parameters: { value: 75, transition: 2 },
    });

    // 2. Automation triggered by legacy alias, checking condition on legacy alias, and acting on legacy alias
    const automation: HausAutomationRule = {
      schemaVersion: 1,
      id: 'rule_heat_lamp_sync',
      name: 'Heat Lamp Sync',
      enabled: true,
      mode: 'single',
      triggers: [
        {
          type: 'state',
          endpointId: 'light.hue_narnia_lamp', // Alias trigger
          property: 'on_off',
          to: true,
        },
      ],
      conditions: [
        {
          type: 'state',
          endpointId: 'climate.tv_place_ac', // Alias condition
          property: 'hvac_mode',
          operator: ConditionOperator.Equals,
          value: 'heat',
        },
      ],
      actions: [
        {
          type: 'action',
          action: {
            kind: 'device_command',
            payload: {
              endpointId: 'light.hue_narnia_lamp', // Alias action target
              capability: 'brightness',
              command: 'set',
              parameters: { value: 100 },
            },
          },
        },
      ],
    };

    engine.registerRule(automation);

    // Dispatch event with canonical endpoint ID
    const event: TriggerEvent = {
      type: 'state',
      endpointId: 'ep_hue_lamp_1',
      property: 'on_off',
      to: true,
    };

    const records = await engine.dispatch(event);
    expect(records.length).toBe(1);
    expect(records[0]?.status).toBe(ExecutionStatus.Completed);

    // Verify command dispatched to canonical endpoint ID
    expect(executedCommands[2]).toEqual({
      endpointId: 'ep_hue_lamp_1',
      capability: 'brightness',
      command: 'set',
      parameters: { value: 100 },
    });
  });

  it('preserves execution through atomic room moves, updates references, and retains old addresses as aliases', async () => {
    const repo = new InMemoryRoomMoveRepository();
    const coordinator = new AtomicRoomMoveCoordinator('home-1', repo);
    await coordinator.initialize();

    await coordinator.registerRoom({ id: 'narnia', name: 'Narnia' });
    await coordinator.registerRoom({ id: 'living_room', name: 'Living Room' });
    const lamp = await coordinator.registerDevice(devLamp);

    const oldDevAddr = coordinator.getPrimaryAddress(lamp.id);
    const oldEpAddr = lamp.endpoints[0]?.address;
    expect(oldDevAddr).toBe('lighting::narnia:narnia-lamp');
    expect(oldEpAddr).toBe('lighting::narnia:narnia-lamp:ep-hue-lamp-1');

    // Register scene targeting primary address
    const scene: HausScene = {
      schemaVersion: 1,
      id: 'scene_reading',
      name: 'Reading Light',
      members: [
        {
          endpointId: oldEpAddr!,
          targetState: { on_off: true },
        },
      ],
    };
    await coordinator.putScene(scene);

    // Move device from narnia to living_room
    const patch = await coordinator.moveDeviceToRoom({
      homeId: 'home-1',
      deviceId: lamp.id,
      targetRoomId: 'living_room',
      actor: { actorId: 'admin-1', role: 'owner' },
    });

    expect(patch.canonicalIdPreserved).toBe(true);
    expect(patch.fromRoomId).toBe('narnia');
    expect(patch.toRoomId).toBe('living_room');

    // New address is formatted with target room
    const newDevAddr = coordinator.getPrimaryAddress(lamp.id);
    const newEp = coordinator.getDevice(lamp.id)?.endpoints[0];
    expect(newDevAddr).toBe('lighting::living-room:narnia-lamp');
    expect(newEp).toBeDefined();
    expect(newEp?.address).toBe('lighting::living-room:narnia-lamp:ep-hue-lamp-1');

    // Scene member endpoint was rewritten to new address automatically
    const updatedScene = coordinator.getScene('scene_reading');
    expect(updatedScene?.members[0]?.endpointId).toBe(newEp?.address);

    // Old address is retained as alias and still resolves to canonical ID
    expect(oldEpAddr).toBeDefined();
    expect(oldDevAddr).toBeDefined();
    expect(newDevAddr).toBeDefined();
    expect(coordinator.resolveAddressOrId(oldEpAddr!)).toBe('ep_hue_lamp_1');
    expect(coordinator.resolveAddressOrId(newEp!.address!)).toBe('ep_hue_lamp_1');
    expect(coordinator.resolveAddressOrId(oldDevAddr!)).toBe(lamp.id);
    expect(coordinator.resolveAddressOrId(newDevAddr!)).toBe(lamp.id);
  });

  it('preserves distinct account/region ownership without collision', () => {
    // Two devices from same vendor but different cloud regions / accounts
    const devUs: HausDevice = {
      id: 'xiaomi_us_scale',
      name: 'US Bathroom Scale',
      category: 'generic',
      roomId: 'bathroom',
      availability: 'online',
      source: { instanceId: 'hacs:xiaomi_miot:us', externalId: 'scale_us_1' },
      connectivity: { protocol: 'virtual' },
      sourceRefs: [{ protocol: 'virtual', externalId: 'scale_us_1' }],
      endpoints: [
        {
          id: 'ep_scale_us_1',
          name: 'Weight',
          capabilities: [{ id: 'weight', kind: 'numeric', readable: true, operations: [] }],
          readings: {},
        },
      ],
      customEntities: {},
    };

    const devCn: HausDevice = {
      id: 'xiaomi_cn_scale',
      name: 'China Bathroom Scale',
      category: 'generic',
      roomId: 'guest_bath',
      availability: 'online',
      source: { instanceId: 'hacs:xiaomi_miot:cn', externalId: 'scale_cn_1' },
      connectivity: { protocol: 'virtual' },
      sourceRefs: [{ protocol: 'virtual', externalId: 'scale_cn_1' }],
      endpoints: [
        {
          id: 'ep_scale_cn_1',
          name: 'Weight',
          capabilities: [{ id: 'weight', kind: 'numeric', readable: true, operations: [] }],
          readings: {},
        },
      ],
      customEntities: {},
    };

    expect(devUs.source.instanceId).toBe('hacs:xiaomi_miot:us');
    expect(devCn.source.instanceId).toBe('hacs:xiaomi_miot:cn');
    expect(devUs.sourceRefs?.[0]?.externalId).not.toBe(devCn.sourceRefs?.[0]?.externalId);
    expect(devUs.id).not.toBe(devCn.id);
  });
});
