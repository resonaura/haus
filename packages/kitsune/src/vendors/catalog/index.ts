/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
export const bridgeProviders = ['aqara', 'tuya'] as const;
export const isBridgeProvider = (value: unknown): value is (typeof bridgeProviders)[number] =>
  typeof value === 'string' && (bridgeProviders as readonly string[]).includes(value);
export const cameraIntegrationDomains: readonly string[] = [
  'generic',
  'onvif',
  'mjpeg',
  'reolink',
  'axis',
  'amcrest',
  'arlo',
  'blink',
  'ring',
  'ezviz',
  'foscam',
  'hikvision',
  'dahua',
  'unifiprotect',
  'eufy_security',
  'tapo',
  'tapo_control',
  'netatmo',
  'nest',
  'tuya',
  'mqtt',
  'homekit_controller',
  'homekit_device',
  'xiaomi_home',
  'xiaomi_miot',
];
export interface OnboardingField {
  key: string;
  label: string;
  type: 'host' | 'text' | 'password' | 'url';
  required: boolean;
}
export interface VendorPreset {
  id: string;
  name: string;
  driver: 'native' | 'npm';
  package?: string;
  base?: boolean;
  fields: OnboardingField[];
}
const localFields: OnboardingField[] = [
  { key: 'ip', label: 'Camera address', type: 'host', required: true },
  { key: 'username', label: 'Username', type: 'text', required: true },
  { key: 'password', label: 'Password', type: 'password', required: true },
];
export const vendorCatalog: readonly VendorPreset[] = [
  { id: 'aqara', name: 'Aqara', driver: 'native', fields: [] },
  { id: 'tuya', name: 'Tuya', driver: 'native', fields: [] },
  {
    id: 'eufy',
    name: 'Eufy Security',
    driver: 'native',
    fields: [
      {
        key: 'eufy_ws_url',
        label: 'Eufy Security WebSocket address',
        type: 'url',
        required: false,
      },
    ],
  },
  {
    id: 'rtsp',
    name: 'RTSP',
    driver: 'npm',
    package: '@scrypted/rtsp',
    base: true,
    fields: [{ key: 'url', label: 'Stream URL', type: 'url', required: true }],
  },
  ...(['onvif', 'reolink', 'hikvision', 'amcrest', 'unifi-protect', 'tapo'] as const).map((id) => ({
    id,
    name: {
      onvif: 'ONVIF',
      reolink: 'Reolink',
      hikvision: 'Hikvision',
      amcrest: 'Amcrest',
      'unifi-protect': 'UniFi Protect',
      tapo: 'Tapo',
    }[id],
    driver: 'npm' as const,
    package: `@scrypted/${id}`,
    base: id === 'onvif',
    fields: localFields,
  })),
  { id: 'dahua', name: 'Dahua', driver: 'npm', package: '@scrypted/amcrest', fields: localFields },
  {
    id: 'ring',
    name: 'Ring',
    driver: 'npm',
    package: '@scrypted/ring',
    fields: [
      { key: 'refreshToken', label: 'Authorised refresh token', type: 'password', required: true },
    ],
  },
];
