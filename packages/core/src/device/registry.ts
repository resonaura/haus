/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildStableKey,
  type CanonicalProtocol,
  type DeviceRelationship,
  type HausValue,
  type SourceDeviceRef,
} from './graph.js';
import { collapseEndpointsToServices, isDerivedEndpointServices } from './collapse.js';
import { computeDevicePresentation } from './presentation.js';
import { servicesToEndpoints } from './mapper.js';
import { normalizeDeviceEndpointsForHap } from './naming.js';
import type { HausDevice, HausEndpoint } from './types.js';

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
  private readonly byEndpointId = new Map<string, string>();
  private readonly listeners = new Set<DeviceRegistryListener>();

  private unindexEndpoints(device: HausDevice | undefined): void {
    if (!device) return;
    for (const ep of device.endpoints) {
      if (this.byEndpointId.get(ep.id) === device.id) {
        this.byEndpointId.delete(ep.id);
        for (const other of this.devices.values()) {
          if (
            other.id !== device.id &&
            other.endpoints.some((candidate) => candidate.id === ep.id)
          ) {
            this.byEndpointId.set(ep.id, other.id);
            break;
          }
        }
      }
    }
  }

  private indexEndpoints(device: HausDevice): void {
    for (const ep of device.endpoints) {
      this.byEndpointId.set(ep.id, device.id);
    }
  }

  public registerDevice(device: HausDevice): HausDevice {
    const previous = this.devices.get(device.id);
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

    const hasEndpoints = Boolean(device.endpoints && device.endpoints.length > 0);
    const endpoints = hasEndpoints
      ? normalizeDeviceEndpointsForHap(device)
      : servicesToEndpoints(device.id, device.services ?? []);

    const services =
      hasEndpoints && isDerivedEndpointServices(device.services)
        ? collapseEndpointsToServices({ ...device, endpoints })
        : device.services && device.services.length > 0
          ? device.services
          : [];

    const presentation = computeDevicePresentation({ ...device, endpoints }, services);
    const hasPresentation = Object.keys(presentation).length > 0;
    const baseOpaque: Record<string, unknown> = { ...device.opaqueMetadata };
    if (hasPresentation) baseOpaque.presentation = presentation;
    else delete baseOpaque.presentation;
    const resolvedDeviceType = presentation.deviceType ?? device.deviceType;

    const normalized: HausDevice = {
      ...device,
      ...(resolvedDeviceType ? { deviceType: resolvedDeviceType } : {}),
      stableKey,
      sourceRefs,
      services,
      relationships: device.relationships ?? [],
      diagnostics: device.diagnostics ?? {},
      opaqueMetadata: baseOpaque,
      endpoints,
    };

    if (previous) {
      this.unindexEndpoints(previous);
      if (previous.stableKey && previous.stableKey !== stableKey) {
        this.byStableKey.delete(previous.stableKey);
      }
    }
    this.devices.set(normalized.id, normalized);
    this.byStableKey.set(stableKey, normalized.id);
    this.indexEndpoints(normalized);

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

    const merged: HausDevice = {
      ...existing,
      ...patch,
      id: existing.id,
      stableKey: patch.stableKey ?? existing.stableKey,
      sourceRefs: patch.sourceRefs ?? existing.sourceRefs,
      relationships: patch.relationships ?? existing.relationships,
    };
    const recomputeHap =
      (patch.name !== undefined ||
        patch.endpoints !== undefined ||
        patch.deviceType !== undefined) &&
      merged.endpoints.length > 0;
    const endpoints = recomputeHap ? normalizeDeviceEndpointsForHap(merged) : merged.endpoints;
    const services =
      patch.services !== undefined
        ? patch.services
        : recomputeHap && isDerivedEndpointServices(existing.services)
          ? collapseEndpointsToServices({ ...merged, endpoints })
          : existing.services;
    const presentation = computeDevicePresentation({ ...merged, endpoints }, services ?? []);
    const baseOpaque: Record<string, unknown> = { ...merged.opaqueMetadata };
    if (Object.keys(presentation).length > 0) baseOpaque.presentation = presentation;
    else delete baseOpaque.presentation;
    const resolvedDeviceType = presentation.deviceType ?? merged.deviceType;
    const updated: HausDevice = {
      ...merged,
      ...(resolvedDeviceType ? { deviceType: resolvedDeviceType } : {}),
      opaqueMetadata: baseOpaque,
      endpoints,
      services,
    };

    if (patch.endpoints) {
      this.unindexEndpoints(existing);
    }
    this.devices.set(deviceId, updated);
    if (patch.endpoints) {
      this.indexEndpoints(updated);
    }

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
    this.unindexEndpoints(existing);
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

  public getDeviceByEndpointId(endpointId: string): HausDevice | undefined {
    const id = this.byEndpointId.get(endpointId);
    return id ? this.devices.get(id) : undefined;
  }

  public getEndpoint(
    endpointId: string,
  ): { readonly device: HausDevice; readonly endpoint: HausEndpoint } | undefined {
    const device = this.getDeviceByEndpointId(endpointId);
    if (!device) return undefined;
    const endpoint = device.endpoints.find((ep) => ep.id === endpointId);
    return endpoint ? { device, endpoint } : undefined;
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
    this.byEndpointId.clear();
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
