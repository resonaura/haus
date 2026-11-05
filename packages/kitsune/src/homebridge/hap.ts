/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { EventEmitter } from 'node:events';

// ── Canonical Apple HAP UUID Enums ──────────────────────────────────────

/** Apple HomeKit Accessory Protocol — Service type UUIDs. */
export enum ServiceUUID {
  AccessoryInformation = '0000003E-0000-1000-8000-0026BB765291',
  Lightbulb            = '00000043-0000-1000-8000-0026BB765291',
  Switch               = '00000049-0000-1000-8000-0026BB765291',
  Outlet               = '00000047-0000-1000-8000-0026BB765291',
  Fan                  = '00000040-0000-1000-8000-0026BB765291',
  GarageDoorOpener     = '00000041-0000-1000-8000-0026BB765291',
  LockMechanism        = '00000045-0000-1000-8000-0026BB765291',
  Thermostat           = '0000004A-0000-1000-8000-0026BB765291',
  SecuritySystem       = '0000007E-0000-1000-8000-0026BB765291',
  CarbonMonoxideSensor = '0000007F-0000-1000-8000-0026BB765291',
  ContactSensor        = '00000080-0000-1000-8000-0026BB765291',
  Door                 = '00000081-0000-1000-8000-0026BB765291',
  HumiditySensor       = '00000082-0000-1000-8000-0026BB765291',
  LeakSensor           = '00000083-0000-1000-8000-0026BB765291',
  LightSensor          = '00000084-0000-1000-8000-0026BB765291',
  MotionSensor         = '00000085-0000-1000-8000-0026BB765291',
  OccupancySensor      = '00000086-0000-1000-8000-0026BB765291',
  SmokeSensor          = '00000087-0000-1000-8000-0026BB765291',
  TemperatureSensor    = '0000008A-0000-1000-8000-0026BB765291',
  Window               = '0000008B-0000-1000-8000-0026BB765291',
  WindowCovering       = '0000008C-0000-1000-8000-0026BB765291',
  BatteryService       = '00000096-0000-1000-8000-0026BB765291',
  CameraRTPStream      = '00000110-0000-1000-8000-0026BB765291',
  Doorbell             = '00000121-0000-1000-8000-0026BB765291',
  StatelessSwitch      = '00000089-0000-1000-8000-0026BB765291',
  Speaker              = '00000113-0000-1000-8000-0026BB765291',
  Microphone           = '00000112-0000-1000-8000-0026BB765291',
  InputSource          = '000000D9-0000-1000-8000-0026BB765291',
  Television           = '000000D8-0000-1000-8000-0026BB765291',
  Valve                = '000000D0-0000-1000-8000-0026BB765291',
  IrrigationSystem     = '000000CF-0000-1000-8000-0026BB765291',
  AirPurifier          = '000000BB-0000-1000-8000-0026BB765291',
  FilterMaintenance    = '000000BA-0000-1000-8000-0026BB765291',
  AirQualitySensor     = '0000008D-0000-1000-8000-0026BB765291',
}

/** Apple HomeKit Accessory Protocol — Characteristic type UUIDs. */
export enum CharacteristicUUID {
  On                   = '00000025-0000-1000-8000-0026BB765291',
  Brightness           = '00000008-0000-1000-8000-0026BB765291',
  Hue                  = '00000013-0000-1000-8000-0026BB765291',
  Saturation           = '0000002F-0000-1000-8000-0026BB765291',
  ColorTemperature     = '000000CE-0000-1000-8000-0026BB765291',
  CurrentTemperature   = '00000011-0000-1000-8000-0026BB765291',
  TargetTemperature    = '00000035-0000-1000-8000-0026BB765291',
  CurrentHeatingCooling = '0000000F-0000-1000-8000-0026BB765291',
  TargetHeatingCooling = '00000033-0000-1000-8000-0026BB765291',
  CurrentPosition      = '0000006D-0000-1000-8000-0026BB765291',
  TargetPosition       = '0000007C-0000-1000-8000-0026BB765291',
  PositionState        = '00000072-0000-1000-8000-0026BB765291',
  MotionDetected       = '00000022-0000-1000-8000-0026BB765291',
  ContactSensorState   = '0000006A-0000-1000-8000-0026BB765291',
  OccupancyDetected    = '00000071-0000-1000-8000-0026BB765291',
  LockCurrentState     = '0000001D-0000-1000-8000-0026BB765291',
  LockTargetState      = '0000001E-0000-1000-8000-0026BB765291',
  BatteryLevel         = '00000068-0000-1000-8000-0026BB765291',
  StatusLowBattery     = '00000079-0000-1000-8000-0026BB765291',
  ChargingState        = '0000008F-0000-1000-8000-0026BB765291',
  Active               = '000000B0-0000-1000-8000-0026BB765291',
  InUse                = '000000D2-0000-1000-8000-0026BB765291',
  RotationSpeed        = '00000029-0000-1000-8000-0026BB765291',
  CurrentDoorState     = '0000000E-0000-1000-8000-0026BB765291',
  TargetDoorState      = '00000032-0000-1000-8000-0026BB765291',
  ObstructionDetected  = '00000024-0000-1000-8000-0026BB765291',
  SmokeDetected        = '00000076-0000-1000-8000-0026BB765291',
  CarbonMonoxideDetected = '00000069-0000-1000-8000-0026BB765291',
  LeakDetected         = '00000070-0000-1000-8000-0026BB765291',
  CurrentAmbientLight  = '0000006B-0000-1000-8000-0026BB765291',
  CurrentRelativeHumidity = '00000010-0000-1000-8000-0026BB765291',
  ProgrammableSwitchEvent = '00000073-0000-1000-8000-0026BB765291',
  ServiceLabelIndex    = '000000CB-0000-1000-8000-0026BB765291',
  Volume               = '00000119-0000-1000-8000-0026BB765291',
  Mute                 = '0000011A-0000-1000-8000-0026BB765291',
  Name                 = '00000023-0000-1000-8000-0026BB765291',
  SerialNumber         = '00000030-0000-1000-8000-0026BB765291',
  Model                = '00000021-0000-1000-8000-0026BB765291',
  Manufacturer         = '00000020-0000-1000-8000-0026BB765291',
  FirmwareRevision     = '00000052-0000-1000-8000-0026BB765291',
  Identify             = '00000014-0000-1000-8000-0026BB765291',
}

// ── Mock Runtime Types ──────────────────────────────────────────────────

export type CharacteristicValue = boolean | number | string;

export class MockCharacteristic extends EventEmitter {
  value: CharacteristicValue;
  readonly displayName: string;
  readonly UUID: string;

  constructor(displayName: string, UUID: string, defaultValue: CharacteristicValue = false) {
    super();
    this.displayName = displayName;
    this.UUID = UUID;
    this.value = defaultValue;
  }

  getValue(): CharacteristicValue {
    return this.value;
  }

  setValue(newValue: CharacteristicValue): this {
    const oldValue = this.value;
    this.value = newValue;
    this.emit('set', newValue, () => {});
    if (oldValue !== newValue) {
      this.emit('change', { oldValue, newValue });
    }
    return this;
  }

  updateValue(newValue: CharacteristicValue): this {
    return this.setValue(newValue);
  }
}

export class MockService {
  readonly displayName: string;
  readonly UUID: string;
  readonly subtype?: string;
  readonly characteristics = new Map<string, MockCharacteristic>();

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

  addCharacteristic(characteristic: MockCharacteristic): this {
    this.characteristics.set(characteristic.UUID, characteristic);
    return this;
  }
}

export class MockAccessory {
  displayName: string;
  UUID: string;
  services: MockService[] = [];
  context: Record<string, unknown> = {};

  constructor(displayName: string, UUID: string) {
    this.displayName = displayName;
    this.UUID = UUID;
  }

  getService(nameOrUuid: string | { UUID: string }): MockService | undefined {
    const key = typeof nameOrUuid === 'string' ? nameOrUuid : nameOrUuid.UUID;
    return this.services.find((s) => s.displayName === key || s.UUID === key);
  }

  addService(service: MockService): MockService {
    this.services.push(service);
    return service;
  }
}

// ── Pre-built characteristic constructors keyed by enum ─────────────────

export const HAPCharacteristics = {
  On: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.On;
    constructor() { super('On', CharacteristicUUID.On, false); }
  },
  Brightness: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Brightness;
    constructor() { super('Brightness', CharacteristicUUID.Brightness, 100); }
  },
  Hue: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Hue;
    constructor() { super('Hue', CharacteristicUUID.Hue, 0); }
  },
  Saturation: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Saturation;
    constructor() { super('Saturation', CharacteristicUUID.Saturation, 0); }
  },
  ColorTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ColorTemperature;
    constructor() { super('ColorTemperature', CharacteristicUUID.ColorTemperature, 140); }
  },
  CurrentTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentTemperature;
    constructor() { super('CurrentTemperature', CharacteristicUUID.CurrentTemperature, 20.0); }
  },
  TargetTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.TargetTemperature;
    constructor() { super('TargetTemperature', CharacteristicUUID.TargetTemperature, 21.0); }
  },
  MotionDetected: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.MotionDetected;
    constructor() { super('MotionDetected', CharacteristicUUID.MotionDetected, false); }
  },
  ContactSensorState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ContactSensorState;
    constructor() { super('ContactSensorState', CharacteristicUUID.ContactSensorState, 0); }
  },
  OccupancyDetected: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.OccupancyDetected;
    constructor() { super('OccupancyDetected', CharacteristicUUID.OccupancyDetected, 0); }
  },
  LockCurrentState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.LockCurrentState;
    constructor() { super('LockCurrentState', CharacteristicUUID.LockCurrentState, 1); }
  },
  LockTargetState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.LockTargetState;
    constructor() { super('LockTargetState', CharacteristicUUID.LockTargetState, 1); }
  },
  Active: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Active;
    constructor() { super('Active', CharacteristicUUID.Active, 0); }
  },
  CurrentPosition: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentPosition;
    constructor() { super('CurrentPosition', CharacteristicUUID.CurrentPosition, 0); }
  },
  TargetPosition: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.TargetPosition;
    constructor() { super('TargetPosition', CharacteristicUUID.TargetPosition, 0); }
  },
  ProgrammableSwitchEvent: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ProgrammableSwitchEvent;
    constructor() { super('ProgrammableSwitchEvent', CharacteristicUUID.ProgrammableSwitchEvent, 0); }
  },
  BatteryLevel: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.BatteryLevel;
    constructor() { super('BatteryLevel', CharacteristicUUID.BatteryLevel, 100); }
  },
  StatusLowBattery: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.StatusLowBattery;
    constructor() { super('StatusLowBattery', CharacteristicUUID.StatusLowBattery, 0); }
  },
  CurrentRelativeHumidity: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentRelativeHumidity;
    constructor() { super('CurrentRelativeHumidity', CharacteristicUUID.CurrentRelativeHumidity, 50); }
  },
  Volume: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Volume;
    constructor() { super('Volume', CharacteristicUUID.Volume, 50); }
  },
  Mute: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Mute;
    constructor() { super('Mute', CharacteristicUUID.Mute, false); }
  },
};

// ── Pre-built service constructors keyed by enum ────────────────────────

export const HAPServices = {
  Lightbulb: class extends MockService {
    static readonly UUID = ServiceUUID.Lightbulb;
    constructor(displayName = 'Lightbulb', subtype?: string) {
      super(displayName, ServiceUUID.Lightbulb, subtype);
      this.addCharacteristic(new HAPCharacteristics.On());
      this.addCharacteristic(new HAPCharacteristics.Brightness());
    }
  },
  Switch: class extends MockService {
    static readonly UUID = ServiceUUID.Switch;
    constructor(displayName = 'Switch', subtype?: string) {
      super(displayName, ServiceUUID.Switch, subtype);
      this.addCharacteristic(new HAPCharacteristics.On());
    }
  },
  Outlet: class extends MockService {
    static readonly UUID = ServiceUUID.Outlet;
    constructor(displayName = 'Outlet', subtype?: string) {
      super(displayName, ServiceUUID.Outlet, subtype);
      this.addCharacteristic(new HAPCharacteristics.On());
    }
  },
  Fan: class extends MockService {
    static readonly UUID = ServiceUUID.Fan;
    constructor(displayName = 'Fan', subtype?: string) {
      super(displayName, ServiceUUID.Fan, subtype);
      this.addCharacteristic(new HAPCharacteristics.On());
    }
  },
  MotionSensor: class extends MockService {
    static readonly UUID = ServiceUUID.MotionSensor;
    constructor(displayName = 'MotionSensor', subtype?: string) {
      super(displayName, ServiceUUID.MotionSensor, subtype);
      this.addCharacteristic(new HAPCharacteristics.MotionDetected());
    }
  },
  ContactSensor: class extends MockService {
    static readonly UUID = ServiceUUID.ContactSensor;
    constructor(displayName = 'ContactSensor', subtype?: string) {
      super(displayName, ServiceUUID.ContactSensor, subtype);
      this.addCharacteristic(new HAPCharacteristics.ContactSensorState());
    }
  },
  OccupancySensor: class extends MockService {
    static readonly UUID = ServiceUUID.OccupancySensor;
    constructor(displayName = 'OccupancySensor', subtype?: string) {
      super(displayName, ServiceUUID.OccupancySensor, subtype);
      this.addCharacteristic(new HAPCharacteristics.OccupancyDetected());
    }
  },
  Thermostat: class extends MockService {
    static readonly UUID = ServiceUUID.Thermostat;
    constructor(displayName = 'Thermostat', subtype?: string) {
      super(displayName, ServiceUUID.Thermostat, subtype);
      this.addCharacteristic(new HAPCharacteristics.CurrentTemperature());
      this.addCharacteristic(new HAPCharacteristics.TargetTemperature());
    }
  },
  LockMechanism: class extends MockService {
    static readonly UUID = ServiceUUID.LockMechanism;
    constructor(displayName = 'LockMechanism', subtype?: string) {
      super(displayName, ServiceUUID.LockMechanism, subtype);
      this.addCharacteristic(new HAPCharacteristics.LockCurrentState());
      this.addCharacteristic(new HAPCharacteristics.LockTargetState());
    }
  },
  WindowCovering: class extends MockService {
    static readonly UUID = ServiceUUID.WindowCovering;
    constructor(displayName = 'WindowCovering', subtype?: string) {
      super(displayName, ServiceUUID.WindowCovering, subtype);
      this.addCharacteristic(new HAPCharacteristics.CurrentPosition());
      this.addCharacteristic(new HAPCharacteristics.TargetPosition());
    }
  },
  GarageDoorOpener: class extends MockService {
    static readonly UUID = ServiceUUID.GarageDoorOpener;
    constructor(displayName = 'GarageDoorOpener', subtype?: string) {
      super(displayName, ServiceUUID.GarageDoorOpener, subtype);
      this.addCharacteristic(new HAPCharacteristics.Active());
    }
  },
  StatelessProgrammableSwitch: class extends MockService {
    static readonly UUID = ServiceUUID.StatelessSwitch;
    constructor(displayName = 'StatelessProgrammableSwitch', subtype?: string) {
      super(displayName, ServiceUUID.StatelessSwitch, subtype);
      this.addCharacteristic(new HAPCharacteristics.ProgrammableSwitchEvent());
    }
  },
  BatteryService: class extends MockService {
    static readonly UUID = ServiceUUID.BatteryService;
    constructor(displayName = 'BatteryService', subtype?: string) {
      super(displayName, ServiceUUID.BatteryService, subtype);
      this.addCharacteristic(new HAPCharacteristics.BatteryLevel());
      this.addCharacteristic(new HAPCharacteristics.StatusLowBattery());
    }
  },
  HumiditySensor: class extends MockService {
    static readonly UUID = ServiceUUID.HumiditySensor;
    constructor(displayName = 'HumiditySensor', subtype?: string) {
      super(displayName, ServiceUUID.HumiditySensor, subtype);
      this.addCharacteristic(new HAPCharacteristics.CurrentRelativeHumidity());
    }
  },
  TemperatureSensor: class extends MockService {
    static readonly UUID = ServiceUUID.TemperatureSensor;
    constructor(displayName = 'TemperatureSensor', subtype?: string) {
      super(displayName, ServiceUUID.TemperatureSensor, subtype);
      this.addCharacteristic(new HAPCharacteristics.CurrentTemperature());
    }
  },
  Doorbell: class extends MockService {
    static readonly UUID = ServiceUUID.Doorbell;
    constructor(displayName = 'Doorbell', subtype?: string) {
      super(displayName, ServiceUUID.Doorbell, subtype);
      this.addCharacteristic(new HAPCharacteristics.ProgrammableSwitchEvent());
    }
  },
  Speaker: class extends MockService {
    static readonly UUID = ServiceUUID.Speaker;
    constructor(displayName = 'Speaker', subtype?: string) {
      super(displayName, ServiceUUID.Speaker, subtype);
      this.addCharacteristic(new HAPCharacteristics.Volume());
      this.addCharacteristic(new HAPCharacteristics.Mute());
    }
  },
};
