/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IntegrationFlowProfile } from './types.js';

export const INTEGRATION_FLOW_PROFILES: Readonly<Record<string, IntegrationFlowProfile>> = {
  // Standard Form-based Local / Push / Poll
  mqtt: { domain: 'mqtt', title: 'MQTT', defaultSupport: 'supported', authMethod: 'form' },
  generic: {
    domain: 'generic',
    title: 'Generic Camera',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  shelly: { domain: 'shelly', title: 'Shelly', defaultSupport: 'supported', authMethod: 'form' },
  homekit_controller: {
    domain: 'homekit_controller',
    title: 'Apple HomeKit Accessory',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  wled: { domain: 'wled', title: 'WLED', defaultSupport: 'supported', authMethod: 'form' },
  hue: { domain: 'hue', title: 'Philips Hue', defaultSupport: 'supported', authMethod: 'form' },
  nanoleaf: {
    domain: 'nanoleaf',
    title: 'Nanoleaf',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  tuya: { domain: 'tuya', title: 'Tuya', defaultSupport: 'supported', authMethod: 'form' },
  zha: {
    domain: 'zha',
    title: 'Zigbee Home Automation',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  matter: { domain: 'matter', title: 'Matter', defaultSupport: 'supported', authMethod: 'form' },
  esphome: { domain: 'esphome', title: 'ESPHome', defaultSupport: 'supported', authMethod: 'form' },
  tasmota: { domain: 'tasmota', title: 'Tasmota', defaultSupport: 'supported', authMethod: 'form' },
  plex: {
    domain: 'plex',
    title: 'Plex Media Server',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  synology_dsm: {
    domain: 'synology_dsm',
    title: 'Synology DSM',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  unifi: {
    domain: 'unifi',
    title: 'Ubiquiti UniFi',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  tplink: {
    domain: 'tplink',
    title: 'TP-Link Kasa / Tapo',
    defaultSupport: 'supported',
    authMethod: 'form',
  },
  sonos: { domain: 'sonos', title: 'Sonos', defaultSupport: 'supported', authMethod: 'form' },
  roku: { domain: 'roku', title: 'Roku', defaultSupport: 'supported', authMethod: 'form' },
  cast: { domain: 'cast', title: 'Google Cast', defaultSupport: 'supported', authMethod: 'form' },
  apple_tv: {
    domain: 'apple_tv',
    title: 'Apple TV',
    defaultSupport: 'supported',
    authMethod: 'form',
  },

  // OAuth / Browser Authorization Flows
  spotify: {
    domain: 'spotify',
    title: 'Spotify',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  nest: {
    domain: 'nest',
    title: 'Google Nest',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  google: {
    domain: 'google',
    title: 'Google Calendar / Drive',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  google_assistant: {
    domain: 'google_assistant',
    title: 'Google Assistant',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  smartthings: {
    domain: 'smartthings',
    title: 'SmartThings',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  netatmo: {
    domain: 'netatmo',
    title: 'Netatmo',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  withings: {
    domain: 'withings',
    title: 'Withings',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  tesla: {
    domain: 'tesla',
    title: 'Tesla',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  fitbit: {
    domain: 'fitbit',
    title: 'Fitbit',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  strava: {
    domain: 'strava',
    title: 'Strava',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  github: {
    domain: 'github',
    title: 'GitHub',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  ecobee: {
    domain: 'ecobee',
    title: 'ecobee',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },
  dropbox: {
    domain: 'dropbox',
    title: 'Dropbox',
    defaultSupport: 'supported-oauth',
    authMethod: 'oauth',
  },

  // Hardware / Host / Supervisor dependencies (Honest Unsupported Fallbacks)
  bluetooth: {
    domain: 'bluetooth',
    title: 'Bluetooth',
    defaultSupport: 'unsupported',
    authMethod: 'hardware',
    notes: 'Requires host Bluetooth HCI adapter and BlueZ daemon.',
  },
  zwave_js: {
    domain: 'zwave_js',
    title: 'Z-Wave JS',
    defaultSupport: 'unsupported',
    authMethod: 'external_service',
    notes: 'Requires Z-Wave JS server daemon or Supervisor add-on.',
  },
  usb: {
    domain: 'usb',
    title: 'USB Discovery',
    defaultSupport: 'unsupported',
    authMethod: 'hardware',
    notes: 'Direct host USB bus attachment required.',
  },
  hassio: {
    domain: 'hassio',
    title: 'Home Assistant Supervisor',
    defaultSupport: 'unsupported',
    authMethod: 'external_service',
    notes: 'Internal Supervisor system integration.',
  },
};

export function getIntegrationFlowProfile(domain: string): IntegrationFlowProfile {
  const safeDomain = typeof domain === 'string' && domain.trim() ? domain.trim() : 'integration';
  const existing = INTEGRATION_FLOW_PROFILES[safeDomain];
  if (existing) return existing;

  const title = safeDomain.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    domain,
    title,
    defaultSupport: 'supported',
    authMethod: 'form',
  };
}
