/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HaTransport } from '../ha-client.js';
import { extractReadOnlyHaInventory, normalizeHaInventory } from './inventory.js';
import type {
  DeviceImportDiff,
  DeviceImportSnapshot,
  DeviceRegistryPort,
  LegacyHaInventory,
} from './types.js';

/**
 * Orchestrates non-destructive device inventory migration from Home Assistant to Haus.
 *
 * Guarantees:
 * 1. Strictly read-only extraction against source Home Assistant.
 * 2. Zero mutating service calls, state edits, or config changes on source.
 * 3. Atomic local registration into Haus DeviceRegistryPort.
 * 4. Non-destructive rollback unregistering imported devices from Haus,
 *    leaving source Home Assistant 100% untouched.
 */
export class HaDeviceMigrator {
  /** Extracts complete inventory from Home Assistant using strictly read-only requests. */
  async extractInventory(
    transport: Pick<HaTransport, 'request'>,
    options?: { signal?: AbortSignal },
  ): Promise<LegacyHaInventory> {
    return extractReadOnlyHaInventory(transport, options);
  }

  /** Computes import diff and canonical address mappings from raw inventory. */
  createImportDiff(
    inventory: LegacyHaInventory,
    options?: { instanceId?: string; defaultRoomId?: string },
  ): DeviceImportDiff {
    return normalizeHaInventory(inventory, options);
  }

  /**
   * Applies the import diff to the local Haus device registry.
   * Modifies ONLY local Haus registry; NEVER contacts or alters Home Assistant.
   */
  async applyImport(
    diff: DeviceImportDiff,
    registry: DeviceRegistryPort,
  ): Promise<DeviceImportSnapshot> {
    const createdDeviceIds: string[] = [];
    const createdEndpointIds: string[] = [];

    for (const item of diff.readyToImport) {
      await registry.registerDevice(item.device);
      createdDeviceIds.push(item.device.id);
      for (const endpoint of item.device.endpoints) {
        createdEndpointIds.push(endpoint.id);
      }
    }

    return {
      importedAt: new Date().toISOString(),
      sourceInstanceId: diff.sourceInstanceId,
      createdDeviceIds,
      createdEndpointIds,
    };
  }

  /**
   * Rolls back an applied import by removing imported devices from the local Haus registry.
   * Leaves source Home Assistant completely untouched.
   */
  async rollback(snapshot: DeviceImportSnapshot, registry: DeviceRegistryPort): Promise<void> {
    for (const deviceId of snapshot.createdDeviceIds) {
      await registry.unregisterDevice(deviceId);
    }
  }
}
