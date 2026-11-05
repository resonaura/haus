/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HausDevice } from '../device/types.js';
import { ProtocolEventDispatcher } from './events.js';
import type {
  ProtocolAdapterContext,
  ProtocolAdapterState,
  ProtocolCommandTarget,
  ProtocolDeviceAvailabilityEvent,
  ProtocolDeviceDiscoveryEvent,
  ProtocolDeviceRemovalEvent,
  ProtocolDeviceStateEvent,
  ProtocolKind,
} from './types.js';

export abstract class ProtocolDeviceAdapter<
  TConfig = unknown,
  TDeviceMetadata = unknown,
> extends ProtocolEventDispatcher {
  public abstract readonly protocol: ProtocolKind;

  protected _state: ProtocolAdapterState = 'uninitialized';
  protected readonly context: ProtocolAdapterContext;
  protected readonly config: TConfig;
  protected readonly devices = new Map<string, HausDevice>();
  protected readonly metadata = new Map<string, TDeviceMetadata>();

  public constructor(context: ProtocolAdapterContext, config: TConfig) {
    super();
    this.context = context;
    this.config = config;
  }

  public get state(): ProtocolAdapterState {
    return this._state;
  }

  public get homeId(): string {
    return this.context.homeId;
  }

  public get hubId(): string {
    return this.context.hubId;
  }

  public getKnownDevices(): HausDevice[] {
    return Array.from(this.devices.values());
  }

  public getDevice(deviceId: string): HausDevice | undefined {
    return this.devices.get(deviceId);
  }

  public getDeviceMetadata(deviceId: string): TDeviceMetadata | undefined {
    return this.metadata.get(deviceId);
  }

  public assertExclusiveOwner(resourceId: string): void {
    const resources = this.context.exclusiveResources ?? [];
    if (!resources.includes(resourceId)) {
      throw new Error(
        `Exclusive ownership violation: Hub '${this.hubId}' is not the assigned owner of resource '${resourceId}'.`,
      );
    }
  }

  public abstract start(): Promise<void>;
  public abstract stop(): Promise<void>;
  public abstract discoverDevices(timeoutMs?: number): Promise<HausDevice[]>;
  public abstract pairDevice(params: unknown): Promise<HausDevice>;
  public abstract unpairDevice(deviceId: string): Promise<void>;
  public abstract executeCommand(target: ProtocolCommandTarget): Promise<boolean>;

  protected emitDiscovered(device: HausDevice, meta?: TDeviceMetadata): void {
    this.devices.set(device.id, device);
    if (meta !== undefined) {
      this.metadata.set(device.id, meta);
    }
    const event: ProtocolDeviceDiscoveryEvent = {
      protocol: this.protocol,
      device,
    };
    this.emit('discovered', event);
  }

  protected emitStateChanged(
    deviceId: string,
    endpointId: string,
    state: Record<string, unknown>,
  ): void {
    const event: ProtocolDeviceStateEvent = {
      protocol: this.protocol,
      deviceId,
      endpointId,
      state,
      timestamp: Date.now(),
    };
    this.emit('state_changed', event);
  }

  protected emitAvailabilityChanged(deviceId: string, available: boolean): void {
    const device = this.devices.get(deviceId);
    if (device) {
      this.devices.set(deviceId, {
        ...device,
        availability: available ? 'online' : 'offline',
      });
    }
    const event: ProtocolDeviceAvailabilityEvent = {
      protocol: this.protocol,
      deviceId,
      available,
      timestamp: Date.now(),
    };
    this.emit('availability_changed', event);
  }

  protected emitRemoved(deviceId: string): void {
    this.devices.delete(deviceId);
    this.metadata.delete(deviceId);
    const event: ProtocolDeviceRemovalEvent = {
      protocol: this.protocol,
      deviceId,
      timestamp: Date.now(),
    };
    this.emit('removed', event);
  }
}
