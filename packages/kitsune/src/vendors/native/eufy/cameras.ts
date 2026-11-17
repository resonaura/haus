/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { cameraSource } from '@haus/media/source';
import { EufySession, isEufySerial, type EufyDeviceEventMessage } from './eufy-session.js';

export interface EufyCamera {
  readonly serial: string;
  readonly name: string;
  readonly model: string;
  readonly rtspUrl: string;
  readonly panTilt: boolean;
  readonly operating: { indicator?: boolean; nightVision?: boolean };
  setOperating(control: 'indicator' | 'nightVision', value: boolean): Promise<void>;
}

export type EufyCameraEvent =
  | { readonly serial: string; readonly type: 'motion'; readonly value: boolean }
  | {
      readonly serial: string;
      readonly type: 'indicator' | 'nightVision';
      readonly value: boolean;
    };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function eufyCameraEvent(event?: EufyDeviceEventMessage): EufyCameraEvent | undefined {
  if (event?.source !== 'device' || !isEufySerial(event.serialNumber)) return undefined;
  if (event.event === 'motion detected' && typeof event.state === 'boolean') {
    return { serial: event.serialNumber, type: 'motion', value: event.state };
  }
  if (event.event !== 'property changed' || typeof event.value !== 'boolean') return undefined;
  switch (event.name) {
    case 'motionDetected':
      return { serial: event.serialNumber, type: 'motion', value: event.value };
    case 'statusLed':
      return { serial: event.serialNumber, type: 'indicator', value: event.value };
    case 'autoNightvision':
      return { serial: event.serialNumber, type: 'nightVision', value: event.value };
  }
}

export class EufyCameraSession extends EufySession {
  async cameras(): Promise<EufyCamera[]> {
    const { devices } = record(this.initialState);
    if (!Array.isArray(devices)) return [];
    const cameras: EufyCamera[] = [];
    const seen = new Set<string>();
    for (const raw of devices) {
      const device = record(raw);
      const serial = typeof raw === 'string' ? raw : device.serialNumber;
      if (!isEufySerial(serial) || seen.has(serial)) continue;
      seen.add(serial);
      const result = await this.command('device.get_properties', { serialNumber: serial });
      if (result.serialNumber !== undefined && result.serialNumber !== serial) {
        throw Error('eufy_device_identity_mismatch');
      }
      const props = record(result.properties);
      if (typeof props.rtspStreamUrl !== 'string') continue;
      const source = await cameraSource({ kind: 'rtsp', url: props.rtspStreamUrl }).catch(
        () => undefined,
      );
      if (!source) continue;
      const ptz = await this.command('device.has_command', {
        serialNumber: serial,
        commandName: 'devicePanAndTilt',
      });
      cameras.push({
        serial,
        name:
          typeof props.name === 'string' && props.name
            ? props.name
            : typeof device.name === 'string' && device.name
              ? device.name
              : 'Eufy Camera',
        model:
          typeof props.model === 'string'
            ? props.model
            : typeof device.model === 'string'
              ? device.model
              : '',
        rtspUrl: source.url,
        panTilt: ptz.exists === true,
        operating: {
          ...(typeof props.statusLed === 'boolean' ? { indicator: props.statusLed } : {}),
          ...(typeof props.autoNightvision === 'boolean'
            ? { nightVision: props.autoNightvision }
            : {}),
        },
        setOperating: async (control, value) => {
          await this.command('device.set_property', {
            serialNumber: serial,
            name: control === 'indicator' ? 'statusLed' : 'autoNightvision',
            value,
          });
        },
      });
    }
    return cameras;
  }
}
