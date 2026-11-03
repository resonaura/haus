/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type * as Hap from '@homebridge/hap-nodejs';
import type { Entry } from './contracts.js';

export interface SpotlightState {
  id: string;
  available: boolean;
  on: boolean;
  brightness?: number;
  hue?: number;
  saturation?: number;
  colorTemperature?: number;
  capabilities: {
    brightness: boolean;
    color: boolean;
    colorTemperature?: { minKelvin: number; maxKelvin: number };
  };
}
export interface SpotlightSource {
  read: (cameraId: string) => SpotlightState | undefined;
  write: (
    cameraId: string,
    entityId: string,
    value: {
      on?: boolean;
      brightness?: number;
      hue?: number;
      saturation?: number;
      colorTemperature?: number;
    },
  ) => Promise<void>;
}

/** Light and canonical motion stay attached to the camera's existing HAP accessory identity. */
export function syncCameraSpotlight(
  entry: Entry,
  hap: typeof Hap,
  source: SpotlightSource | undefined,
) {
  if (!source) return;
  const state = source.read(entry.cameraId),
    old = entry.spotlight;
  if (!state) {
    if (old) old.service.updateCharacteristic(hap.Characteristic.StatusFault, 1);
    return;
  }
  const signature = JSON.stringify(state.capabilities);
  if (!old || old.signature !== signature) {
    if (old) entry.accessory.removeService(old.service);
    const service = new hap.Service.Lightbulb('Spotlight', 'spotlight');
    const current = () => {
      const current = source.read(entry.cameraId);
      if (entry.closed || !current?.available)
        throw new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      return current;
    };
    const characteristic = (
      type: typeof hap.Characteristic.On,
      get: (value: SpotlightState) => number | boolean,
      set: (value: number | boolean) => Parameters<SpotlightSource['write']>[2],
    ) => {
      service
        .getCharacteristic(type)
        .onGet(() => get(current()))
        .onSet(async (value) => {
          const observed = current();
          await source.write(entry.cameraId, observed.id, set(value as number | boolean));
        });
    };
    characteristic(
      hap.Characteristic.On,
      (value) => value.on,
      (value) => ({ on: Boolean(value) }),
    );
    if (state.capabilities.brightness)
      characteristic(
        hap.Characteristic.Brightness,
        (value) => value.brightness ?? 0,
        (value) => ({ brightness: Number(value) }),
      );
    if (state.capabilities.color) {
      characteristic(
        hap.Characteristic.Hue,
        (value) => value.hue ?? 0,
        (value) => ({ hue: Number(value) }),
      );
      characteristic(
        hap.Characteristic.Saturation,
        (value) => value.saturation ?? 0,
        (value) => ({ saturation: Number(value) }),
      );
    }
    const temperature = state.capabilities.colorTemperature;
    if (temperature) {
      const min = Math.max(140, Math.ceil(1000000 / temperature.maxKelvin)),
        max = Math.min(500, Math.floor(1000000 / temperature.minKelvin));
      if (min <= max) {
        service
          .getCharacteristic(hap.Characteristic.ColorTemperature)
          .setProps({ minValue: min, maxValue: max });
        characteristic(
          hap.Characteristic.ColorTemperature,
          (value) =>
            Math.max(
              min,
              Math.min(
                max,
                Math.round(1000000 / (value.colorTemperature ?? temperature.minKelvin)),
              ),
            ),
          (value) => ({ colorTemperature: Math.round(1000000 / Number(value)) }),
        );
      }
    }
    service.addOptionalCharacteristic(hap.Characteristic.StatusFault);
    entry.accessory.addService(service);
    entry.spotlight = { service, signature };
  }
  const service = entry.spotlight!.service;
  service.updateCharacteristic(hap.Characteristic.StatusFault, state.available ? 0 : 1);
  if (!state.available) return;
  service.updateCharacteristic(hap.Characteristic.On, state.on);
  if (state.capabilities.brightness && state.brightness !== undefined)
    service.updateCharacteristic(hap.Characteristic.Brightness, state.brightness);
  if (state.capabilities.color) {
    if (state.hue !== undefined) service.updateCharacteristic(hap.Characteristic.Hue, state.hue);
    if (state.saturation !== undefined)
      service.updateCharacteristic(hap.Characteristic.Saturation, state.saturation);
  }
  if (service.testCharacteristic(hap.Characteristic.ColorTemperature) && state.colorTemperature) {
    const characteristic = service.getCharacteristic(hap.Characteristic.ColorTemperature);
    characteristic.updateValue(
      Math.max(
        characteristic.props.minValue ?? 140,
        Math.min(
          characteristic.props.maxValue ?? 500,
          Math.round(1000000 / state.colorTemperature),
        ),
      ),
    );
  }
}
