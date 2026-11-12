/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MockAccessory, MockService, type CharacteristicValue } from './hap.js';

export interface SerializedCharacteristic {
  displayName: string;
  UUID: string;
  value: CharacteristicValue;
  props?: Record<string, unknown>;
}

export interface SerializedService {
  displayName: string;
  UUID: string;
  subtype?: string;
  characteristics: SerializedCharacteristic[];
}

export interface SerializedAccessory {
  plugin: string;
  platform: string;
  displayName: string;
  UUID: string;
  category?: number;
  context: Record<string, unknown>;
  services: SerializedService[];
}

/** Durable accessory cache for Homebridge plugins. */
export class HomebridgeAccessoryCache {
  static serialize(
    pluginName: string,
    platformName: string,
    accessory: MockAccessory,
  ): SerializedAccessory {
    const services: SerializedService[] = accessory.services.map((service) => {
      const characteristics: SerializedCharacteristic[] = Array.from(
        service.characteristics.values(),
      ).map((c) => ({
        displayName: c.displayName,
        UUID: c.UUID,
        value: c.getValue(),
        props: c.props,
      }));
      return {
        displayName: service.displayName,
        UUID: service.UUID,
        subtype: service.subtype,
        characteristics,
      };
    });

    return {
      plugin: pluginName,
      platform: platformName,
      displayName: accessory.displayName,
      UUID: accessory.UUID,
      category: accessory.category,
      context: { ...accessory.context },
      services,
    };
  }

  static deserialize(entry: SerializedAccessory): MockAccessory {
    const accessory = new MockAccessory(entry.displayName, entry.UUID, entry.category);
    accessory.context = { ...entry.context };

    for (const s of entry.services ?? []) {
      const service = new MockService(s.displayName, s.UUID, s.subtype);
      for (const c of s.characteristics ?? []) {
        const char = service.getCharacteristic(c.UUID);
        char.setValue(c.value);
        if (c.props) char.setProps(c.props);
      }
      accessory.addService(service);
    }

    return accessory;
  }

  static getCachePath(storagePath: string): string {
    return join(storagePath, 'accessories', 'cachedAccessories');
  }

  static async load(storagePath: string, pluginName?: string): Promise<MockAccessory[]> {
    const filePath = this.getCachePath(storagePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      const entries = JSON.parse(raw) as SerializedAccessory[];
      if (!Array.isArray(entries)) return [];
      const filtered = pluginName ? entries.filter((e) => e.plugin === pluginName) : entries;
      return filtered.map((e) => this.deserialize(e));
    } catch {
      return [];
    }
  }

  static async save(
    storagePath: string,
    pluginName: string,
    platformName: string,
    accessories: MockAccessory[],
  ): Promise<void> {
    const filePath = this.getCachePath(storagePath);
    await mkdir(dirname(filePath), { recursive: true });

    let existing: SerializedAccessory[] = [];
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      existing = [];
    }

    const remaining = existing.filter(
      (e) => !(e.plugin === pluginName && e.platform === platformName),
    );
    const serialized = accessories.map((acc) => this.serialize(pluginName, platformName, acc));
    const merged = [...remaining, ...serialized];

    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(merged, null, 2), 'utf8');
    await rename(tempPath, filePath);
  }

  static async remove(storagePath: string, uuid: string): Promise<void> {
    const filePath = this.getCachePath(storagePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as SerializedAccessory[];
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((e) => e.UUID !== uuid);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, JSON.stringify(filtered, null, 2), 'utf8');
      await rename(tempPath, filePath);
    } catch {
      // ignore
    }
  }
}
