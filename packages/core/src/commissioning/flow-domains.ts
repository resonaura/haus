/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { FlowCapabilityRequirement, FlowFormField, FlowStepType } from './flow-types.js';
import { MULTISTEP_FLOW_DOMAINS } from './flow-multistep.js';

export interface DomainFlowStepSpec {
  readonly type: Extract<FlowStepType, 'form' | 'menu' | 'external' | 'progress'>;
  readonly title: string;
  readonly description?: string;
  readonly schema?: readonly FlowFormField[];
  readonly buildSchema?: (
    context: Readonly<Record<string, unknown>>,
    flowId: string,
  ) => readonly FlowFormField[];
  readonly menuOptions?: readonly string[] | Readonly<Record<string, string>>;
  readonly menuDescriptions?: Readonly<Record<string, string>>;
  readonly menuNextStepIds?: Readonly<Record<string, string>>;
  readonly nextStepId?: string;
  readonly lastStep?: boolean;
  readonly url?: string;
  readonly validate?: (
    values: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, string>> | undefined;
}

export interface DomainFlowDefinition {
  readonly authMethod: 'form' | 'menu' | 'oauth' | '2fa' | 'zero_config' | 'unsupported';
  readonly title: string;
  readonly description?: string;
  readonly documentationUrl?: string;
  readonly supportsMultiple?: boolean;
  readonly schema?: readonly FlowFormField[];
  readonly optionsSchema?: readonly FlowFormField[];
  readonly optionsTitle?: string;
  readonly initialStepId?: string;
  readonly steps?: Readonly<Record<string, DomainFlowStepSpec>>;
  readonly buildEntryTitle?: (values: Readonly<Record<string, unknown>>) => string;
  readonly oauthUrl?: string;
  readonly unsupported?: readonly FlowCapabilityRequirement[];
  readonly requires2fa?: boolean;
}

export const KNOWN_FLOW_DOMAINS: Record<string, DomainFlowDefinition> = {
  homekit_controller: {
    authMethod: 'form',
    title: 'Pair HomeKit Device',
    schema: [{ name: 'pin', type: 'pin', label: 'Setup Code', required: true }],
  },
  matter: {
    authMethod: 'form',
    title: 'Commission Matter Node',
    schema: [{ name: 'code', type: 'string', label: 'Manual or QR code', required: true }],
  },
  govee: {
    authMethod: 'form',
    title: 'Configure Govee',
    schema: [
      { name: 'username', type: 'string', label: 'Govee account email', required: false },
      { name: 'password', type: 'pin', label: 'Govee account password', required: false },
      {
        name: 'hybridSplit',
        type: 'boolean',
        label: 'Hybrid mode (Homebridge outlets + Govee2MQTT lights)',
        defaultValue: true,
      },
      {
        name: 'bleDisable',
        type: 'boolean',
        label: 'Disable Bluetooth Low Energy (BLE)',
        defaultValue: false,
      },
      { name: 'awsDisable', type: 'boolean', label: 'Disable AWS IoT cloud', defaultValue: false },
      { name: 'lanDisable', type: 'boolean', label: 'Disable local LAN UDP', defaultValue: false },
    ],
  },
  'homebridge-govee': {
    authMethod: 'form',
    title: 'Configure Homebridge Govee',
    schema: [
      { name: 'username', type: 'string', label: 'Govee account email', required: false },
      { name: 'password', type: 'pin', label: 'Govee account password', required: false },
      {
        name: 'bleDisable',
        type: 'boolean',
        label: 'Disable Bluetooth Low Energy (BLE)',
        defaultValue: false,
      },
      { name: 'awsDisable', type: 'boolean', label: 'Disable AWS IoT cloud', defaultValue: false },
      { name: 'lanDisable', type: 'boolean', label: 'Disable local LAN UDP', defaultValue: false },
    ],
  },
  meross_lan: {
    authMethod: 'form',
    title: 'Add Meross LAN Device',
    schema: [
      { name: 'host', type: 'string', label: 'IP address or hostname', required: true },
      { name: 'key', type: 'pin', label: 'Device key (optional)', required: false },
    ],
  },
  sensibo: {
    authMethod: 'form',
    title: 'Connect Sensibo AirQ',
    schema: [{ name: 'apiKey', type: 'pin', label: 'Sensibo REST API Key', required: true }],
  },
  hue: {
    authMethod: 'form',
    title: 'Connect Philips Hue Bridge',
    schema: [
      {
        name: 'host',
        type: 'string',
        label: 'Bridge IP (leave empty to auto-detect)',
        required: false,
      },
    ],
  },
  eero: {
    authMethod: '2fa',
    title: 'Sign in to Eero',
    requires2fa: true,
    schema: [
      { name: 'user_token', type: 'string', label: 'Phone number or email', required: true },
    ],
  },
  nest: {
    authMethod: 'oauth',
    title: 'Link Google Nest Account',
    oauthUrl: 'https://nestservices.google.com/partnerconnections',
  },
  spotify: {
    authMethod: 'oauth',
    title: 'Link Spotify Account',
    oauthUrl: 'https://accounts.spotify.com/authorize',
  },
  mqtt: {
    authMethod: 'form',
    title: 'Configure MQTT Broker',
    schema: [
      {
        name: 'broker',
        type: 'string',
        label: 'Broker Host',
        required: true,
        defaultValue: '127.0.0.1',
      },
      { name: 'port', type: 'number', label: 'Port', required: true, defaultValue: 1883 },
      { name: 'username', type: 'string', label: 'Username', required: false },
      { name: 'password', type: 'pin', label: 'Password', required: false },
    ],
  },
  transmission: {
    authMethod: 'form',
    title: 'Connect Transmission',
    schema: [
      { name: 'host', type: 'string', label: 'Host', required: true, defaultValue: '127.0.0.1' },
      { name: 'port', type: 'number', label: 'Port', required: true, defaultValue: 9091 },
      { name: 'username', type: 'string', label: 'Username', required: false },
      { name: 'password', type: 'pin', label: 'Password', required: false },
    ],
  },
  speedtestdotnet: {
    authMethod: 'zero_config',
    title: 'SpeedTest.net Diagnostics',
  },
  openweathermap: {
    authMethod: 'form',
    title: 'Connect OpenWeatherMap',
    schema: [{ name: 'api_key', type: 'pin', label: 'OpenWeatherMap API Key', required: true }],
  },
  telegram_bot: {
    authMethod: 'form',
    title: 'Configure Telegram Bot',
    supportsMultiple: true,
    schema: [
      { name: 'api_key', type: 'pin', label: 'Telegram Bot Token', required: true },
      { name: 'chat_id', type: 'string', label: 'Allowed Chat ID', required: true },
    ],
  },
  ...MULTISTEP_FLOW_DOMAINS,
};
