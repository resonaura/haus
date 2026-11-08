/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import * as hap from '@homebridge/hap-nodejs';
import { test } from 'vitest';
import {
  HAP_SERVICES,
  HAP_CHARACTERISTICS,
  HA_ENTITY_PLATFORMS,
  BINARY_SENSOR_DEVICE_CLASSES,
  COVER_DEVICE_CLASSES,
  MEDIA_PLAYER_DEVICE_CLASSES,
  SWITCH_DEVICE_CLASSES,
  BUTTON_DEVICE_CLASSES,
  EVENT_DEVICE_CLASSES,
  SENSOR_DEVICE_CLASSES,
  NUMBER_DEVICE_CLASSES,
  AlarmControlPanelEntityFeature,
  CameraEntityFeature,
  ClimateEntityFeature,
  CoverEntityFeature,
  FanEntityFeature,
  HumidifierEntityFeature,
  LawnMowerEntityFeature,
  LightEntityFeature,
  LockEntityFeature,
  MediaPlayerEntityFeature,
  RemoteEntityFeature,
  SirenEntityFeature,
  TodoEntityFeature,
  UpdateEntityFeature,
  VacuumEntityFeature,
  ValveEntityFeature,
  WaterHeaterEntityFeature,
  WeatherEntityFeature,
  mapSecurityStateToHap,
  HapSecurityCurrentState,
  HapSecurityTargetState,
  normalizeHaEntity,
} from '@haus/core';
import { HapProxyIdentityMapper } from '../src/index.js';

interface HapServiceStatic {
  UUID: string;
}

interface HapCharacteristicStatic {
  UUID: string;
  new (): { props: { format: string } };
}

function isHapServiceStatic(value: unknown): value is HapServiceStatic {
  return (
    typeof value === 'function' &&
    'UUID' in value &&
    typeof (value as { UUID?: unknown }).UUID === 'string'
  );
}

function isHapCharacteristicStatic(value: unknown): value is HapCharacteristicStatic {
  return (
    typeof value === 'function' &&
    'UUID' in value &&
    typeof (value as { UUID?: unknown }).UUID === 'string'
  );
}

test('HAP Service Registry exact-match assertions against @homebridge/hap-nodejs', () => {
  const hapServiceEntries = Object.entries(hap.Service).filter(
    (entry): entry is [string, HapServiceStatic] =>
      isHapServiceStatic(entry[1]) && entry[0] !== 'Service' && entry[0] !== 'ProximityControl',
  );

  assert.equal(hapServiceEntries.length, 73);
  assert.equal(Object.keys(HAP_SERVICES).length, 73);

  const serviceRegistry: Readonly<
    Record<string, (typeof HAP_SERVICES)[keyof typeof HAP_SERVICES] | undefined>
  > = HAP_SERVICES;

  for (const [svcName, hapDef] of hapServiceEntries) {
    const hausDef = serviceRegistry[svcName];
    assert.ok(hausDef, `Missing HAP service in Haus registry: ${svcName}`);

    assert.equal(
      hausDef.uuid.toUpperCase(),
      hapDef.UUID.toUpperCase(),
      `UUID mismatch for service ${svcName}`,
    );
  }

  // Deprecated services preserved
  assert.equal(HAP_SERVICES.CloudRelay.deprecated, true);
  assert.equal(HAP_SERVICES.TapManagement.deprecated, true);
  assert.equal(HAP_SERVICES.Tunnel.deprecated, true);
});

test('HAP Characteristic Registry exact-match assertions against @homebridge/hap-nodejs', () => {
  const hapCharEntries = Object.entries(hap.Characteristic).filter(
    (entry): entry is [string, HapCharacteristicStatic] =>
      isHapCharacteristicStatic(entry[1]) &&
      entry[0] !== 'Characteristic' &&
      entry[0] !== 'ProximityControlEnabled',
  );

  assert.equal(hapCharEntries.length, 252);
  assert.equal(Object.keys(HAP_CHARACTERISTICS).length, 252);

  const charRegistry: Readonly<
    Record<string, (typeof HAP_CHARACTERISTICS)[keyof typeof HAP_CHARACTERISTICS] | undefined>
  > = HAP_CHARACTERISTICS;

  for (const [charName, hapCls] of hapCharEntries) {
    const hausDef = charRegistry[charName];
    assert.ok(hausDef, `Missing HAP characteristic in Haus registry: ${charName}`);

    assert.equal(
      hausDef.uuid.toUpperCase(),
      hapCls.UUID.toUpperCase(),
      `UUID mismatch for characteristic ${charName}`,
    );

    const inst = new hapCls();
    assert.equal(
      hausDef.format,
      inst.props.format,
      `Format mismatch for characteristic ${charName}`,
    );
  }
});

test('Home Assistant Platform and Device Class Registry assertions', () => {
  assert.equal(HA_ENTITY_PLATFORMS.length, 45);
  assert.equal(BINARY_SENSOR_DEVICE_CLASSES.length, 29);
  assert.equal(COVER_DEVICE_CLASSES.length, 10);
  assert.equal(MEDIA_PLAYER_DEVICE_CLASSES.length, 4);
  assert.equal(SWITCH_DEVICE_CLASSES.length, 2);
  assert.equal(BUTTON_DEVICE_CLASSES.length, 3);
  assert.equal(EVENT_DEVICE_CLASSES.length, 3);
  assert.equal(SENSOR_DEVICE_CLASSES.length, 62);
  assert.equal(NUMBER_DEVICE_CLASSES.length, 58);
});

test('Home Assistant 18 Complex Feature Registries validation', () => {
  // 1. AlarmControlPanel
  assert.equal(AlarmControlPanelEntityFeature.ARM_HOME, 1);
  assert.equal(AlarmControlPanelEntityFeature.ARM_AWAY, 2);
  assert.equal(AlarmControlPanelEntityFeature.ARM_NIGHT, 4);
  assert.equal(AlarmControlPanelEntityFeature.TRIGGER, 8);
  assert.equal(AlarmControlPanelEntityFeature.ARM_CUSTOM_BYPASS, 16);
  assert.equal(AlarmControlPanelEntityFeature.ARM_VACATION, 32);

  // 2. Camera
  assert.equal(CameraEntityFeature.ON_OFF, 1);
  assert.equal(CameraEntityFeature.STREAM, 2);

  // 3. Climate
  assert.equal(ClimateEntityFeature.TARGET_TEMPERATURE, 1);
  assert.equal(ClimateEntityFeature.TARGET_TEMPERATURE_RANGE, 2);
  assert.equal(ClimateEntityFeature.TARGET_HUMIDITY, 4);
  assert.equal(ClimateEntityFeature.FAN_MODE, 8);
  assert.equal(ClimateEntityFeature.PRESET_MODE, 16);
  assert.equal(ClimateEntityFeature.SWING_MODE, 32);
  assert.equal(ClimateEntityFeature.TURN_OFF, 128);
  assert.equal(ClimateEntityFeature.TURN_ON, 256);
  assert.equal(ClimateEntityFeature.SWING_HORIZONTAL_MODE, 512);

  // 4. Cover
  assert.equal(CoverEntityFeature.OPEN, 1);
  assert.equal(CoverEntityFeature.CLOSE, 2);
  assert.equal(CoverEntityFeature.SET_POSITION, 4);
  assert.equal(CoverEntityFeature.STOP, 8);
  assert.equal(CoverEntityFeature.OPEN_TILT, 16);
  assert.equal(CoverEntityFeature.CLOSE_TILT, 32);
  assert.equal(CoverEntityFeature.STOP_TILT, 64);
  assert.equal(CoverEntityFeature.SET_TILT_POSITION, 128);
  assert.equal(CoverEntityFeature.SPEED, 256);

  // 5. Fan
  assert.equal(FanEntityFeature.SET_SPEED, 1);
  assert.equal(FanEntityFeature.OSCILLATE, 2);
  assert.equal(FanEntityFeature.DIRECTION, 4);
  assert.equal(FanEntityFeature.PRESET_MODE, 8);
  assert.equal(FanEntityFeature.TURN_OFF, 16);
  assert.equal(FanEntityFeature.TURN_ON, 32);

  // 6. Humidifier
  assert.equal(HumidifierEntityFeature.MODES, 1);

  // 7. LawnMower
  assert.equal(LawnMowerEntityFeature.START_MOWING, 1);
  assert.equal(LawnMowerEntityFeature.PAUSE, 2);
  assert.equal(LawnMowerEntityFeature.STOP, 4);
  assert.equal(LawnMowerEntityFeature.DOCK, 8);

  // 8. Light
  assert.equal(LightEntityFeature.EFFECT, 4);
  assert.equal(LightEntityFeature.FLASH, 8);
  assert.equal(LightEntityFeature.TRANSITION, 32);

  // 9. Lock
  assert.equal(LockEntityFeature.OPEN, 1);

  // 10. MediaPlayer
  assert.equal(MediaPlayerEntityFeature.PAUSE, 1);
  assert.equal(MediaPlayerEntityFeature.SEEK, 2);
  assert.equal(MediaPlayerEntityFeature.VOLUME_SET, 4);
  assert.equal(MediaPlayerEntityFeature.VOLUME_MUTE, 8);
  assert.equal(MediaPlayerEntityFeature.PLAY_MEDIA, 512);
  assert.equal(MediaPlayerEntityFeature.SEARCH_MEDIA, 4194304);

  // 11. Remote
  assert.equal(RemoteEntityFeature.LEARN_COMMAND, 1);
  assert.equal(RemoteEntityFeature.DELETE_COMMAND, 2);
  assert.equal(RemoteEntityFeature.ACTIVITY, 4);

  // 12. Siren
  assert.equal(SirenEntityFeature.TURN_ON, 1);
  assert.equal(SirenEntityFeature.TURN_OFF, 2);
  assert.equal(SirenEntityFeature.TONES, 4);
  assert.equal(SirenEntityFeature.VOLUME_SET, 8);
  assert.equal(SirenEntityFeature.DURATION, 16);

  // 13. Todo
  assert.equal(TodoEntityFeature.SUPPORT_MOVE, 1);

  // 14. Update
  assert.equal(UpdateEntityFeature.INSTALL, 1);
  assert.equal(UpdateEntityFeature.RELEASE_NOTES, 16);

  // 15. Vacuum
  assert.equal(VacuumEntityFeature.PAUSE, 4);
  assert.equal(VacuumEntityFeature.STOP, 8);
  assert.equal(VacuumEntityFeature.RETURN_HOME, 16);
  assert.equal(VacuumEntityFeature.FAN_SPEED, 32);
  assert.equal(VacuumEntityFeature.CLEAN_AREA, 16384);

  // 16. Valve
  assert.equal(ValveEntityFeature.OPEN, 1);
  assert.equal(ValveEntityFeature.CLOSE, 2);
  assert.equal(ValveEntityFeature.SET_POSITION, 4);
  assert.equal(ValveEntityFeature.STOP, 8);

  // 17. WaterHeater
  assert.equal(WaterHeaterEntityFeature.TARGET_TEMPERATURE, 1);
  assert.equal(WaterHeaterEntityFeature.OPERATION_MODE, 2);
  assert.equal(WaterHeaterEntityFeature.AWAY_MODE, 4);

  // 18. Weather
  assert.equal(WeatherEntityFeature.FORECAST_DAILY, 1);
  assert.equal(WeatherEntityFeature.FORECAST_HOURLY, 2);
  assert.equal(WeatherEntityFeature.FORECAST_TWICE_DAILY, 4);
});

test('Security System state machine and HomeKit policy mapping invariants', () => {
  // 1. Invariant: DISARMED maps to DISARMED / DISARM
  const disarmed = mapSecurityStateToHap('DISARMED');
  assert.equal(disarmed.currentState, HapSecurityCurrentState.DISARMED);
  assert.equal(disarmed.targetState, HapSecurityTargetState.DISARM);

  // 2. Invariant: Standard armed states
  const home = mapSecurityStateToHap('ARMED_HOME');
  assert.equal(home.currentState, HapSecurityCurrentState.STAY_ARM);
  assert.equal(home.targetState, HapSecurityTargetState.STAY_ARM);

  const away = mapSecurityStateToHap('ARMED_AWAY');
  assert.equal(away.currentState, HapSecurityCurrentState.AWAY_ARM);
  assert.equal(away.targetState, HapSecurityTargetState.AWAY_ARM);

  const night = mapSecurityStateToHap('ARMED_NIGHT');
  assert.equal(night.currentState, HapSecurityCurrentState.NIGHT_ARM);
  assert.equal(night.targetState, HapSecurityTargetState.NIGHT_ARM);

  // 3. Invariant: TRIGGERED NEVER maps to an arm target!
  const triggered = mapSecurityStateToHap('TRIGGERED');
  assert.equal(triggered.currentState, HapSecurityCurrentState.ALARM_TRIGGERED);
  assert.equal(triggered.targetState, undefined);

  // 4. Invariant: PENDING, ARMING, DISARMING NEVER map to ALARM_TRIGGERED
  const pending = mapSecurityStateToHap('PENDING', {
    priorArmedState: HapSecurityCurrentState.STAY_ARM,
  });
  assert.notEqual(pending.currentState, HapSecurityCurrentState.ALARM_TRIGGERED);
  assert.equal(pending.currentState, HapSecurityCurrentState.STAY_ARM);

  const armingAway = mapSecurityStateToHap('ARMING_AWAY', {
    priorArmedState: HapSecurityCurrentState.DISARMED,
  });
  assert.notEqual(armingAway.currentState, HapSecurityCurrentState.ALARM_TRIGGERED);
  assert.equal(armingAway.targetState, HapSecurityTargetState.AWAY_ARM);

  // 5. Configurable projection for VACATION and CUSTOM modes
  const vacation = mapSecurityStateToHap('ARMED_VACATION');
  assert.equal(vacation.targetState, HapSecurityTargetState.AWAY_ARM);

  const custom = mapSecurityStateToHap('ARMED_CUSTOM');
  assert.equal(custom.targetState, HapSecurityTargetState.STAY_ARM);

  // 6. FAULT sets statusFault
  const fault = mapSecurityStateToHap('FAULT', {
    priorArmedState: HapSecurityCurrentState.STAY_ARM,
  });
  assert.equal(fault.statusFault, true);
});

test('HapProxyIdentityMapper manages persistent upstream <-> outbound mappings', () => {
  const mapper = new HapProxyIdentityMapper();

  const upstream1 = { accessoryId: 'native-camera-01', upstreamAid: 1, upstreamIid: 12 };
  const outbound1 = { outboundAid: 2, outboundIid: 100 };

  mapper.bindIdentity(upstream1, outbound1);

  assert.deepEqual(mapper.getOutbound(upstream1), outbound1);
  assert.deepEqual(mapper.getUpstream(2, 100), upstream1);
  assert.equal(mapper.getUpstream(2, 999), undefined);

  mapper.clear();
  assert.equal(mapper.getOutbound(upstream1), undefined);
});

test('HA Entity normalization handles all 45 platforms', () => {
  for (const domain of HA_ENTITY_PLATFORMS) {
    const res = normalizeHaEntity({
      entity_id: `${domain}.test`,
      state: 'active',
      attributes: { friendly_name: `Test ${domain}` },
    });
    assert.ok(res.endpoint, `Missing endpoint for domain: ${domain}`);
    assert.ok(res.category, `Missing category for domain: ${domain}`);
  }
});
