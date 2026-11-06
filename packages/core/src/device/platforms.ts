/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

/* ──────────────────────────────────────────────────────────────────────────
 * Home Assistant Generated Entity Platforms (45 Canonical Domains)
 * ────────────────────────────────────────────────────────────────────────── */

export const HA_ENTITY_PLATFORMS = [
  'ai_task',
  'air_quality',
  'alarm_control_panel',
  'assist_satellite',
  'binary_sensor',
  'button',
  'calendar',
  'camera',
  'climate',
  'conversation',
  'cover',
  'date',
  'datetime',
  'device_tracker',
  'event',
  'fan',
  'geo_location',
  'humidifier',
  'image',
  'image_processing',
  'infrared',
  'lawn_mower',
  'light',
  'lock',
  'media_player',
  'notify',
  'number',
  'radio_frequency',
  'remote',
  'scene',
  'select',
  'sensor',
  'siren',
  'stt',
  'switch',
  'text',
  'time',
  'todo',
  'tts',
  'update',
  'vacuum',
  'valve',
  'wake_word',
  'water_heater',
  'weather',
] as const;

export type HaEntityPlatform = (typeof HA_ENTITY_PLATFORMS)[number];

/* ──────────────────────────────────────────────────────────────────────────
 * Device Class Registries
 * ────────────────────────────────────────────────────────────────────────── */

export const BINARY_SENSOR_DEVICE_CLASSES = [
  'battery',
  'battery_charging',
  'carbon_monoxide',
  'cold',
  'connectivity',
  'door',
  'garage_door',
  'gas',
  'glass_break',
  'heat',
  'light',
  'lock',
  'moisture',
  'motion',
  'moving',
  'occupancy',
  'opening',
  'plug',
  'power',
  'presence',
  'problem',
  'running',
  'safety',
  'smoke',
  'sound',
  'tamper',
  'update',
  'vibration',
  'window',
] as const;
export type BinarySensorDeviceClass = (typeof BINARY_SENSOR_DEVICE_CLASSES)[number];

export const COVER_DEVICE_CLASSES = [
  'awning',
  'blind',
  'curtain',
  'damper',
  'door',
  'garage',
  'gate',
  'shade',
  'shutter',
  'window',
] as const;
export type CoverDeviceClass = (typeof COVER_DEVICE_CLASSES)[number];

export const MEDIA_PLAYER_DEVICE_CLASSES = ['tv', 'speaker', 'receiver', 'projector'] as const;
export type MediaPlayerDeviceClass = (typeof MEDIA_PLAYER_DEVICE_CLASSES)[number];

export const SWITCH_DEVICE_CLASSES = ['outlet', 'switch'] as const;
export type SwitchDeviceClass = (typeof SWITCH_DEVICE_CLASSES)[number];

export const BUTTON_DEVICE_CLASSES = ['identify', 'restart', 'update'] as const;
export type ButtonDeviceClass = (typeof BUTTON_DEVICE_CLASSES)[number];

export const EVENT_DEVICE_CLASSES = ['doorbell', 'button', 'motion'] as const;
export type EventDeviceClass = (typeof EVENT_DEVICE_CLASSES)[number];

export const SENSOR_DEVICE_CLASSES = [
  'date',
  'enum',
  'timestamp',
  'uptime',
  'absolute_humidity',
  'apparent_power',
  'aqi',
  'area',
  'atmospheric_pressure',
  'battery',
  'blood_glucose_concentration',
  'carbon_monoxide',
  'carbon_dioxide',
  'conductivity',
  'current',
  'data_rate',
  'data_size',
  'distance',
  'duration',
  'energy',
  'energy_distance',
  'energy_storage',
  'frequency',
  'gas',
  'humidity',
  'illuminance',
  'irradiance',
  'moisture',
  'monetary',
  'nitrogen_dioxide',
  'nitrogen_monoxide',
  'nitrous_oxide',
  'ozone',
  'ph',
  'pm1',
  'pm10',
  'pm25',
  'pm4',
  'power_factor',
  'power',
  'precipitation',
  'precipitation_intensity',
  'pressure',
  'radon',
  'reactive_energy',
  'reactive_power',
  'signal_strength',
  'sound_pressure',
  'speed',
  'sulphur_dioxide',
  'temperature',
  'temperature_delta',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
  'voltage',
  'volume',
  'volume_storage',
  'volume_flow_rate',
  'water',
  'weight',
  'wind_direction',
  'wind_speed',
] as const;
export type SensorDeviceClass = (typeof SENSOR_DEVICE_CLASSES)[number];

export const NUMBER_DEVICE_CLASSES = [
  'absolute_humidity',
  'apparent_power',
  'aqi',
  'area',
  'atmospheric_pressure',
  'battery',
  'blood_glucose_concentration',
  'carbon_monoxide',
  'carbon_dioxide',
  'conductivity',
  'current',
  'data_rate',
  'data_size',
  'distance',
  'duration',
  'energy',
  'energy_distance',
  'energy_storage',
  'frequency',
  'gas',
  'humidity',
  'illuminance',
  'irradiance',
  'moisture',
  'monetary',
  'nitrogen_dioxide',
  'nitrogen_monoxide',
  'nitrous_oxide',
  'ozone',
  'ph',
  'pm1',
  'pm10',
  'pm25',
  'pm4',
  'power_factor',
  'power',
  'precipitation',
  'precipitation_intensity',
  'pressure',
  'radon',
  'reactive_energy',
  'reactive_power',
  'signal_strength',
  'sound_pressure',
  'speed',
  'sulphur_dioxide',
  'temperature',
  'temperature_delta',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
  'voltage',
  'volume',
  'volume_storage',
  'volume_flow_rate',
  'water',
  'weight',
  'wind_direction',
  'wind_speed',
] as const;
export type NumberDeviceClass = (typeof NUMBER_DEVICE_CLASSES)[number];

/* ──────────────────────────────────────────────────────────────────────────
 * Exact Supported-Feature Registries
 * ────────────────────────────────────────────────────────────────────────── */

export const AlarmControlPanelEntityFeature = {
  ARM_HOME: 1,
  ARM_AWAY: 2,
  ARM_NIGHT: 4,
  TRIGGER: 8,
  ARM_CUSTOM_BYPASS: 16,
  ARM_VACATION: 32,
} as const;

export const VacuumEntityFeature = {
  TURN_ON: 1, // Deprecated
  TURN_OFF: 2, // Deprecated
  PAUSE: 4,
  STOP: 8,
  RETURN_HOME: 16,
  FAN_SPEED: 32,
  STATUS: 128, // Deprecated
  SEND_COMMAND: 256,
  LOCATE: 512,
  CLEAN_SPOT: 1024,
  MAP: 2048,
  STATE: 4096,
  START: 8192,
  CLEAN_AREA: 16384,
} as const;

export const ClimateEntityFeature = {
  TARGET_TEMPERATURE: 1,
  TARGET_TEMPERATURE_RANGE: 2,
  TARGET_HUMIDITY: 4,
  FAN_MODE: 8,
  PRESET_MODE: 16,
  SWING_MODE: 32,
  TURN_OFF: 128,
  TURN_ON: 256,
  SWING_HORIZONTAL_MODE: 512,
} as const;

export const MediaPlayerEntityFeature = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  TURN_ON: 128,
  TURN_OFF: 256,
  PLAY_MEDIA: 512,
  VOLUME_STEP: 1024,
  SELECT_SOURCE: 2048,
  STOP: 4096,
  CLEAR_PLAYLIST: 8192,
  PLAY: 16384,
  SHUFFLE_SET: 32768,
  SELECT_SOUND_MODE: 65536,
  BROWSE_MEDIA: 131072,
  REPEAT_SET: 262144,
  GROUPING: 524288,
  MEDIA_ANNOUNCE: 1048576,
  MEDIA_ENQUEUE: 2097152,
  SEARCH_MEDIA: 4194304,
} as const;

export const CoverEntityFeature = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
  OPEN_TILT: 16,
  CLOSE_TILT: 32,
  STOP_TILT: 64,
  SET_TILT_POSITION: 128,
  SPEED: 256,
} as const;

export const LockEntityFeature = {
  OPEN: 1,
} as const;

export const FanEntityFeature = {
  SET_SPEED: 1,
  OSCILLATE: 2,
  DIRECTION: 4,
  PRESET_MODE: 8,
  TURN_OFF: 16,
  TURN_ON: 32,
} as const;

export const CameraEntityFeature = {
  ON_OFF: 1,
  STREAM: 2,
} as const;

export const HumidifierEntityFeature = {
  MODES: 1,
} as const;

export const LawnMowerEntityFeature = {
  START_MOWING: 1,
  PAUSE: 2,
  STOP: 4,
  DOCK: 8,
} as const;

export const LightEntityFeature = {
  EFFECT: 4,
  FLASH: 8,
  TRANSITION: 32,
} as const;

export const RemoteEntityFeature = {
  LEARN_COMMAND: 1,
  DELETE_COMMAND: 2,
  ACTIVITY: 4,
} as const;

export const SirenEntityFeature = {
  TURN_ON: 1,
  TURN_OFF: 2,
  TONES: 4,
  VOLUME_SET: 8,
  DURATION: 16,
} as const;

export const TodoEntityFeature = {
  SUPPORT_MOVE: 1,
} as const;

export const UpdateEntityFeature = {
  INSTALL: 1,
  SPECIFIC_VERSION: 2,
  PROGRESS: 4,
  BACKUP: 8,
  RELEASE_NOTES: 16,
} as const;

export const ValveEntityFeature = {
  OPEN: 1,
  CLOSE: 2,
  SET_POSITION: 4,
  STOP: 8,
} as const;

export const WaterHeaterEntityFeature = {
  TARGET_TEMPERATURE: 1,
  OPERATION_MODE: 2,
  AWAY_MODE: 4,
} as const;

export const WeatherEntityFeature = {
  FORECAST_DAILY: 1,
  FORECAST_HOURLY: 2,
  FORECAST_TWICE_DAILY: 4,
} as const;
