/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { DeviceCategory } from '@haus/core/device';
import {
  CharacteristicUUID,
  MockAccessory,
  MockCharacteristic,
  MockService,
  ServiceUUID,
} from './hap.js';
import { Categories } from './hap-compat.js';

export interface ProjectedAccessoryMetadata {
  readonly manufacturer?: string;
  readonly model?: string;
  readonly serialNumber?: string;
  readonly firmwareVersion?: string;
}

const CHANGE_LISTENERS = new WeakMap<MockCharacteristic, () => void>();

export function replaceProjectionChangeListener(
  char: MockCharacteristic,
  listener: () => void,
): void {
  const previous = CHANGE_LISTENERS.get(char);
  if (previous) {
    char.off('change', previous);
  }
  CHANGE_LISTENERS.set(char, listener);
  char.on('change', listener);
}

function readServiceStringChar(
  service: MockService | undefined,
  name: string,
  uuid: string,
): string | undefined {
  if (!service) return undefined;
  const char = service.characteristics.get(uuid) ?? service.characteristics.get(name);
  if (!char) return undefined;
  const raw = char.getValue();
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') return undefined;
  return trimmed;
}

function readContextString(
  context: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const val = context[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

export function extractAccessoryMetadata(acc: MockAccessory): ProjectedAccessoryMetadata {
  const infoService = acc.services.find(
    (s) =>
      s.UUID === ServiceUUID.AccessoryInformation ||
      s.displayName === 'Accessory Information' ||
      s.displayName === 'AccessoryInformation',
  );
  const ctx = acc.context ?? {};

  const manufacturer =
    readServiceStringChar(infoService, 'Manufacturer', CharacteristicUUID.Manufacturer) ??
    readContextString(ctx, ['manufacturer']);
  const model =
    readServiceStringChar(infoService, 'Model', CharacteristicUUID.Model) ??
    readContextString(ctx, ['hwModel', 'gvModel', 'model', 'sku']);
  const serialNumber =
    readServiceStringChar(infoService, 'SerialNumber', CharacteristicUUID.SerialNumber) ??
    readContextString(ctx, ['gvDeviceId', 'deviceId', 'serialNumber', 'mac']);
  const firmwareVersion = readServiceStringChar(
    infoService,
    'FirmwareRevision',
    CharacteristicUUID.FirmwareRevision,
  );

  return { manufacturer, model, serialNumber, firmwareVersion };
}

export function deriveAccessoryPrimaryCategory(
  acc: MockAccessory,
  projectedCategories: readonly DeviceCategory[],
): DeviceCategory {
  if (
    (acc.category === Categories.OUTLET || acc.category === Categories.SWITCH) &&
    projectedCategories.includes('power')
  ) {
    return 'power';
  }
  for (const category of projectedCategories) {
    if (category !== 'generic') return category;
  }
  return 'generic';
}

export function matchesProjectedEndpointService(
  service: MockService,
  serviceIndex: number,
  endpointId?: string,
): boolean {
  if (!endpointId) return true;
  if (`${service.displayName.toLowerCase()}_${serviceIndex}` === endpointId) {
    return true;
  }
  if (service.subtype && service.subtype === endpointId) {
    return true;
  }
  return false;
}
