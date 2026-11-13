/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { CharacteristicUUID, HAPServices, ServiceUUID } from './hap.js';
import { type CharacteristicValue, MockCharacteristic, MockService } from './hap-base.js';
import { HAPCharacteristics } from './characteristics.js';

export const Formats = {
  BOOL: 'bool',
  INT: 'int',
  FLOAT: 'float',
  STRING: 'string',
  UINT8: 'uint8',
  UINT16: 'uint16',
  UINT32: 'uint32',
  UINT64: 'uint64',
  DATA: 'data',
  TLV8: 'tlv8',
} as const;

export const Perms = {
  PAIRED_READ: 'pr',
  PAIRED_WRITE: 'pw',
  NOTIFY: 'ev',
  EVENTS: 'ev',
  HIDDEN: 'hd',
  WRITE_RESPONSE: 'wr',
} as const;

export const Units = {
  CELSIUS: 'celsius',
  PERCENTAGE: 'percentage',
  ARC_DEGREE: 'arcdegrees',
  LUX: 'lux',
  SECONDS: 'seconds',
} as const;

export const Categories = {
  OTHER: 1,
  BRIDGE: 2,
  FAN: 3,
  GARAGE_DOOR_OPENER: 4,
  LIGHTBULB: 5,
  DOOR_LOCK: 6,
  OUTLET: 7,
  SWITCH: 8,
  THERMOSTAT: 9,
  SENSOR: 10,
  SECURITY_SYSTEM: 11,
  DOOR: 12,
  WINDOW: 13,
  WINDOW_COVERING: 14,
  PROGRAMMABLE_SWITCH: 15,
  AIR_PURIFIER: 19,
  HEATER: 20,
  AIR_CONDITIONER: 21,
  HUMIDIFIER: 22,
  DEHUMIDIFIER: 23,
  VALVE: 29,
  TELEVISION: 31,
} as const;

export const HAPStatus = {
  SUCCESS: 0,
  INSUFFICIENT_PRIVILEGES: -70401,
  SERVICE_COMMUNICATION_FAILURE: -70402,
  RESOURCE_BUSY: -70403,
  READ_ONLY_CHARACTERISTIC: -70404,
  WRITE_ONLY_CHARACTERISTIC: -70405,
  NOTIFICATION_NOT_SUPPORTED: -70406,
  OUT_OF_RESOURCE: -70407,
  OPERATION_TIMED_OUT: -70408,
  RESOURCE_DOES_NOT_EXIST: -70409,
  INVALID_VALUE_IN_REQUEST: -70410,
  INSUFFICIENT_AUTHORIZATION: -70411,
} as const;

export class HapStatusError extends Error {
  constructor(readonly hapStatus: number) {
    super(`HAP status error: ${hapStatus}`);
    this.name = 'HapStatusError';
  }
}

export function HAPLibraryVersion(): string {
  return '0.12.2';
}

export class AdaptiveLightingController {
  constructor(
    readonly service: MockService,
    readonly options?: Record<string, unknown>,
  ) {}

  disableAdaptiveLighting(): void {
    // Supported as safe virtual HAP controller
  }

  isAdaptiveLightingActive(): boolean {
    return false;
  }
}

function charClass(
  name: string,
  uuid: string,
  defaultValue: string | number | boolean = 0,
  extras?: Record<string, number>,
) {
  const Cls = class extends MockCharacteristic {
    static readonly UUID = uuid;
    constructor() {
      super(name, uuid, defaultValue);
    }
  };
  if (extras) Object.assign(Cls, extras);
  return Cls;
}

function serviceClass(name: string, uuid: string) {
  return class extends MockService {
    static readonly UUID = uuid;
    constructor(displayName = name, subtype?: string) {
      super(displayName, uuid, subtype);
    }
  };
}

export const ExtraCharacteristicClasses = {
  Name: charClass('Name', CharacteristicUUID.Name, ''),
  Manufacturer: charClass('Manufacturer', CharacteristicUUID.Manufacturer, ''),
  Model: charClass('Model', CharacteristicUUID.Model, ''),
  SerialNumber: charClass('SerialNumber', CharacteristicUUID.SerialNumber, ''),
  FirmwareRevision: charClass('FirmwareRevision', CharacteristicUUID.FirmwareRevision, ''),
  Identify: charClass('Identify', CharacteristicUUID.Identify, false),
  ServiceLabelIndex: charClass('ServiceLabelIndex', CharacteristicUUID.ServiceLabelIndex, 1),
  InUse: charClass('InUse', CharacteristicUUID.InUse, false),
  OutletInUse: charClass('OutletInUse', '00000026-0000-1000-8000-0026BB765291', true),
  RotationSpeed: charClass('RotationSpeed', CharacteristicUUID.RotationSpeed, 0),
  RotationDirection: charClass('RotationDirection', '00000028-0000-1000-8000-0026BB765291', 0, {
    CLOCKWISE: 0,
    COUNTER_CLOCKWISE: 1,
  }),
  SwingMode: charClass('SwingMode', '000000B6-0000-1000-8000-0026BB765291', 0, {
    SWING_DISABLED: 0,
    SWING_ENABLED: 1,
  }),
  LockPhysicalControls: charClass(
    'LockPhysicalControls',
    '000000A7-0000-1000-8000-0026BB765291',
    0,
    { CONTROL_LOCK_DISABLED: 0, CONTROL_LOCK_ENABLED: 1 },
  ),
  CurrentHeatingCoolingState: charClass(
    'CurrentHeatingCoolingState',
    CharacteristicUUID.CurrentHeatingCooling,
    0,
    { OFF: 0, HEAT: 1, COOL: 2 },
  ),
  TargetHeatingCoolingState: charClass(
    'TargetHeatingCoolingState',
    CharacteristicUUID.TargetHeatingCooling,
    0,
    { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 },
  ),
  HeatingThresholdTemperature: charClass(
    'HeatingThresholdTemperature',
    '00000012-0000-1000-8000-0026BB765291',
    20,
  ),
  CoolingThresholdTemperature: charClass(
    'CoolingThresholdTemperature',
    '0000000D-0000-1000-8000-0026BB765291',
    24,
  ),
  TemperatureDisplayUnits: charClass(
    'TemperatureDisplayUnits',
    '00000036-0000-1000-8000-0026BB765291',
    0,
    { CELSIUS: 0, FAHRENHEIT: 1 },
  ),
  CurrentHeaterCoolerState: charClass(
    'CurrentHeaterCoolerState',
    '000000B1-0000-1000-8000-0026BB765291',
    0,
    { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
  ),
  TargetHeaterCoolerState: charClass(
    'TargetHeaterCoolerState',
    '000000B2-0000-1000-8000-0026BB765291',
    0,
    { AUTO: 0, HEAT: 1, COOL: 2 },
  ),
  CurrentAirPurifierState: charClass(
    'CurrentAirPurifierState',
    '000000A9-0000-1000-8000-0026BB765291',
    0,
    { INACTIVE: 0, IDLE: 1, PURIFYING_AIR: 2 },
  ),
  TargetAirPurifierState: charClass(
    'TargetAirPurifierState',
    '000000A8-0000-1000-8000-0026BB765291',
    1,
    { MANUAL: 0, AUTO: 1 },
  ),
  AirQuality: charClass('AirQuality', '00000095-0000-1000-8000-0026BB765291', 0, {
    UNKNOWN: 0,
    EXCELLENT: 1,
    GOOD: 2,
    FAIR: 3,
    INFERIOR: 4,
    POOR: 5,
  }),
  PM2_5Density: charClass('PM2_5Density', '000000C6-0000-1000-8000-0026BB765291', 0),
  CarbonDioxideDetected: charClass(
    'CarbonDioxideDetected',
    CharacteristicUUID.CarbonMonoxideDetected,
    0,
    { CO2_LEVELS_NORMAL: 0, CO2_LEVELS_ABNORMAL: 1 },
  ),
  CarbonDioxideLevel: charClass('CarbonDioxideLevel', '00000093-0000-1000-8000-0026BB765291', 400),
  CarbonDioxidePeakLevel: charClass(
    'CarbonDioxidePeakLevel',
    '00000094-0000-1000-8000-0026BB765291',
    400,
  ),
  LeakDetected: charClass('LeakDetected', CharacteristicUUID.LeakDetected, 0, {
    LEAK_NOT_DETECTED: 0,
    LEAK_DETECTED: 1,
  }),
  ValveType: charClass('ValveType', '000000D5-0000-1000-8000-0026BB765291', 0, {
    GENERIC_VALVE: 0,
    IRRIGATION: 1,
    SHOWER_HEAD: 2,
    WATER_FAUCET: 3,
  }),
  SetDuration: charClass('SetDuration', '000000D3-0000-1000-8000-0026BB765291', 0),
  RemainingDuration: charClass('RemainingDuration', '000000D4-0000-1000-8000-0026BB765291', 0),
  DisplayOrder: charClass('DisplayOrder', '00000136-0000-1000-8000-0026BB765291', 0),
  TargetVisibilityState: charClass(
    'TargetVisibilityState',
    '00000134-0000-1000-8000-0026BB765291',
    0,
    { SHOWN: 0, HIDDEN: 1 },
  ),
} as const;

// Attach HAP enum constants expected directly on existing characteristic classes
Object.assign(HAPCharacteristics.ContactSensorState, {
  CONTACT_DETECTED: 1,
  CONTACT_NOT_DETECTED: 0,
});
Object.assign(HAPCharacteristics.OccupancyDetected, {
  OCCUPANCY_NOT_DETECTED: 0,
  OCCUPANCY_DETECTED: 1,
});
Object.assign(HAPCharacteristics.Active, {
  INACTIVE: 0,
  ACTIVE: 1,
});
Object.assign(HAPCharacteristics.StatusLowBattery, {
  BATTERY_LEVEL_NORMAL: 0,
  BATTERY_LEVEL_LOW: 1,
});
Object.assign(HAPCharacteristics.IsConfigured, {
  NOT_CONFIGURED: 0,
  CONFIGURED: 1,
});
Object.assign(HAPCharacteristics.CurrentVisibilityState, {
  SHOWN: 0,
  HIDDEN: 1,
});

export const ExtraServiceClasses = {
  Battery: HAPServices.BatteryService,
  Fanv2: serviceClass('Fanv2', '000000B7-0000-1000-8000-0026BB765291'),
  HeaterCooler: serviceClass('HeaterCooler', '000000BC-0000-1000-8000-0026BB765291'),
  AirPurifier: serviceClass('AirPurifier', ServiceUUID.AirPurifier),
  AirQualitySensor: serviceClass('AirQualitySensor', ServiceUUID.AirQualitySensor),
  CarbonDioxideSensor: serviceClass('CarbonDioxideSensor', '00000097-0000-1000-8000-0026BB765291'),
  LeakSensor: serviceClass('LeakSensor', ServiceUUID.LeakSensor),
  Valve: serviceClass('Valve', ServiceUUID.Valve),
} as const;

function inferDefaultFromProps(props: Record<string, unknown>): CharacteristicValue {
  if (props.format === Formats.STRING) return '';
  if (props.format === Formats.BOOL) return false;
  if (typeof props.minValue === 'number') return props.minValue;
  if (
    props.format === Formats.INT ||
    props.format === Formats.FLOAT ||
    props.format === Formats.UINT8 ||
    props.format === Formats.UINT16 ||
    props.format === Formats.UINT32 ||
    props.format === Formats.UINT64
  ) {
    return 0;
  }
  return false;
}

export class ExtendableCharacteristic extends MockCharacteristic {
  static readonly Formats = Formats;
  static readonly Perms = Perms;
  static readonly Units = Units;

  constructor(
    displayName: string,
    uuid: string,
    propsOrDefault?: Record<string, unknown> | CharacteristicValue,
  ) {
    const isProps = typeof propsOrDefault === 'object' && propsOrDefault !== null;
    const initial = isProps ? inferDefaultFromProps(propsOrDefault) : (propsOrDefault ?? false);
    super(displayName, uuid, initial);
    if (isProps) this.setProps(propsOrDefault);
  }
}

export class ExtendableService extends MockService {}

export type HapCharacteristicNamespace = typeof ExtendableCharacteristic &
  typeof HAPCharacteristics &
  typeof ExtraCharacteristicClasses;

export type HapServiceNamespace = typeof ExtendableService &
  typeof HAPServices &
  typeof ExtraServiceClasses;

export const HapCharacteristicRegistry: HapCharacteristicNamespace = Object.assign(
  ExtendableCharacteristic,
  HAPCharacteristics,
  ExtraCharacteristicClasses,
);

export const HapServiceRegistry: HapServiceNamespace = Object.assign(
  ExtendableService,
  HAPServices,
  ExtraServiceClasses,
);
