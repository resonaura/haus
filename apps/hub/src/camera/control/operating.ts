/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { operatingRole } from '@haus/kitsune/native';
import { setTimeout as delay } from 'node:timers/promises';

export interface OperatingControlState {
  id: string;
  available: boolean;
  value: boolean;
}

export type CameraOperatingControls = Partial<
  Record<'indicator' | 'nightVision', OperatingControlState>
>;

export interface CameraOperatingRegistry {
  cameras: {
    id: string;
    deviceId?: string;
    deviceIds?: string[];
    nativeProvider?: unknown;
  }[];
  entities?: {
    entity_id: string;
    device_id?: string;
    platform?: string;
    unique_id?: string;
    translation_key?: string;
    entity_category?: string;
    disabled_by?: unknown;
    hidden_by?: unknown;
  }[];
  states?: {
    entity_id: string;
    state: string;
    attributes?: Record<string, unknown>;
  }[];
}

/** Provider-defined registry property identity, never translated name/room matching. */
export function cameraOperating({
  registry,
  ha,
  native,
}: {
  registry: () => CameraOperatingRegistry;
  ha: {
    connected?: boolean;
    request?(payload: Record<string, unknown>): Promise<unknown>;
  };
  native?: {
    operating(cameraId: string): CameraOperatingControls;
    writeOperating(
      cameraId: string,
      control: 'indicator' | 'nightVision',
      entityId: string,
      value: boolean,
    ): Promise<unknown>;
  };
}) {
  const pending = new Set<string>();
  const read = (cameraId: string): CameraOperatingControls => {
    const data = registry();
    const camera = data.cameras.find((item) => item.id === cameraId);
    if (!camera) return {};
    if (camera.nativeProvider && native) return native.operating(cameraId);
    const devices = new Set(
      [camera.deviceId, ...(camera.deviceIds ?? [])].filter((id): id is string => Boolean(id)),
    );
    const result: CameraOperatingControls = {};
    for (const control of ['indicator', 'nightVision'] as const) {
      const candidates = (data.entities ?? []).filter((entity) => {
        if (
          !entity.device_id ||
          !devices.has(entity.device_id) ||
          entity.disabled_by ||
          entity.hidden_by ||
          !/^(switch|light)\./.test(entity.entity_id)
        )
          return false;
        const state = (data.states ?? []).find((item) => item.entity_id === entity.entity_id);
        return (
          operatingRole({ ...entity, device_id: entity.device_id ?? undefined }, state) === control
        );
      });
      if (candidates.length !== 1) continue;
      const entity = candidates[0];
      const state = (data.states ?? []).find((item) => item.entity_id === entity.entity_id);
      if (!state) continue;
      result[control] = {
        id: entity.entity_id,
        available: ha.connected !== false && ['on', 'off'].includes(state.state),
        value: state.state === 'on',
      };
    }
    return result;
  };
  return {
    read,
    async write(
      cameraId: string,
      control: 'indicator' | 'nightVision',
      entityId: string,
      value: boolean,
    ): Promise<void> {
      const current = read(cameraId)[control];
      if (!current?.available || current.id !== entityId || typeof value !== 'boolean')
        throw Error('camera_control_unavailable');
      const key = `${cameraId}:${control}`;
      if (pending.has(key)) throw Error('camera_control_busy');
      pending.add(key);
      try {
        if (registry().cameras.find((camera) => camera.id === cameraId)?.nativeProvider && native)
          await native.writeOperating(cameraId, control, entityId, value);
        else {
          if (!ha.request) throw Error('camera_control_unavailable');
          await ha.request({
            type: 'call_service',
            domain: entityId.split('.')[0],
            service: value ? 'turn_on' : 'turn_off',
            service_data: { entity_id: entityId },
          });
        }
        const deadline = performance.now() + 6000;
        do {
          const reported = read(cameraId)[control];
          if (!reported?.available || reported.id !== entityId)
            throw Error('camera_control_unavailable');
          if (reported.value === value) return;
          await delay(150);
        } while (performance.now() < deadline);
        throw Error('camera_control_unconfirmed');
      } finally {
        pending.delete(key);
      }
    },
  };
}
