/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { App, AppAction } from '@haus/apps';

export type InstalledApp = Pick<
  App,
  'id' | 'name' | 'version' | 'state' | 'available' | 'managed' | 'actions' | 'accessories'
> & {
  externalId: string;
  logs: boolean;
};

export interface CameraAccessory {
  physicalId: string;
  name: string;
  available: boolean;
  imported: boolean;
}

export interface AccessoryInventory {
  connected: boolean;
  cameras: CameraAccessory[];
}

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const actions: AppAction[] = ['start', 'stop', 'restart'];
const states = ['running', 'stopped', 'starting', 'stopping', 'unknown'];

export async function appRequest(
  method: 'GET' | 'POST',
  path: string,
  data?: Record<string, unknown>,
): Promise<unknown> {
  if (!window.hausNative) throw Error('Connect to Haus Hub to manage Apps.');
  return window.hausNative.management({ method, path, ...(data ? { data } : {}) });
}

export function parseApps(value: unknown): InstalledApp[] {
  if (!record(value) || !Array.isArray(value.apps) || !Array.isArray(value.drivers))
    throw Error('The Hub returned an invalid App inventory.');
  const logDrivers = new Set(
    value.drivers.flatMap((driver) =>
      record(driver) &&
      typeof driver.id === 'string' &&
      record(driver.capabilities) &&
      driver.capabilities.logs === true
        ? [driver.id]
        : [],
    ),
  );
  return value.apps.map((item): InstalledApp => {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.state !== 'string' ||
      !states.includes(item.state) ||
      typeof item.available !== 'boolean' ||
      typeof item.managed !== 'boolean' ||
      !Array.isArray(item.actions) ||
      !item.actions.every((action) => actions.includes(action))
    )
      throw Error('The Hub returned an invalid App entry.');
    const externalId =
      record(item.source) &&
      typeof item.source.externalId === 'string' &&
      item.source.externalId.length > 0
        ? item.source.externalId
        : item.id;
    return {
      id: item.id,
      externalId,
      name: item.name,
      state: item.state as App['state'],
      available: item.available,
      managed: item.managed,
      actions: item.actions,
      logs: record(item.source) && logDrivers.has(String(item.source.instanceId)),
      ...(typeof item.version === 'string' ? { version: item.version } : {}),
      ...(record(item.accessories)
        ? {
            accessories: {
              mqtt: item.accessories.mqtt === true,
              camera: item.accessories.camera === true,
            },
          }
        : {}),
    };
  });
}

export function parseAccessories(value: unknown): AccessoryInventory {
  if (!record(value) || typeof value.connected !== 'boolean' || !Array.isArray(value.cameras))
    throw Error('The App returned an invalid accessory inventory.');
  return {
    connected: value.connected,
    cameras: value.cameras.map((camera): CameraAccessory => {
      if (!record(camera) || typeof camera.physicalId !== 'string')
        throw Error('The App returned an invalid camera.');
      return {
        physicalId: camera.physicalId,
        name: typeof camera.name === 'string' ? camera.name : 'Camera',
        available: camera.available === true,
        imported: camera.imported === true,
      };
    }),
  };
}
