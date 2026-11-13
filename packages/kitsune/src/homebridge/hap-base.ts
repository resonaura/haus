/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';

// ── Mock Runtime Types ──────────────────────────────────────────────────

export type CharacteristicValue = boolean | number | string;

export type CharacteristicKey = string | { UUID?: string; name?: string };
export type CharacteristicConstructor = new (...args: never[]) => MockCharacteristic;
export type ServiceKey = string | { UUID?: string; name?: string };
export type ServiceConstructor = new (...args: never[]) => MockService;

const ACCESSORY_INFO_UUID = '0000003E-0000-1000-8000-0026BB765291';
const MUTATION_HANDLERS = new WeakMap<MockService | MockAccessory, () => void>();

function resolveUuidKey(
  key: CharacteristicKey | ServiceKey | CharacteristicConstructor | ServiceConstructor,
): string {
  if (typeof key === 'string') return key;
  if ('UUID' in key && typeof key.UUID === 'string') return key.UUID;
  if ('name' in key && typeof key.name === 'string') return key.name;
  return '';
}

export class MockCharacteristic extends EventEmitter {
  value: CharacteristicValue;
  readonly defaultValue: CharacteristicValue;
  readonly displayName: string;
  readonly UUID: string;
  props: Record<string, unknown> = {};
  getter?: () => Promise<CharacteristicValue> | CharacteristicValue;
  setter?: (value: CharacteristicValue) => Promise<void> | void;

  constructor(displayName: string, UUID: string, defaultValue: CharacteristicValue = false) {
    super();
    this.displayName = displayName;
    this.UUID = UUID;
    this.defaultValue = defaultValue;
    this.value = defaultValue;
  }

  getDefaultValue(): CharacteristicValue {
    return this.defaultValue;
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

  setMutationHandler(handler: () => void): void {
    MUTATION_HANDLERS.set(this, handler);
  }

  getCharacteristic(nameOrUuid: CharacteristicKey | CharacteristicConstructor): MockCharacteristic {
    const key = resolveUuidKey(nameOrUuid);
    let char = this.characteristics.get(key);
    if (!char) {
      for (const c of this.characteristics.values()) {
        if (c.displayName === key || c.UUID === key) {
          char = c;
          break;
        }
      }
    }
    if (!char) {
      char =
        typeof nameOrUuid === 'function'
          ? (Reflect.construct(nameOrUuid, []) as MockCharacteristic)
          : new MockCharacteristic(key, key);
      this.characteristics.set(char.UUID, char);
      MUTATION_HANDLERS.get(this)?.();
    }
    return char;
  }

  setCharacteristic(
    nameOrUuid: CharacteristicKey | CharacteristicConstructor,
    value: CharacteristicValue,
  ): this {
    this.getCharacteristic(nameOrUuid).setValue(value);
    if (this.UUID === ACCESSORY_INFO_UUID) {
      MUTATION_HANDLERS.get(this)?.();
    }
    return this;
  }
  updateCharacteristic(
    nameOrUuid: CharacteristicKey | CharacteristicConstructor,
    value: CharacteristicValue,
  ): this {
    this.getCharacteristic(nameOrUuid).updateValue(value);
    if (this.UUID === ACCESSORY_INFO_UUID) {
      MUTATION_HANDLERS.get(this)?.();
    }
    return this;
  }
  testCharacteristic(nameOrConstructor: CharacteristicKey): boolean {
    const uuid = resolveUuidKey(nameOrConstructor);
    if (this.characteristics.has(uuid)) return true;
    for (const c of this.characteristics.values()) {
      if (c.displayName === uuid || c.UUID === uuid) return true;
    }
    return false;
  }

  addOptionalCharacteristic(characteristic: MockCharacteristic | CharacteristicConstructor): this {
    const instance =
      typeof characteristic === 'function'
        ? (Reflect.construct(characteristic, []) as MockCharacteristic)
        : characteristic;
    if (!this.characteristics.has(instance.UUID)) {
      this.characteristics.set(instance.UUID, instance);
      MUTATION_HANDLERS.get(this)?.();
    }
    return this;
  }

  addCharacteristic(characteristic: MockCharacteristic | CharacteristicConstructor): this {
    const instance =
      typeof characteristic === 'function'
        ? (Reflect.construct(characteristic, []) as MockCharacteristic)
        : characteristic;
    this.characteristics.set(instance.UUID, instance);
    MUTATION_HANDLERS.get(this)?.();
    return this;
  }
  removeCharacteristic(characteristic: MockCharacteristic): void {
    this.characteristics.delete(characteristic.UUID);
    this.characteristics.delete(characteristic.displayName);
    MUTATION_HANDLERS.get(this)?.();
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
  readonly controllers: unknown[] = [];

  constructor(displayName: string, UUID: string, category?: number) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.category = category;
  }

  setMutationHandler(handler: () => void): void {
    MUTATION_HANDLERS.set(this, handler);
    for (const s of this.services) {
      s.setMutationHandler(handler);
    }
  }

  getService(nameOrUuid: ServiceKey): MockService | undefined {
    const key = resolveUuidKey(nameOrUuid);
    const found = this.services.find((s) => s.displayName === key || s.UUID === key);
    if (
      !found &&
      (key === ACCESSORY_INFO_UUID ||
        key === 'Accessory Information' ||
        key === 'AccessoryInformation')
    ) {
      const info = new MockService('Accessory Information', ACCESSORY_INFO_UUID);
      const handler = MUTATION_HANDLERS.get(this);
      if (handler) info.setMutationHandler(handler);
      this.services.push(info);
      return info;
    }
    return found;
  }
  getServiceById(uuidOrService: ServiceKey, subtype?: string): MockService | undefined {
    const key = resolveUuidKey(uuidOrService);
    return this.services.find(
      (s) =>
        (s.UUID === key || s.displayName === key) &&
        (subtype === undefined || s.subtype === subtype),
    );
  }
  addService(
    serviceOrCtor: MockService | ServiceConstructor,
    ...constructorArgs: unknown[]
  ): MockService {
    const service =
      typeof serviceOrCtor === 'function'
        ? (Reflect.construct(serviceOrCtor, constructorArgs) as MockService)
        : serviceOrCtor;
    const handler = MUTATION_HANDLERS.get(this);
    if (handler) {
      service.setMutationHandler(handler);
    }
    this.services.push(service);
    handler?.();
    return service;
  }
  removeService(service: MockService): void {
    const idx = this.services.indexOf(service);
    if (idx >= 0) {
      this.services.splice(idx, 1);
      MUTATION_HANDLERS.get(this)?.();
    }
  }
  updateDisplayName(displayName: string): void {
    this.displayName = displayName;
    MUTATION_HANDLERS.get(this)?.();
  }
  configureController(controller: unknown): void {
    this.controllers.push(controller);
  }
  removeController(controller: unknown): void {
    const idx = this.controllers.indexOf(controller);
    if (idx >= 0) this.controllers.splice(idx, 1);
  }
}
