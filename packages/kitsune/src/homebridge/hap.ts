/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import {
  ServiceUUID,
  CharacteristicUUID,
  RemoteKey,
  VolumeSelector,
  TargetMediaState,
  CurrentMediaState,
  InputSourceType,
} from './uuid.js';
import {
  type CharacteristicValue,
  MockCharacteristic,
  MockService,
  MockAccessory,
} from './hap-base.js';
import { HAPCharacteristics } from './characteristics.js';

export {
  ServiceUUID,
  CharacteristicUUID,
  RemoteKey,
  VolumeSelector,
  TargetMediaState,
  CurrentMediaState,
  InputSourceType,
  type CharacteristicValue,
  MockCharacteristic,
  MockService,
  MockAccessory,
  HAPCharacteristics,
};

// ── Pre-built service constructors keyed by enum ────────────────────────

export const HAPServices = {
  AccessoryInformation: class extends MockService {
    static readonly UUID = ServiceUUID.AccessoryInformation;
    constructor(displayName = 'Accessory Information', subtype?: string) {
      super(displayName, ServiceUUID.AccessoryInformation, subtype);
    }
  },
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
  Television: class extends MockService {
    static readonly UUID = ServiceUUID.Television;
    constructor(displayName = 'Television', subtype?: string) {
      super(displayName, ServiceUUID.Television, subtype);
      this.addCharacteristic(new HAPCharacteristics.Active());
      this.addCharacteristic(new HAPCharacteristics.ActiveIdentifier());
      this.addCharacteristic(new HAPCharacteristics.RemoteKey());
      this.addCharacteristic(new HAPCharacteristics.ConfiguredName());
      this.addCharacteristic(new HAPCharacteristics.SleepDiscoveryMode());
    }
  },
  TelevisionSpeaker: class extends MockService {
    static readonly UUID = ServiceUUID.Speaker;
    constructor(displayName = 'TelevisionSpeaker', subtype?: string) {
      super(displayName, ServiceUUID.Speaker, subtype);
      this.addCharacteristic(new HAPCharacteristics.Mute());
      this.addCharacteristic(new HAPCharacteristics.Volume());
      this.addCharacteristic(new HAPCharacteristics.VolumeSelector());
    }
  },
  InputSource: class extends MockService {
    static readonly UUID = ServiceUUID.InputSource;
    constructor(displayName = 'InputSource', subtype?: string) {
      super(displayName, ServiceUUID.InputSource, subtype);
      this.addCharacteristic(new HAPCharacteristics.ConfiguredName());
      this.addCharacteristic(new HAPCharacteristics.Identifier());
      this.addCharacteristic(new HAPCharacteristics.IsConfigured());
      this.addCharacteristic(new HAPCharacteristics.InputSourceType());
      this.addCharacteristic(new HAPCharacteristics.CurrentVisibilityState());
    }
  },
};
