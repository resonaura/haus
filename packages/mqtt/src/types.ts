/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type MqttQos = 0 | 1 | 2;

export interface MqttMessage {
  readonly topic: string;
  readonly payload: string;
  readonly retained?: boolean;
  readonly qos?: MqttQos;
  readonly timestamp?: number;
}

export interface MqttCommand {
  readonly topic: string;
  readonly payload: string;
  readonly qos?: MqttQos;
  readonly retain?: boolean;
}

export interface MqttConnectionInfo {
  readonly host: string;
  readonly port: number;
  readonly allowAnonymous: boolean;
  readonly username?: string;
  readonly password?: string;
}

export type MqttEntityKind =
  | 'switch'
  | 'light'
  | 'sensor'
  | 'binary_sensor'
  | 'camera'
  | 'climate'
  | 'water_heater'
  | 'lock'
  | 'cover'
  | 'fan'
  | 'number'
  | 'select'
  | 'button';

export interface HaMqttDeviceBlock {
  readonly identifiers?: readonly string[] | string;
  readonly connections?: ReadonlyArray<readonly [string, string]>;
  readonly name?: string;
  readonly manufacturer?: string;
  readonly model?: string;
  readonly sw_version?: string;
  readonly hw_version?: string;
  readonly serial_number?: string;
  readonly model_id?: string;
  readonly configuration_url?: string;
  readonly suggested_area?: string;
  readonly via_device?: string;
}

export interface HaMqttOriginBlock {
  readonly name: string;
  readonly sw_version?: string;
  readonly support_url?: string;
}

export interface HaMqttAvailabilityTopic {
  readonly topic: string;
  readonly payload_available?: string;
  readonly payload_not_available?: string;
  readonly value_template?: string;
}

export interface MqttAvailabilityRule {
  readonly mode: 'all' | 'any' | 'latest';
  readonly topics: readonly HaMqttAvailabilityTopic[];
}

export interface HaMqttComponentConfig {
  readonly origin?: HaMqttOriginBlock;
  readonly platform?: string;
  readonly unique_id?: string;
  readonly object_id?: string;
  readonly name?: string | null;
  readonly schema?: string;
  readonly state_topic?: string;
  readonly command_topic?: string;
  readonly availability_topic?: string;
  readonly availability?: readonly HaMqttAvailabilityTopic[];
  readonly availability_mode?: 'all' | 'any' | 'latest';
  readonly availability_template?: string;
  readonly payload_available?: string;
  readonly payload_not_available?: string;
  readonly json_attributes_topic?: string;
  readonly json_attributes_template?: string;
  readonly value_template?: string;
  readonly command_template?: string;
  readonly payload_on?: string | boolean | number;
  readonly payload_off?: string | boolean | number;
  readonly payload_press?: string;
  readonly state_on?: string | boolean | number;
  readonly state_off?: string | boolean | number;
  readonly device_class?: string;
  readonly unit_of_measurement?: string;
  readonly entity_category?: 'config' | 'diagnostic' | string;
  readonly icon?: string;
  readonly enabled_by_default?: boolean;
  readonly brightness?: boolean;
  readonly brightness_scale?: number;
  readonly color_mode?: boolean;
  readonly supported_color_modes?: readonly string[];
  readonly effect?: boolean;
  readonly effect_list?: readonly string[];
  readonly min_mireds?: number;
  readonly max_mireds?: number;
  readonly min_kelvin?: number;
  readonly max_kelvin?: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly suggested_display_precision?: number;
  readonly mode?: string;
  readonly options?: readonly string[];
  readonly modes?: readonly string[];
  readonly min_temp?: number;
  readonly max_temp?: number;
  readonly precision?: number;
  readonly temp_step?: number;
  readonly temperature_unit?: string;
  readonly mode_state_topic?: string;
  readonly mode_state_template?: string;
  readonly mode_command_topic?: string;
  readonly temperature_state_topic?: string;
  readonly temperature_state_template?: string;
  readonly temperature_command_topic?: string;
  readonly current_temperature_topic?: string;
  readonly current_temperature_template?: string;
  readonly power_command_topic?: string;
  readonly position_topic?: string;
  readonly set_position_topic?: string;
  readonly percentage_state_topic?: string;
  readonly percentage_value_template?: string;
  readonly percentage_command_topic?: string;
  readonly payload_reset_percentage?: string;
  readonly speed_range_min?: number;
  readonly speed_range_max?: number;
  readonly state_value_template?: string;
  readonly device?: HaMqttDeviceBlock;
}

/** Generic MQTT discovery payload announced by user-installed apps and devices. */
export type MqttDiscoveryPayload = HaMqttComponentConfig;

export type SingleEntityDiscoveryPayload = HaMqttComponentConfig;

export interface DeviceBundleDiscoveryPayload {
  readonly origin?: HaMqttOriginBlock;
  readonly device?: HaMqttDeviceBlock;
  readonly state_topic?: string;
  readonly availability_topic?: string;
  readonly availability?: readonly HaMqttAvailabilityTopic[];
  readonly availability_mode?: 'all' | 'any' | 'latest';
  readonly availability_template?: string;
  readonly payload_available?: string;
  readonly payload_not_available?: string;
  readonly components: Readonly<Record<string, HaMqttComponentConfig>>;
}

export interface MqttEndpointBinding {
  readonly endpointId: string;
  readonly deviceId: string;
  readonly component: string;
  readonly primaryCapabilityId: string;
  readonly isJsonSchema: boolean;
  readonly stateTopic?: string;
  readonly attributesTopic?: string;
  readonly attributesTemplate?: string;
  readonly availability?: MqttAvailabilityRule;
  readonly commandTopic?: string;
  readonly payloadOn: string;
  readonly payloadOff: string;
  readonly valueTemplate?: string;
  readonly propertyKey?: string;
  readonly brightnessScale?: number;
  readonly supportedColorModes?: readonly string[];
  readonly modeStateTopic?: string;
  readonly modeStateTemplate?: string;
  readonly modeCommandTopic?: string;
  readonly temperatureStateTopic?: string;
  readonly temperatureStateTemplate?: string;
  readonly temperatureCommandTopic?: string;
  readonly currentTemperatureTopic?: string;
  readonly currentTemperatureTemplate?: string;
  readonly powerCommandTopic?: string;
  readonly percentageStateTopic?: string;
  readonly percentageValueTemplate?: string;
  readonly payloadResetPercentage?: string;
  readonly speedRangeMin?: number;
  readonly speedRangeMax?: number;
  readonly stateValueTemplate?: string;
}

export type MqttMessageHandler = (message: MqttMessage) => void | Promise<void>;
