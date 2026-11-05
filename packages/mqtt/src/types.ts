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
  | 'lock'
  | 'cover'
  | 'button';

/** Generic MQTT discovery payload announced by user-installed apps and devices. */
export interface MqttDiscoveryPayload {
  readonly name?: string;
  readonly unique_id?: string;
  readonly state_topic?: string;
  readonly command_topic?: string;
  readonly json_attributes_topic?: string;
  readonly value_template?: string;
  readonly device_class?: string;
  readonly unit_of_measurement?: string;
  readonly device?: {
    readonly identifiers?: readonly string[];
    readonly name?: string;
    readonly manufacturer?: string;
    readonly model?: string;
    readonly sw_version?: string;
  };
}

export type MqttMessageHandler = (message: MqttMessage) => void | Promise<void>;
