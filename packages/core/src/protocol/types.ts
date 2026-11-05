/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '../device/types.js';

export type ProtocolKind = 'matter' | 'mqtt' | 'zigbee' | 'thread' | 'homekit' | 'custom';

export type ProtocolAdapterState =
  'uninitialized' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export interface ProtocolDeviceDiscoveryEvent {
  readonly protocol: ProtocolKind;
  readonly device: HausDevice;
}

export interface ProtocolDeviceStateEvent {
  readonly protocol: ProtocolKind;
  readonly deviceId: string;
  readonly endpointId: string;
  readonly state: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ProtocolDeviceAvailabilityEvent {
  readonly protocol: ProtocolKind;
  readonly deviceId: string;
  readonly available: boolean;
  readonly timestamp: number;
}

export interface ProtocolDeviceRemovalEvent {
  readonly protocol: ProtocolKind;
  readonly deviceId: string;
  readonly timestamp: number;
}

export interface ProtocolCommandTarget {
  readonly deviceId: string;
  readonly endpointId: string;
  readonly capability: string;
  readonly value: unknown;
}

export interface ProtocolAdapterContext {
  readonly homeId: string;
  readonly hubId: string;
  readonly exclusiveResources?: readonly string[];
}
