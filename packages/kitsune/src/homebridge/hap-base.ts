/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';

// ── Mock Runtime Types ──────────────────────────────────────────────────

export type CharacteristicValue = boolean | number | string;

export class MockCharacteristic extends EventEmitter {
  value: CharacteristicValue;
  readonly displayName: string;
  readonly UUID: string;
  props?: Record<string, unknown>;
  getter?: () => Promise<CharacteristicValue> | CharacteristicValue;
  setter?: (value: CharacteristicValue) => Promise<void> | void;

  constructor(displayName: string, UUID: string, defaultValue: CharacteristicValue = false) {
    super();
    this.displayName = displayName;
    this.UUID = UUID;
    this.value = defaultValue;
  }

  getValue(): CharacteristicValue {
    if (this.getter) {
      try {
        const val = this.getter();
        if (typeof val !== 'object' || val === null || !('then' in val)) {
          this.value = val as CharacteristicValue;
        }
      } catch {
        // preserve current value on sync getter failure
      }
    }
    return this.value;
  }

  async handleGet(): Promise<CharacteristicValue> {
    if (this.getter) {
      const val = await this.getter();
      if (val !== undefined && val !== this.value) {
        const oldValue = this.value;
        this.value = val;
        this.emit('change', { oldValue, newValue: val });
      }
      return this.value;
    }
    return this.value;
  }

  setValue(newValue: CharacteristicValue): this {
    const oldValue = this.value;
    this.value = newValue;
    this.emit('set', newValue, () => {});
    if (this.setter) {
      try {
        const res = this.setter(newValue);
        if (res instanceof Promise) res.catch((err) => this.emit('error', err));
      } catch (err) {
        this.emit('error', err);
      }
    }
    if (oldValue !== newValue) {
      this.emit('change', { oldValue, newValue });
    }
    return this;
  }

  async handleSet(newValue: CharacteristicValue): Promise<this> {
    const oldValue = this.value;
    if (this.setter) {
      await this.setter(newValue);
    }
    this.value = newValue;
    this.emit('set', newValue, () => {});
    if (oldValue !== newValue) {
      this.emit('change', { oldValue, newValue });
    }
    return this;
  }

  updateValue(newValue: CharacteristicValue): this {
    const oldValue = this.value;
    this.value = newValue;
    if (oldValue !== newValue) {
      this.emit('change', { oldValue, newValue });
    }
    return this;
  }

  onGet(handler: () => Promise<CharacteristicValue> | CharacteristicValue): this {
    this.getter = handler;
    return this;
  }
  onSet(handler: (value: CharacteristicValue) => Promise<void> | void): this {
    this.setter = handler;
    return this;
  }
  setProps(props: Record<string, unknown>): this {
    this.props = { ...this.props, ...props };
    return this;
  }
}

export class MockService {
  readonly displayName: string;
  readonly UUID: string;
  readonly subtype?: string;
  readonly characteristics = new Map<string, MockCharacteristic>();
  readonly linkedServices: MockService[] = [];

  constructor(displayName: string, UUID: string, subtype?: string) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.subtype = subtype;
  }

  getCharacteristic(nameOrUuid: string | { UUID: string }): MockCharacteristic {
    const key = typeof nameOrUuid === 'string' ? nameOrUuid : nameOrUuid.UUID;
    let char = this.characteristics.get(key);
    if (!char) {
      for (const c of this.characteristics.values()) {
        if (c.displayName === key) {
          char = c;
          break;
        }
      }
    }
    if (!char) {
      char = new MockCharacteristic(key, key);
      this.characteristics.set(char.UUID, char);
    }
    return char;
  }

  setCharacteristic(nameOrUuid: string | { UUID: string }, value: CharacteristicValue): this {
    this.getCharacteristic(nameOrUuid).setValue(value);
    return this;
  }
  updateCharacteristic(nameOrUuid: string | { UUID: string }, value: CharacteristicValue): this {
    return this.setCharacteristic(nameOrUuid, value);
  }
  addCharacteristic(characteristic: MockCharacteristic): this {
    this.characteristics.set(characteristic.UUID, characteristic);
    return this;
  }
  removeCharacteristic(characteristic: MockCharacteristic): void {
    this.characteristics.delete(characteristic.UUID);
    this.characteristics.delete(characteristic.displayName);
  }
  addLinkedService(service: MockService): this {
    this.linkedServices.push(service);
    return this;
  }
}

export class MockAccessory {
  displayName: string;
  UUID: string;
  category?: number;
  services: MockService[] = [];
  context: Record<string, unknown> = {};

  constructor(displayName: string, UUID: string, category?: number) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.category = category;
  }

  getService(nameOrUuid: string | { UUID: string }): MockService | undefined {
    const key = typeof nameOrUuid === 'string' ? nameOrUuid : nameOrUuid.UUID;
    return this.services.find((s) => s.displayName === key || s.UUID === key);
  }
  getServiceById(uuid: string, subtype?: string): MockService | undefined {
    return this.services.find(
      (s) => s.UUID === uuid && (subtype === undefined || s.subtype === subtype),
    );
  }
  addService(service: MockService): MockService {
    this.services.push(service);
    return service;
  }
  removeService(service: MockService): void {
    const idx = this.services.indexOf(service);
    if (idx >= 0) this.services.splice(idx, 1);
  }
}
