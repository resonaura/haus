/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { CharacteristicUUID } from './uuid.js';
import { MockCharacteristic } from './hap-base.js';

export { MockCharacteristic };

export const HAPCharacteristics = {
  On: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.On;
    constructor() {
      super('On', CharacteristicUUID.On, false);
    }
  },
  Brightness: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Brightness;
    constructor() {
      super('Brightness', CharacteristicUUID.Brightness, 100);
    }
  },
  Hue: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Hue;
    constructor() {
      super('Hue', CharacteristicUUID.Hue, 0);
    }
  },
  Saturation: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Saturation;
    constructor() {
      super('Saturation', CharacteristicUUID.Saturation, 0);
    }
  },
  ColorTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ColorTemperature;
    constructor() {
      super('ColorTemperature', CharacteristicUUID.ColorTemperature, 140);
    }
  },
  CurrentTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentTemperature;
    constructor() {
      super('CurrentTemperature', CharacteristicUUID.CurrentTemperature, 20.0);
    }
  },
  TargetTemperature: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.TargetTemperature;
    constructor() {
      super('TargetTemperature', CharacteristicUUID.TargetTemperature, 21.0);
    }
  },
  MotionDetected: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.MotionDetected;
    constructor() {
      super('MotionDetected', CharacteristicUUID.MotionDetected, false);
    }
  },
  ContactSensorState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ContactSensorState;
    constructor() {
      super('ContactSensorState', CharacteristicUUID.ContactSensorState, 0);
    }
  },
  OccupancyDetected: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.OccupancyDetected;
    constructor() {
      super('OccupancyDetected', CharacteristicUUID.OccupancyDetected, 0);
    }
  },
  LockCurrentState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.LockCurrentState;
    constructor() {
      super('LockCurrentState', CharacteristicUUID.LockCurrentState, 1);
    }
  },
  LockTargetState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.LockTargetState;
    constructor() {
      super('LockTargetState', CharacteristicUUID.LockTargetState, 1);
    }
  },
  Active: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Active;
    constructor() {
      super('Active', CharacteristicUUID.Active, 0);
    }
  },
  CurrentPosition: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentPosition;
    constructor() {
      super('CurrentPosition', CharacteristicUUID.CurrentPosition, 0);
    }
  },
  TargetPosition: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.TargetPosition;
    constructor() {
      super('TargetPosition', CharacteristicUUID.TargetPosition, 0);
    }
  },
  ProgrammableSwitchEvent: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ProgrammableSwitchEvent;
    constructor() {
      super('ProgrammableSwitchEvent', CharacteristicUUID.ProgrammableSwitchEvent, 0);
    }
  },
  BatteryLevel: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.BatteryLevel;
    constructor() {
      super('BatteryLevel', CharacteristicUUID.BatteryLevel, 100);
    }
  },
  StatusLowBattery: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.StatusLowBattery;
    constructor() {
      super('StatusLowBattery', CharacteristicUUID.StatusLowBattery, 0);
    }
  },
  CurrentRelativeHumidity: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentRelativeHumidity;
    constructor() {
      super('CurrentRelativeHumidity', CharacteristicUUID.CurrentRelativeHumidity, 50);
    }
  },
  Volume: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Volume;
    constructor() {
      super('Volume', CharacteristicUUID.Volume, 50);
    }
  },
  Mute: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Mute;
    constructor() {
      super('Mute', CharacteristicUUID.Mute, false);
    }
  },
  ActiveIdentifier: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ActiveIdentifier;
    constructor() {
      super('ActiveIdentifier', CharacteristicUUID.ActiveIdentifier, 1);
    }
  },
  RemoteKey: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.RemoteKey;
    constructor() {
      super('RemoteKey', CharacteristicUUID.RemoteKey, 0);
    }
  },
  VolumeSelector: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.VolumeSelector;
    constructor() {
      super('VolumeSelector', CharacteristicUUID.VolumeSelector, 0);
    }
  },
  ConfiguredName: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.ConfiguredName;
    constructor() {
      super('ConfiguredName', CharacteristicUUID.ConfiguredName, '');
    }
  },
  SleepDiscoveryMode: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.SleepDiscoveryMode;
    constructor() {
      super('SleepDiscoveryMode', CharacteristicUUID.SleepDiscoveryMode, 1);
    }
  },
  CurrentMediaState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentMediaState;
    constructor() {
      super('CurrentMediaState', CharacteristicUUID.CurrentMediaState, 0);
    }
  },
  TargetMediaState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.TargetMediaState;
    constructor() {
      super('TargetMediaState', CharacteristicUUID.TargetMediaState, 0);
    }
  },
  Identifier: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.Identifier;
    constructor() {
      super('Identifier', CharacteristicUUID.Identifier, 1);
    }
  },
  IsConfigured: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.IsConfigured;
    constructor() {
      super('IsConfigured', CharacteristicUUID.IsConfigured, 1);
    }
  },
  InputSourceType: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.InputSourceType;
    constructor() {
      super('InputSourceType', CharacteristicUUID.InputSourceType, 0);
    }
  },
  CurrentVisibilityState: class extends MockCharacteristic {
    static readonly UUID = CharacteristicUUID.CurrentVisibilityState;
    constructor() {
      super('CurrentVisibilityState', CharacteristicUUID.CurrentVisibilityState, 0);
    }
  },
};
