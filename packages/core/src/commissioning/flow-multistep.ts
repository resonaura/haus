/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { DomainFlowDefinition } from './flow-domains.js';

function encodeQrToken(flowId: string, userCode: string): string {
  const bytes = new TextEncoder().encode(`${flowId}:${userCode}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export const MULTISTEP_FLOW_DOMAINS: Readonly<Record<string, DomainFlowDefinition>> = {
  tuya: {
    authMethod: 'form',
    title: 'Tuya',
    description:
      'Enter your Smart Life or Tuya Smart user code.\n\nYou can find this code in the Smart Life app or Tuya Smart app in **Settings > Account and Security** screen, and enter the code shown on the **User Code** field. The user code is case-sensitive, please be sure to enter it exactly as shown in the app.',
    documentationUrl: 'https://www.home-assistant.io/integrations/tuya/',
    supportsMultiple: true,
    initialStepId: 'user',
    steps: {
      user: {
        type: 'form',
        title: 'Tuya',
        description:
          'Enter your Smart Life or Tuya Smart user code.\n\nYou can find this code in the Smart Life app or Tuya Smart app in **Settings > Account and Security** screen, and enter the code shown on the **User Code** field. The user code is case-sensitive, please be sure to enter it exactly as shown in the app.',
        schema: [
          {
            name: 'user_code',
            type: 'string',
            label: 'User code',
            required: true,
          },
        ],
        validate: (values) => {
          const raw = typeof values.user_code === 'string' ? values.user_code : '';
          const trimmed = raw.trim();
          if (!trimmed) return { user_code: 'required' };
          if (raw !== trimmed || trimmed.length < 4) {
            return { user_code: 'invalid_user_code' };
          }
          return undefined;
        },
        nextStepId: 'scan',
        lastStep: false,
      },
      scan: {
        type: 'form',
        title: 'Tuya',
        description:
          'Use the Smart Life app or Tuya Smart app to scan the following QR code to complete the login.\n\nContinue to the next step once you have completed this step in the app.',
        lastStep: true,
        buildSchema: (context, flowId) => {
          const code = typeof context.user_code === 'string' ? context.user_code.trim() : 'tuya';
          const tokenPayload = encodeQrToken(flowId, code);
          const qrData = `tuyaSmart--qrLogin?token=${tokenPayload}`;
          return [
            {
              name: 'QR',
              type: 'qr_code',
              label: 'QR code',
              required: false,
              defaultValue: qrData,
              selector: {
                qr_code: {
                  data: qrData,
                  scale: 5,
                  error_correction_level: 'Q',
                },
              },
            },
          ];
        },
      },
    },
    optionsTitle: 'Tuya Options',
    optionsSchema: [
      {
        name: 'prefer_local',
        type: 'boolean',
        label: 'Prefer local LAN communication when available',
        defaultValue: true,
      },
      {
        name: 'refresh_interval',
        type: 'integer',
        label: 'Cloud state refresh interval (seconds)',
        defaultValue: 30,
        min: 5,
        max: 300,
      },
    ],
    buildEntryTitle: (values) => {
      if (typeof values.user_code === 'string' && values.user_code.trim()) {
        return `Tuya (${values.user_code.trim()})`;
      }
      return 'Tuya';
    },
  },
  xiaomi_miot: {
    authMethod: 'menu',
    title: 'Select Action',
    description: 'Configure Xiaomi Miot Auto using Mi Account or local host/token.',
    documentationUrl: 'https://github.com/al-one/hass-xiaomi-miot',
    supportsMultiple: true,
    initialStepId: 'user',
    steps: {
      user: {
        type: 'menu',
        title: 'Select Action',
        description:
          'Choose how you want to add your Xiaomi devices. You can add multiple accounts.',
        menuOptions: {
          cloud: 'Add devices using Mi Account (账号集成)',
          local: 'Add device using host/token (局域网集成)',
        },
        menuDescriptions: {
          cloud: 'Sign in with Xiaomi Cloud / Mi Home credentials to import account devices.',
          local: 'Add a single device directly over LAN using IP address and 32-char token.',
        },
        menuNextStepIds: {
          cloud: 'cloud',
          local: 'local',
        },
        lastStep: false,
      },
      cloud: {
        type: 'form',
        title: 'Xiaomi Cloud Account',
        description: 'Sign in to your Xiaomi / Mi Home account.',
        lastStep: false,
        nextStepId: 'cloud_filter',
        schema: [
          {
            name: 'username',
            type: 'string',
            label: 'Xiaomi Account ID / Email / Phone',
            required: true,
          },
          {
            name: 'password',
            type: 'password',
            label: 'Password',
            required: true,
          },
          {
            name: 'server_country',
            type: 'select',
            label: 'Server Country / Region',
            required: true,
            defaultValue: 'cn',
            options: [
              { value: 'cn', label: 'China (cn)' },
              { value: 'de', label: 'Europe / Germany (de)' },
              { value: 'us', label: 'United States (us)' },
              { value: 'sg', label: 'Singapore (sg)' },
              { value: 'ru', label: 'Russia (ru)' },
              { value: 'tw', label: 'Taiwan (tw)' },
              { value: 'in', label: 'India (in)' },
              { value: 'i2', label: 'International (i2)' },
            ],
          },
          {
            name: 'conn_mode',
            type: 'select',
            label: 'Connection Mode',
            required: true,
            defaultValue: 'auto',
            options: [
              { value: 'auto', label: 'Automatic (Local first, Cloud fallback)' },
              { value: 'local', label: 'Local Only' },
              { value: 'cloud', label: 'Cloud Only' },
            ],
          },
          {
            name: 'trans_options',
            type: 'boolean',
            label: 'Automatically translate entity & option names',
            defaultValue: true,
          },
        ],
      },
      cloud_filter: {
        type: 'form',
        title: 'Device Filter & Polling Options',
        description: 'Optional: filter specific Xiaomi devices or tune polling intervals.',
        lastStep: true,
        schema: [
          {
            name: 'filter_mode',
            type: 'select',
            label: 'Device filter mode',
            required: false,
            defaultValue: 'exclude',
            options: [
              { value: 'exclude', label: 'Exclude listed models / DIDs' },
              { value: 'include', label: 'Include only listed models / DIDs' },
            ],
          },
          {
            name: 'device_list',
            type: 'string',
            label: 'Filter DIDs or models (comma-separated, optional)',
            required: false,
          },
          {
            name: 'poll_interval',
            type: 'integer',
            label: 'Default polling interval (seconds)',
            required: false,
            defaultValue: 30,
            min: 5,
            max: 3600,
          },
        ],
      },
      local: {
        type: 'form',
        title: 'Add Device Using Host / Token',
        description: 'Connect a local Xiaomi MiIO/Miot Wi-Fi device with its 32-hex token.',
        lastStep: true,
        schema: [
          { name: 'host', type: 'string', label: 'Device IP Address', required: true },
          {
            name: 'token',
            type: 'pin',
            label: 'Device Token (32 hex chars)',
            required: true,
            placeholder: '0123456789abcdef0123456789abcdef',
          },
          { name: 'name', type: 'string', label: 'Device Name (optional)', required: false },
          {
            name: 'model',
            type: 'string',
            label: 'Model (optional, e.g. chuangmi.plug.hmi206)',
            required: false,
          },
        ],
        validate: (values) => {
          const token = typeof values.token === 'string' ? values.token.trim() : '';
          if (!/^[0-9a-fA-F]{32}$/.test(token)) {
            return { token: 'invalid_token' };
          }
          return undefined;
        },
      },
    },
    optionsTitle: 'Xiaomi Miot Options',
    optionsSchema: [
      {
        name: 'conn_mode',
        type: 'select',
        label: 'Connection Mode',
        defaultValue: 'auto',
        options: [
          { value: 'auto', label: 'Automatic (Local + Cloud)' },
          { value: 'local', label: 'Local Only' },
          { value: 'cloud', label: 'Cloud Only' },
        ],
      },
      {
        name: 'poll_interval',
        type: 'integer',
        label: 'Polling interval (seconds)',
        defaultValue: 30,
        min: 5,
        max: 3600,
      },
      {
        name: 'trans_options',
        type: 'boolean',
        label: 'Translate entity & option names',
        defaultValue: true,
      },
    ],
    buildEntryTitle: (values) => {
      if (typeof values.username === 'string' && values.username.trim()) {
        return `Xiaomi: ${values.username.trim()}`;
      }
      if (typeof values.name === 'string' && values.name.trim()) {
        return values.name.trim();
      }
      if (typeof values.host === 'string' && values.host.trim()) {
        return `Xiaomi Local: ${values.host.trim()}`;
      }
      return 'Xiaomi Miot';
    },
  },
  yeelight: {
    authMethod: 'form',
    title: 'Add Yeelight Device',
    description: 'Enter the Yeelight IP address, or leave blank to discover LAN lamps.',
    documentationUrl: 'https://www.home-assistant.io/integrations/yeelight/',
    supportsMultiple: true,
    schema: [
      {
        name: 'host',
        type: 'string',
        label: 'IP Address (leave blank for LAN discovery)',
        required: false,
      },
      { name: 'name', type: 'string', label: 'Device Name (optional)', required: false },
      { name: 'model', type: 'string', label: 'Model (optional)', required: false },
      {
        name: 'use_music_mode',
        type: 'boolean',
        label: 'Enable Music Mode (low-latency updates)',
        defaultValue: false,
      },
      {
        name: 'save_on_change',
        type: 'boolean',
        label: 'Save light state on change',
        defaultValue: true,
      },
    ],
    optionsTitle: 'Yeelight Device Options',
    optionsSchema: [
      {
        name: 'transition',
        type: 'integer',
        label: 'Transition duration (ms)',
        defaultValue: 350,
        min: 0,
        max: 10000,
      },
      { name: 'use_music_mode', type: 'boolean', label: 'Enable Music Mode', defaultValue: false },
      {
        name: 'save_on_change',
        type: 'boolean',
        label: 'Save state on change',
        defaultValue: true,
      },
      {
        name: 'nightlight_switch',
        type: 'boolean',
        label: 'Expose nightlight switch',
        defaultValue: false,
      },
    ],
    buildEntryTitle: (values) => {
      if (typeof values.name === 'string' && values.name.trim()) return values.name.trim();
      if (typeof values.host === 'string' && values.host.trim()) {
        return `Yeelight ${values.host.trim()}`;
      }
      return 'Yeelight Discovery';
    },
  },
};
