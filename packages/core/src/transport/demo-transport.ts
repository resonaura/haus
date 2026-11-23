/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  HomeTransport,
  HomeTransportEvent,
  HomeTransportRequest,
  TransportAction,
  TransportEntityState,
  TransportSnapshot,
} from './contract.js';

export interface DemoHomeTransportOptions<
  TSnapshot extends TransportSnapshot = TransportSnapshot,
  TAction extends TransportAction = TransportAction,
> {
  readonly createSnapshot: () => TSnapshot;
  readonly applyAction: (snapshot: TSnapshot, action: TAction) => TSnapshot;
}

/**
 * Local in-memory `HomeTransport` serving Haus RPC requests (`get_states`, `call_service`,
 * `haus/entity_image`, `update/release_notes`, registry mutations, history) against a fictional
 * demo snapshot so UI components never need demo-specific branching.
 */
export class DemoHomeTransport<
  TSnapshot extends TransportSnapshot = TransportSnapshot,
  TAction extends TransportAction = TransportAction,
> implements HomeTransport<TSnapshot['states'][number]> {
  readonly mode = 'demo' as const;
  private snapshot: TSnapshot;
  private readonly listeners = new Set<
    (event: HomeTransportEvent<TSnapshot['states'][number]>) => void
  >();

  constructor(private readonly options: DemoHomeTransportOptions<TSnapshot, TAction>) {
    this.snapshot = options.createSnapshot();
  }

  getSnapshot(): TSnapshot {
    return this.snapshot;
  }

  reset(): TSnapshot {
    this.snapshot = this.options.createSnapshot();
    this.emit({ type: 'connection', status: 'demo' });
    return this.snapshot;
  }

  onEvent(listener: (event: HomeTransportEvent<TSnapshot['states'][number]>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async subscribe<T = unknown>(
    _message: HomeTransportRequest,
    _onEvent: (event: T) => void,
  ): Promise<() => void> {
    return () => undefined;
  }

  async getSceneConfig(
    entityId: string,
    _sceneId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.snapshot.sceneConfigs?.[entityId] ?? null;
  }

  async request<T = unknown>(message: HomeTransportRequest): Promise<T> {
    const dispatch = (): unknown => {
      switch (message.type) {
        case 'get_states':
          return this.snapshot.states;
        case 'get_services':
          return this.snapshot.services;
        case 'get_config':
          return this.snapshot.config;
        case 'auth/current_user':
          return this.snapshot.user;
        case 'config/area_registry/list':
          return this.snapshot.areas;
        case 'config/device_registry/list':
          return this.snapshot.devices;
        case 'config/entity_registry/list':
          return this.snapshot.entities;
        case 'call_service':
          return this.handleCallService(message);
        case 'haus/entity_image':
          return this.handleEntityImage(message);
        case 'update/release_notes':
          return this.handleUpdateReleaseNotes(message);
        case 'config/area_registry/create':
          return this.handleAreaRegistryCreate(message);
        case 'config/area_registry/update':
          return this.handleAreaRegistryUpdate(message);
        case 'config/area_registry/delete':
          return this.handleAreaRegistryDelete(message);
        case 'config/entity_registry/update':
          return this.handleEntityRegistryUpdate(message);
        case 'config/device_registry/update':
          return this.handleDeviceRegistryUpdate(message);
        case 'history/history_during_period':
        case 'recorder/statistics_during_period':
          return {};
        case 'recorder/list_statistic_ids':
        case 'persistent_notification/get':
          return [];
        case 'repairs/list_issues':
          return { issues: [] };
        default:
          return null;
      }
    };
    return dispatch() as T;
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(event: HomeTransportEvent<TSnapshot['states'][number]>): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private findEntity(rawId: unknown): TransportEntityState | undefined {
    if (typeof rawId !== 'string' || !rawId) return undefined;
    return this.snapshot.states.find(
      (item) => item.entity_id === rawId || item.attributes.haus_ha_entity_id === rawId,
    );
  }

  private handleCallService(message: HomeTransportRequest): { context: { id: string } } {
    const domain = typeof message.domain === 'string' ? message.domain : '';
    const service = typeof message.service === 'string' ? message.service : '';
    const target =
      message.target && typeof message.target === 'object'
        ? (message.target as { entity_id?: unknown })
        : {};
    const entityId = typeof target.entity_id === 'string' ? target.entity_id : '';
    const serviceData =
      message.service_data &&
      typeof message.service_data === 'object' &&
      !Array.isArray(message.service_data)
        ? (message.service_data as Record<string, unknown>)
        : undefined;

    const action = {
      domain,
      service,
      target: { entity_id: entityId },
      ...(serviceData ? { service_data: serviceData } : {}),
    } as TAction;

    const previousById = new Map(
      this.snapshot.states.map((item) => [item.entity_id, item] as const),
    );
    const next = this.options.applyAction(this.snapshot, action);
    this.snapshot = next;

    const contextId = `demo-${Date.now()}`;
    for (const updated of next.states) {
      const oldState = previousById.get(updated.entity_id) ?? null;
      if (oldState !== updated) {
        this.emit({
          type: 'state_changed',
          entityId: updated.entity_id,
          newState: updated,
          oldState,
          context: { id: contextId, user_id: null },
        });
      }
    }

    return { context: { id: contextId } };
  }

  private handleEntityImage(message: HomeTransportRequest): {
    readonly entity_id: string;
    readonly content_type: string;
    readonly dataUrl: string | null;
  } {
    const entity = this.findEntity(message.entity_id);
    const dataUrl =
      typeof entity?.attributes.entity_picture === 'string' &&
      entity.attributes.entity_picture.startsWith('data:image/')
        ? entity.attributes.entity_picture
        : null;
    const contentType =
      typeof entity?.attributes.content_type === 'string'
        ? entity.attributes.content_type
        : 'image/svg+xml';
    return {
      entity_id: entity?.entity_id ?? String(message.entity_id ?? ''),
      content_type: contentType,
      dataUrl,
    };
  }

  private handleUpdateReleaseNotes(message: HomeTransportRequest): string | null {
    const entity = this.findEntity(message.entity_id);
    if (!entity) return null;
    const summary = entity.attributes.release_summary;
    return typeof summary === 'string' && summary.trim() ? summary.trim() : null;
  }

  private handleAreaRegistryCreate(message: HomeTransportRequest): unknown {
    const name = typeof message.name === 'string' ? message.name.trim() : 'Room';
    const areaId = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const area = { area_id: areaId, name };
    this.snapshot = { ...this.snapshot, areas: [...this.snapshot.areas, area] };
    this.emit({ type: 'registry_updated', eventType: 'area_registry_updated' });
    return area;
  }

  private handleAreaRegistryUpdate(message: HomeTransportRequest): unknown {
    const areaId = typeof message.area_id === 'string' ? message.area_id : '';
    const name = typeof message.name === 'string' ? message.name.trim() : undefined;
    let updated: unknown = null;
    this.snapshot = {
      ...this.snapshot,
      areas: this.snapshot.areas.map((area) => {
        if (area.area_id !== areaId) return area;
        const next = { ...area, ...(name ? { name } : {}) };
        updated = next;
        return next;
      }),
    };
    this.emit({ type: 'registry_updated', eventType: 'area_registry_updated' });
    return updated;
  }

  private handleAreaRegistryDelete(message: HomeTransportRequest): { readonly deleted: boolean } {
    const areaId = typeof message.area_id === 'string' ? message.area_id : '';
    this.snapshot = {
      ...this.snapshot,
      areas: this.snapshot.areas.filter((area) => area.area_id !== areaId),
      devices: this.snapshot.devices.map((d) =>
        d.area_id === areaId ? { ...d, area_id: null } : d,
      ),
      entities: this.snapshot.entities.map((e) =>
        e.area_id === areaId ? { ...e, area_id: null } : e,
      ),
    };
    this.emit({ type: 'registry_updated', eventType: 'area_registry_updated' });
    return { deleted: true };
  }

  private handleEntityRegistryUpdate(message: HomeTransportRequest): {
    readonly entity_entry: unknown;
  } {
    const entityId = typeof message.entity_id === 'string' ? message.entity_id : '';
    let updatedEntry: unknown = null;
    this.snapshot = {
      ...this.snapshot,
      entities: this.snapshot.entities.map((entry) => {
        if (entry.entity_id !== entityId) return entry;
        const next = {
          ...entry,
          ...('area_id' in message
            ? { area_id: typeof message.area_id === 'string' ? message.area_id : null }
            : {}),
          ...('name' in message
            ? { name: typeof message.name === 'string' ? message.name : null }
            : {}),
        };
        updatedEntry = next;
        return next;
      }),
    };
    this.emit({ type: 'registry_updated', eventType: 'entity_registry_updated' });
    return { entity_entry: updatedEntry };
  }

  private handleDeviceRegistryUpdate(message: HomeTransportRequest): unknown {
    const deviceId = typeof message.device_id === 'string' ? message.device_id : '';
    let updatedDevice: unknown = null;
    this.snapshot = {
      ...this.snapshot,
      devices: this.snapshot.devices.map((device) => {
        if (device.id !== deviceId) return device;
        const next = {
          ...device,
          ...('area_id' in message
            ? { area_id: typeof message.area_id === 'string' ? message.area_id : null }
            : {}),
          ...('name_by_user' in message
            ? {
                name_by_user:
                  typeof message.name_by_user === 'string' ? message.name_by_user : null,
              }
            : {}),
        };
        updatedDevice = next;
        return next;
      }),
    };
    this.emit({ type: 'registry_updated', eventType: 'device_registry_updated' });
    return updatedDevice;
  }
}
