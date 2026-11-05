/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';
import type { Capability, Json, Reading } from '@haus/core/types';
import {
  type HausDevice,
  type HausEndpoint,
  type DeviceCategory,
  onOffCapability,
  brightnessCapability,
  motionCapability,
  contactCapability,
  createTemperatureCapability,
  lockCapability,
} from '@haus/core/device';
import {
  MockAccessory,
  MockService,
  HAPServices,
  HAPCharacteristics,
} from './hap.js';

export interface HomebridgePluginModule {
  (api: HomebridgeVirtualApi): void;
}

export type AccessoryConstructor = new (
  log: (msg: string) => void,
  config: Record<string, unknown>,
  api: HomebridgeVirtualApi,
) => {
  getServices?(): MockService[];
};

export type PlatformConstructor = new (
  log: (msg: string) => void,
  config: Record<string, unknown>,
  api: HomebridgeVirtualApi,
) => {
  accessories?(callback: (foundAccessories: MockAccessory[]) => void): void;
};

function makeReading(value: Json): Reading {
  return {
    value,
    freshness: 'live',
    observedAt: new Date().toISOString(),
  };
}

export class HomebridgeVirtualApi extends EventEmitter {
  readonly hap = {
    Service: HAPServices,
    Characteristic: HAPCharacteristics,
    Accessory: MockAccessory,
  };

  private registeredAccessories = new Map<string, AccessoryConstructor>();
  private registeredPlatforms = new Map<string, PlatformConstructor>();
  private devices = new Map<string, HausDevice>();
  private accessories = new Map<string, MockAccessory>();

  registerAccessory(pluginName: string, accessoryName: string, constructor: AccessoryConstructor): void {
    const key = `${pluginName}.${accessoryName}`;
    this.registeredAccessories.set(key, constructor);
  }

  registerPlatform(pluginName: string, platformName: string, constructor: PlatformConstructor): void {
    const key = `${pluginName}.${platformName}`;
    this.registeredPlatforms.set(key, constructor);
  }

  publishExternalAccessories(pluginName: string, accessories: MockAccessory[]): void {
    for (const acc of accessories) {
      this.ingestAccessory(pluginName, acc);
    }
  }

  registerPlatformAccessories(
    pluginName: string,
    _platformName: string,
    accessories: MockAccessory[],
  ): void {
    for (const acc of accessories) {
      this.ingestAccessory(pluginName, acc);
    }
  }

  unregisterPlatformAccessories(
    _pluginName: string,
    _platformName: string,
    accessories: MockAccessory[],
  ): void {
    for (const acc of accessories) {
      const deviceId = `homebridge:${_pluginName}:${acc.UUID}`;
      this.devices.delete(deviceId);
      this.accessories.delete(deviceId);
      this.emit('deviceRemoved', deviceId);
    }
  }

  getDevices(): HausDevice[] {
    return Array.from(this.devices.values());
  }

  getDevice(id: string): HausDevice | undefined {
    return this.devices.get(id);
  }

  private mapServiceToCategory(service: MockService): DeviceCategory {
    const uuid = service.UUID;
    const name = service.displayName;
    if (uuid === HAPServices.Lightbulb.UUID || name === 'Lightbulb') return 'lighting';
    if (uuid === HAPServices.Switch.UUID || name === 'Switch') return 'power';
    if (uuid === HAPServices.Outlet.UUID || name === 'Outlet') return 'power';
    if (uuid === HAPServices.MotionSensor.UUID || name === 'MotionSensor') return 'occupancy_sensors';
    if (uuid === HAPServices.ContactSensor.UUID || name === 'ContactSensor') return 'safety_sensors';
    if (uuid === HAPServices.Thermostat.UUID || name === 'Thermostat') return 'climate';
    if (uuid === HAPServices.LockMechanism.UUID || name === 'LockMechanism') return 'security';
    return 'generic';
  }

  private mapServiceToCapabilities(service: MockService): Capability[] {
    const uuid = service.UUID;
    const name = service.displayName;
    if (uuid === HAPServices.Lightbulb.UUID || name === 'Lightbulb')
      return [onOffCapability, brightnessCapability];
    if (uuid === HAPServices.Switch.UUID || name === 'Switch') return [onOffCapability];
    if (uuid === HAPServices.Outlet.UUID || name === 'Outlet') return [onOffCapability];
    if (uuid === HAPServices.MotionSensor.UUID || name === 'MotionSensor') return [motionCapability];
    if (uuid === HAPServices.ContactSensor.UUID || name === 'ContactSensor') return [contactCapability];
    if (uuid === HAPServices.Thermostat.UUID || name === 'Thermostat') return [createTemperatureCapability()];
    if (uuid === HAPServices.LockMechanism.UUID || name === 'LockMechanism') return [lockCapability];
    return [onOffCapability];
  }

  private getReadingsFromService(service: MockService): Record<string, Reading> {
    const readings: Record<string, Reading> = {};
    const onChar = service.characteristics.get('On') ?? service.characteristics.get(HAPCharacteristics.On.UUID);
    if (onChar) readings.on_off = makeReading(!!onChar.getValue());

    const briChar = service.characteristics.get('Brightness') ?? service.characteristics.get(HAPCharacteristics.Brightness.UUID);
    if (briChar) readings.brightness = makeReading(Number(briChar.getValue()));

    const motionChar = service.characteristics.get('MotionDetected') ?? service.characteristics.get(HAPCharacteristics.MotionDetected.UUID);
    if (motionChar) readings.motion = makeReading(!!motionChar.getValue());

    const contactChar = service.characteristics.get('ContactSensorState') ?? service.characteristics.get(HAPCharacteristics.ContactSensorState.UUID);
    if (contactChar) readings.contact = makeReading(contactChar.getValue() === 0);

    const tempChar = service.characteristics.get('CurrentTemperature') ?? service.characteristics.get(HAPCharacteristics.CurrentTemperature.UUID);
    if (tempChar) readings.temperature = makeReading(Number(tempChar.getValue()));

    const lockChar = service.characteristics.get('LockCurrentState') ?? service.characteristics.get(HAPCharacteristics.LockCurrentState.UUID);
    if (lockChar) readings.lock = makeReading(lockChar.getValue() === 1 ? 'locked' : 'unlocked');

    return readings;
  }

  ingestAccessory(pluginName: string, acc: MockAccessory): HausDevice {
    const deviceId = `homebridge:${pluginName}:${acc.UUID}`;
    this.accessories.set(deviceId, acc);

    const endpoints: HausEndpoint[] = [];
    let primaryCategory: DeviceCategory = 'generic';

    for (let i = 0; i < acc.services.length; i++) {
      const service = acc.services[i];
      if (service.displayName === 'AccessoryInformation') continue;

      const category = this.mapServiceToCategory(service);
      if (primaryCategory === 'generic') primaryCategory = category;

      const capabilities = this.mapServiceToCapabilities(service);
      const readings = this.getReadingsFromService(service);
      const endpointId = `${service.displayName.toLowerCase()}_${i}`;

      endpoints.push({
        id: endpointId,
        address: `${category}::default:${deviceId}:${endpointId}`,
        name: service.displayName,
        capabilities,
        readings,
      });

      // Bind characteristic change listeners
      for (const char of service.characteristics.values()) {
        char.on('change', () => {
          const updated = this.getReadingsFromService(service);
          const currentDevice = this.devices.get(deviceId);
          if (currentDevice) {
            const updatedEndpoints = currentDevice.endpoints.map((ep) =>
              ep.id === endpointId ? { ...ep, readings: { ...ep.readings, ...updated } } : ep,
            );
            this.devices.set(deviceId, { ...currentDevice, endpoints: updatedEndpoints });
          }
          this.emit('deviceStateChanged', deviceId, updated);
        });
      }
    }

    const device: HausDevice = {
      id: deviceId,
      source: { instanceId: 'homebridge', externalId: deviceId },
      name: acc.displayName,
      category: primaryCategory,
      availability: 'online',
      connectivity: { protocol: 'virtual' },
      endpoints,
      customEntities: {},
    };

    this.devices.set(deviceId, device);
    this.emit('deviceDiscovered', device);
    return device;
  }

  executeCommand(
    deviceId: string,
    _endpointId: string,
    capabilityKind: string,
    value: unknown,
  ): boolean {
    const acc = this.accessories.get(deviceId);
    if (!acc) return false;

    for (const service of acc.services) {
      if (capabilityKind === 'on_off') {
        const char = service.characteristics.get('On') ?? service.characteristics.get(HAPCharacteristics.On.UUID);
        if (char) {
          char.setValue(!!value);
          return true;
        }
      } else if (capabilityKind === 'brightness') {
        const char = service.characteristics.get('Brightness') ?? service.characteristics.get(HAPCharacteristics.Brightness.UUID);
        if (char) {
          char.setValue(Number(value));
          return true;
        }
      } else if (capabilityKind === 'lock') {
        const target = service.characteristics.get('LockTargetState') ?? service.characteristics.get(HAPCharacteristics.LockTargetState.UUID);
        if (target) {
          target.setValue(value === 'locked' ? 1 : 0);
          return true;
        }
      }
    }

    return false;
  }
}
