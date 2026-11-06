/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildStableKey,
  type CanonicalProtocol,
  type DeviceRelationship,
  type HausValue,
  type SourceDeviceRef,
} from './graph.js';
import { endpointToServices, servicesToEndpoints } from './mapper.js';
import type { HausDevice } from './types.js';

export type DeviceRegistryEventType =
  | 'device_registered'
  | 'device_updated'
  | 'device_removed'
  | 'characteristic_changed'
  | 'availability_changed';

export interface DeviceRegistryEvent {
  readonly type: DeviceRegistryEventType;
  readonly deviceId: string;
  readonly timestamp: string;
  readonly payload?: unknown;
}

export type DeviceRegistryListener = (event: DeviceRegistryEvent) => void;

/**
 * Universal, protocol-neutral Device Registry implementing canonical 3-tier device graph
 * management, fast indexing by stable keys/source references, and event dispatch.
 */
export class DeviceRegistry {
  private readonly devices = new Map<string, HausDevice>();
  private readonly byStableKey = new Map<string, string>();
  private readonly bySourceRef = new Map<string, string>();
  private readonly listeners = new Set<DeviceRegistryListener>();

  public registerDevice(device: HausDevice): HausDevice {
    const stableKey =
      device.stableKey ??
      (device.source
        ? buildStableKey('virtual', device.source.externalId, device.source.instanceId)
        : device.id);

    const sourceRefs: readonly SourceDeviceRef[] =
      device.sourceRefs && device.sourceRefs.length > 0
        ? device.sourceRefs
        : device.source
          ? [
              {
                protocol: 'virtual',
                externalId: device.source.externalId,
                instanceId: device.source.instanceId,
              },
            ]
          : [];

    const services =
      device.services && device.services.length > 0
        ? device.services
        : device.endpoints && device.endpoints.length > 0
          ? device.endpoints.flatMap(endpointToServices)
          : [];

    const endpoints =
      device.endpoints && device.endpoints.length > 0
        ? device.endpoints
        : servicesToEndpoints(device.id, services);

    const normalized: HausDevice = {
      ...device,
      stableKey,
      sourceRefs,
      services,
      relationships: device.relationships ?? [],
      diagnostics: device.diagnostics ?? {},
      opaqueMetadata: device.opaqueMetadata ?? {},
      endpoints,
    };

    this.devices.set(normalized.id, normalized);
    this.byStableKey.set(stableKey, normalized.id);

    for (const ref of sourceRefs) {
      this.bySourceRef.set(`${ref.protocol}:${ref.externalId}`, normalized.id);
    }

    this.emit({
      type: 'device_registered',
      deviceId: normalized.id,
      timestamp: new Date().toISOString(),
      payload: normalized,
    });

    return normalized;
  }

  public updateDevice(deviceId: string, patch: Partial<HausDevice>): HausDevice | undefined {
    const existing = this.devices.get(deviceId);
    if (!existing) return undefined;

    const updated: HausDevice = {
      ...existing,
      ...patch,
      id: existing.id,
      stableKey: patch.stableKey ?? existing.stableKey,
      services: patch.services ?? existing.services,
      sourceRefs: patch.sourceRefs ?? existing.sourceRefs,
      relationships: patch.relationships ?? existing.relationships,
    };

    this.devices.set(deviceId, updated);

    if (patch.stableKey && patch.stableKey !== existing.stableKey) {
      if (existing.stableKey) this.byStableKey.delete(existing.stableKey);
      this.byStableKey.set(patch.stableKey, deviceId);
    }

    this.emit({
      type: 'device_updated',
      deviceId,
      timestamp: new Date().toISOString(),
      payload: updated,
    });

    return updated;
  }

  public removeDevice(deviceId: string): boolean {
    const existing = this.devices.get(deviceId);
    if (!existing) return false;

    this.devices.delete(deviceId);
    if (existing.stableKey) this.byStableKey.delete(existing.stableKey);

    if (existing.sourceRefs) {
      for (const ref of existing.sourceRefs) {
        this.bySourceRef.delete(`${ref.protocol}:${ref.externalId}`);
      }
    }

    this.emit({
      type: 'device_removed',
      deviceId,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  public getDevice(id: string): HausDevice | undefined {
    return this.devices.get(id);
  }

  public getDeviceByStableKey(stableKey: string): HausDevice | undefined {
    const id = this.byStableKey.get(stableKey);
    return id ? this.devices.get(id) : undefined;
  }

  public getDeviceBySourceRef(
    protocol: CanonicalProtocol,
    externalId: string,
  ): HausDevice | undefined {
    const id = this.bySourceRef.get(`${protocol}:${externalId}`);
    return id ? this.devices.get(id) : undefined;
  }

  public listDevices(): readonly HausDevice[] {
    return Array.from(this.devices.values());
  }

  public getDevicesByArea(areaId: string): readonly HausDevice[] {
    return Array.from(this.devices.values()).filter(
      (d) => d.areaId === areaId || d.roomId === areaId,
    );
  }

  public updateCharacteristicValue(
    deviceId: string,
    serviceId: string,
    characteristicId: string,
    value: HausValue,
    metadata?: Record<string, unknown>,
  ): boolean {
    const device = this.devices.get(deviceId);
    if (!device || !device.services) return false;

    let modified = false;
    const services = device.services.map((service) => {
      if (service.id !== serviceId) return service;
      const characteristics = service.characteristics.map((char) => {
        if (char.id !== characteristicId) return char;
        modified = true;
        return {
          ...char,
          value,
          metadata: metadata ? { ...char.metadata, ...metadata } : char.metadata,
        };
      });
      return { ...service, characteristics };
    });

    if (!modified) return false;

    this.devices.set(deviceId, { ...device, services });
    this.emit({
      type: 'characteristic_changed',
      deviceId,
      timestamp: new Date().toISOString(),
      payload: { serviceId, characteristicId, value },
    });

    return true;
  }

  public linkServices(
    deviceId: string,
    parentServiceId: string,
    linkedServiceIds: readonly string[],
  ): boolean {
    const device = this.devices.get(deviceId);
    if (!device || !device.services) return false;

    let modified = false;
    const services = device.services.map((service) => {
      if (service.id !== parentServiceId) return service;
      modified = true;
      const combined = Array.from(new Set([...service.linkedServiceIds, ...linkedServiceIds]));
      return { ...service, linkedServiceIds: combined };
    });

    if (!modified) return false;
    this.devices.set(deviceId, { ...device, services });
    return true;
  }

  public addRelationship(deviceId: string, relationship: DeviceRelationship): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    const relationships = [...(device.relationships ?? []), relationship];
    this.devices.set(deviceId, { ...device, relationships });
    return true;
  }

  public subscribe(listener: DeviceRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public clear(): void {
    this.devices.clear();
    this.byStableKey.clear();
    this.bySourceRef.clear();
  }

  private emit(event: DeviceRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Safe dispatch: errors in individual listeners are isolated
      }
    }
  }
}
