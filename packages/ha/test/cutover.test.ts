/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { LocalAutomationEngine, type AutomationExecutorEnvironment } from '@haus/core/automation';
import { DeviceCategory, Protocol, type HausDevice } from '@haus/core/device';
import {
  AttendedCutoverCoordinator,
  computeZeroLossVerificationDiff,
  CutoverBlockedError,
  CutoverPhase,
  InMemoryDeviceRegistry,
  validateParallelHealth,
  type CutoverIntent,
  type DeviceImportDiff,
  type LegacyHaInventory,
  type MigrationDiff,
} from '../src/index.js';

describe('P6.5: Zero-Loss Attended Migration & Parallel Cutover Verification', () => {
  const createMockDevice = (id: string, name: string): HausDevice => ({
    id: `device_${id}`,
    source: { instanceId: 'legacy-ha', externalId: id },
    name,
    category: DeviceCategory.Lighting,
    connectivity: { protocol: Protocol.Zigbee },
    availability: 'online',
    endpoints: [
      {
        id: `light.${id}`,
        name,
        category: DeviceCategory.Lighting,
        capabilities: [],
        readings: { on_off: { value: true, freshness: 'live' } },
      },
    ],
  });

  const mockEnv: AutomationExecutorEnvironment = {
    now: () => Date.now(),
    executeAction: async () => {},
  };

  it('validateParallelHealth blocks cutover if new Hub is degraded or missing components', async () => {
    const registry = new InMemoryDeviceRegistry();
    const engine = new LocalAutomationEngine(mockEnv);

    // 1. Empty registry -> blocked
    const reportEmpty = await validateParallelHealth({
      deviceRegistry: registry,
      automationEngine: engine,
    });
    expect(reportEmpty.healthy).toBe(false);
    expect(reportEmpty.issues.some((i) => i.includes('No devices found'))).toBe(true);

    // Add device
    registry.registerDevice(createMockDevice('lamp', 'Desk Lamp'));

    // 2. Protocol failure -> blocked
    const reportProtocolFail = await validateParallelHealth({
      deviceRegistry: registry,
      automationEngine: engine,
      protocolStatus: {
        mqtt: { ready: true },
        matter: { ready: false, error: 'Socket bind failed' },
        zigbee: { ready: true },
        thread: { ready: true },
        homekit: { ready: true },
      },
    });
    expect(reportProtocolFail.healthy).toBe(false);
    expect(
      reportProtocolFail.issues.some((i) => i.includes("Protocol 'matter' is not ready")),
    ).toBe(true);

    // 3. Storage failure -> blocked
    const reportStorageFail = await validateParallelHealth({
      deviceRegistry: registry,
      automationEngine: engine,
      storageIntegrity: false,
    });
    expect(reportStorageFail.healthy).toBe(false);
    expect(reportStorageFail.issues.some((i) => i.includes('Storage or cryptographic vault'))).toBe(
      true,
    );
  });

  it('validateParallelHealth confirms healthy status when all criteria pass', async () => {
    const registry = new InMemoryDeviceRegistry();
    registry.registerDevice(createMockDevice('spot_1', 'Spotlight 1'));
    registry.registerDevice(createMockDevice('spot_2', 'Spotlight 2'));
    const engine = new LocalAutomationEngine(mockEnv);

    const report = await validateParallelHealth({
      deviceRegistry: registry,
      automationEngine: engine,
      storageIntegrity: true,
    });

    expect(report.healthy).toBe(true);
    expect(report.hubStatus).toBe('ok');
    expect(report.deviceCount).toBe(2);
    expect(report.healthyDeviceCount).toBe(2);
    expect(report.issues).toHaveLength(0);
  });

  it('computeZeroLossVerificationDiff ensures zero dropped entities and generates SHA-256 checksum', () => {
    const sampleInventory: LegacyHaInventory = {
      areas: [],
      devices: [{ id: 'dev_1', name: 'Device 1' }],
      entities: [
        { entity_id: 'light.dev_1', device_id: 'dev_1' },
        { entity_id: 'automation.night_mode' }, // Excluded domain
      ],
      states: [
        { entity_id: 'light.dev_1', state: 'on', attributes: {} },
        { entity_id: 'automation.night_mode', state: 'on', attributes: {} },
      ],
    };

    const cleanDiff: DeviceImportDiff = {
      readyToImport: [
        {
          device: createMockDevice('dev_1', 'Device 1'),
          sourceEntityIds: ['light.dev_1'],
          canonicalAddresses: ['lighting::home:dev-1:light'],
        },
      ],
      unsupported: [],
      totalEntities: 2,
      importedDevicesCount: 1,
      importedEndpointsCount: 1,
      sourceInstanceId: 'ha-source',
    };

    const result = computeZeroLossVerificationDiff({
      sourceInventory: sampleInventory,
      importedDiff: cleanDiff,
    });

    expect(result.verified).toBe(true);
    expect(result.missingEntityIds).toHaveLength(0);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);

    // If an entity was missing
    const incompleteDiff: DeviceImportDiff = {
      ...cleanDiff,
      readyToImport: [],
      importedEndpointsCount: 0,
    };

    const incompleteResult = computeZeroLossVerificationDiff({
      sourceInventory: sampleInventory,
      importedDiff: incompleteDiff,
    });

    expect(incompleteResult.verified).toBe(false);
    expect(incompleteResult.missingEntityIds).toContain('light.dev_1');
  });

  it('AttendedCutoverCoordinator enforces parallel validation before allowing approval', async () => {
    const coordinator = new AttendedCutoverCoordinator();
    const registry = new InMemoryDeviceRegistry();
    const engine = new LocalAutomationEngine(mockEnv);

    const emptyDiff: DeviceImportDiff = {
      readyToImport: [],
      unsupported: [],
      totalEntities: 0,
      importedDevicesCount: 0,
      importedEndpointsCount: 0,
      sourceInstanceId: 'ha-test',
    };

    const emptyInventory: LegacyHaInventory = {
      areas: [],
      devices: [],
      entities: [],
      states: [],
    };

    // Should throw CutoverBlockedError because deviceCount === 0
    await expect(
      coordinator.validateBeforeCutover({
        sourceInventory: emptyInventory,
        deviceDiff: emptyDiff,
        deviceRegistry: registry,
        automationEngine: engine,
      }),
    ).rejects.toThrow(CutoverBlockedError);

    expect(coordinator.currentPhase).toBe(CutoverPhase.ParallelValidation);
  });

  it('AttendedCutoverCoordinator executes full attended cutover with user confirmation and supports rollback', async () => {
    const coordinator = new AttendedCutoverCoordinator();
    const registry = new InMemoryDeviceRegistry();
    const engine = new LocalAutomationEngine(mockEnv);

    // Populate registry with a verified device for parallel health check
    const mockDev = createMockDevice('switch_1', 'Living Room Switch');
    registry.registerDevice(mockDev);

    const deviceDiff: DeviceImportDiff = {
      readyToImport: [
        {
          device: mockDev,
          sourceEntityIds: ['light.switch_1'],
          canonicalAddresses: ['lighting::living-room:switch-1'],
        },
      ],
      unsupported: [],
      totalEntities: 1,
      importedDevicesCount: 1,
      importedEndpointsCount: 1,
      sourceInstanceId: 'ha-live',
    };

    const inventory: LegacyHaInventory = {
      areas: [],
      devices: [{ id: 'switch_1', name: 'Living Room Switch' }],
      entities: [{ entity_id: 'light.switch_1', device_id: 'switch_1' }],
      states: [{ entity_id: 'light.switch_1', state: 'on', attributes: {} }],
    };

    const automationDiff: MigrationDiff = {
      readyToMigrate: [],
      unsupported: [],
      totalCount: 0,
      supportedCount: 0,
      unsupportedCount: 0,
      duplicateActiveWarning: false,
      haAutomationsToDisable: [],
    };

    // 1. Parallel validation
    const { healthReport, verificationDiff } = await coordinator.validateBeforeCutover({
      sourceInventory: inventory,
      deviceDiff,
      deviceRegistry: registry,
      automationEngine: engine,
    });

    expect(healthReport.healthy).toBe(true);
    expect(verificationDiff.verified).toBe(true);
    expect(coordinator.currentPhase).toBe(CutoverPhase.AwaitingUserApproval);

    // 2. Reject cutover without valid confirmation code
    const invalidIntent: CutoverIntent = {
      confirmedByUser: false,
      confirmationCode: 'WRONG-CODE',
      timestamp: new Date().toISOString(),
      userIdentifier: 'admin',
    };

    await expect(
      coordinator.executeAttendedCutover({
        intent: invalidIntent,
        deviceDiff,
        automationDiff,
        deviceRegistry: registry,
        automationEngine: engine,
        onQuiesceLegacyInstance: async () => {},
      }),
    ).rejects.toThrow('User confirmation rejected');

    // 3. Execute cutover with valid confirmation code
    const validIntent: CutoverIntent = {
      confirmedByUser: true,
      confirmationCode: 'CONFIRM-CUTOVER-HAUS',
      timestamp: new Date().toISOString(),
      userIdentifier: 'admin',
    };

    let legacyQuiesced = false;
    let postVerifyCalled = false;

    const cutoverResult = await coordinator.executeAttendedCutover({
      intent: validIntent,
      deviceDiff,
      automationDiff,
      deviceRegistry: registry,
      automationEngine: engine,
      onQuiesceLegacyInstance: async () => {
        legacyQuiesced = true;
      },
      onPostCutoverVerify: async () => {
        postVerifyCalled = true;
        return true;
      },
    });

    expect(cutoverResult.success).toBe(true);
    expect(cutoverResult.phase).toBe(CutoverPhase.Completed);
    expect(legacyQuiesced).toBe(true);
    expect(postVerifyCalled).toBe(true);
    expect(coordinator.availableCheckpoints).toHaveLength(1);

    // 4. Test rollback procedure
    const checkpoint = coordinator.availableCheckpoints[0]!;
    let legacyReenabled = false;

    await coordinator.rollbackToCheckpoint({
      checkpoint,
      deviceRegistry: registry,
      automationEngine: engine,
      onReenableLegacyInstance: async () => {
        legacyReenabled = true;
      },
    });

    expect(coordinator.currentPhase).toBe(CutoverPhase.RolledBack);
    expect(legacyReenabled).toBe(true);
    // Devices removed on rollback
    expect(registry.getAllDevices()).toHaveLength(0);
  });

  it('validates zero-loss migration at representative scale (1052 entities, 199 devices)', () => {
    // Generate scale mock inventory
    const scaleDevices = Array.from({ length: 199 }, (_, i) => ({
      id: `dev_${i}`,
      name: `Device ${i}`,
    }));

    const scaleEntities = Array.from({ length: 1052 }, (_, i) => ({
      entity_id: i < 50 ? `automation.rule_${i}` : `sensor.reading_${i}`,
      device_id: i >= 50 ? `dev_${(i - 50) % 199}` : undefined,
    }));

    const scaleStates = scaleEntities.map((e) => ({
      entity_id: e.entity_id,
      state: 'on',
      attributes: {},
    }));

    const scaleInventory: LegacyHaInventory = {
      areas: [],
      devices: scaleDevices,
      entities: scaleEntities,
      states: scaleStates,
    };

    // Non-automation entities: 1052 - 50 = 1002
    const targetEndpoints = Array.from({ length: 1002 }, (_, i) => ({
      id: `sensor.reading_${i + 50}`,
      name: `Sensor ${i + 50}`,
      category: DeviceCategory.EnvironmentalSensors,
      capabilities: [],
      readings: {},
    }));

    const targetDevices = scaleDevices.map((d, i) => ({
      device: {
        id: `device_${d.id}`,
        source: { instanceId: 'scale-ha', externalId: d.id },
        name: d.name,
        category: DeviceCategory.EnvironmentalSensors,
        connectivity: { protocol: Protocol.Zigbee },
        availability: 'online' as const,
        endpoints: targetEndpoints.filter((_, idx) => idx % 199 === i),
      },
      sourceEntityIds: targetEndpoints.filter((_, idx) => idx % 199 === i).map((ep) => ep.id),
      canonicalAddresses: targetEndpoints
        .filter((_, idx) => idx % 199 === i)
        .map((ep) => `sensor::home:dev-${i}:${ep.id}`),
    }));

    const scaleDiff: DeviceImportDiff = {
      readyToImport: targetDevices,
      unsupported: [],
      totalEntities: 1052,
      importedDevicesCount: 199,
      importedEndpointsCount: 1002,
      sourceInstanceId: 'scale-ha',
    };

    const diffResult = computeZeroLossVerificationDiff({
      sourceInventory: scaleInventory,
      importedDiff: scaleDiff,
    });

    expect(diffResult.verified).toBe(true);
    expect(diffResult.sourceEntitiesCount).toBe(1052);
    expect(diffResult.sourceDevicesCount).toBe(199);
    expect(diffResult.targetEndpointsCount).toBe(1002);
    expect(diffResult.missingEntityIds).toHaveLength(0);
    expect(diffResult.checksum).toBeDefined();
  });
});
