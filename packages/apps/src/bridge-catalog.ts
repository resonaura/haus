/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppCatalog } from './catalog.js';
import { resolveImageArchTemplate } from './image.js';
import type { AppOptionSchema, AppSecretDeclaration } from './manifest.js';

/** Register official Haus default and third-party bridge app entries into the catalog. */
export function registerBridgeCatalogEntries(catalog: AppCatalog): void {
  const goveeSecrets: readonly AppSecretDeclaration[] = [
    {
      name: 'password',
      required: false,
      description: 'Govee account password for cloud discovery and BLE keys.',
    },
    {
      name: 'code',
      required: false,
      description: 'One-time Govee 2FA email verification code when prompted.',
    },
    {
      name: 'apiKey',
      required: false,
      description: 'Optional Govee OpenAPI key for rate-limited cloud fallback.',
    },
  ];

  const goveeOptions: readonly AppOptionSchema[] = [
    {
      name: 'username',
      type: 'string',
      required: false,
      description: 'Govee account email address (optional for LAN-only control).',
    },
    {
      name: 'hybridSplit',
      type: 'boolean',
      required: false,
      default: true,
      description: 'Route smart outlets to Homebridge Govee (LAN/BLE) and lights to Govee2MQTT.',
    },
    {
      name: 'bleDisable',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Disable direct Bluetooth Low Energy (BLE) transport.',
    },
    {
      name: 'awsDisable',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Disable Govee AWS IoT cloud transport.',
    },
    {
      name: 'lanDisable',
      type: 'boolean',
      required: false,
      default: false,
      description: 'Disable Govee local LAN UDP transport.',
    },
  ];

  catalog.register({
    category: 'security',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 95,
    stabilityTier: 'gold',
    vendorId: 'aqara',
    vendorName: 'Aqara',
    author: 'Haus Community',
    documentationUrl: 'https://docs.haus.home/apps/aqara-cameras',
    manifest: {
      id: 'aqara-cameras',
      name: 'Aqara Camera Bridge',
      version: '1.2.0',
      image: 'ghcr.io/haus-home/aqara-cameras:1.2.0',
      description: 'Local P2P streaming and recording bridge for Aqara smart cameras.',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'host' },
      ports: [{ containerPort: 8795, protocol: 'tcp' }],
    },
    versions: [
      {
        version: '1.3.0',
        manifest: {
          id: 'aqara-cameras',
          name: 'Aqara Camera Bridge',
          version: '1.3.0',
          image: 'ghcr.io/haus-home/aqara-cameras:1.3.0',
          description:
            'Local P2P streaming and recording bridge for Aqara smart cameras with low latency.',
          architectures: ['amd64', 'arm64'],
          network: { mode: 'host' },
          ports: [{ containerPort: 8795, protocol: 'tcp' }],
        },
        releaseNotes: 'Improved P2P reconnection stability and reduced snapshot latency.',
      },
    ],
  });

  catalog.register({
    category: 'integration',
    runtimeType: 'homebridge',
    featured: true,
    verified: true,
    trustScore: 99,
    stabilityTier: 'gold',
    vendorId: 'govee',
    vendorName: 'Haus Govee',
    author: 'Haus',
    repositoryUrl: 'https://github.com/bwp91/homebridge-govee',
    manifest: {
      id: 'govee',
      name: 'Govee',
      version: '11.39.1',
      image: 'node:22-bookworm-slim',
      description:
        'Unified Haus Govee stack combining Homebridge Govee (LAN/BLE smart outlets & AWS IoT) with Govee2MQTT (low-latency lights & sensors).',
      architectures: ['amd64', 'arm64'],
      options: goveeOptions,
      secrets: goveeSecrets,
    },
  });

  catalog.register({
    category: 'bridge',
    runtimeType: 'homebridge',
    packageName: 'homebridge-govee',
    featured: true,
    verified: true,
    trustScore: 96,
    stabilityTier: 'gold',
    vendorId: 'govee',
    vendorName: 'Haus Govee',
    author: 'bwp91',
    repositoryUrl: 'https://github.com/bwp91/homebridge-govee',
    manifest: {
      id: 'homebridge-govee',
      name: 'Homebridge Govee',
      version: '11.39.1',
      image: 'node:22-bookworm-slim',
      description: 'Homebridge plugin for Govee devices via LAN and BLE with full color control.',
      architectures: ['amd64', 'arm64'],
      options: goveeOptions,
      secrets: goveeSecrets,
    },
  });

  catalog.register({
    category: 'bridge',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 95,
    stabilityTier: 'gold',
    vendorId: 'govee',
    vendorName: 'Haus Govee',
    author: 'Haus Community',
    repositoryUrl: 'https://github.com/wez/govee2mqtt',
    manifest: {
      id: 'govee2mqtt',
      name: 'Govee to MQTT',
      version: '2024.10.1',
      image: 'ghcr.io/haus-home/govee2mqtt:2024.10.1',
      description: 'Bridge Govee BLE, LAN, and Matter devices to the Haus MQTT broker.',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'host' },
      options: goveeOptions,
      secrets: goveeSecrets,
    },
  });

  catalog.register({
    category: 'network',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 97,
    stabilityTier: 'gold',
    vendorId: 'matter',
    vendorName: 'Matter',
    author: 'Home Assistant',
    manifest: {
      id: 'matter-server',
      name: 'Matter Server',
      version: '6.4.0',
      image: 'ghcr.io/home-assistant-libs/python-matter-server:6.4.0',
      description: 'Matter controller server with WebSocket fabric API.',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'host' },
      ports: [{ containerPort: 5580, protocol: 'tcp' }],
    },
  });

  catalog.register({
    category: 'utility',
    runtimeType: 'docker',
    trustScore: 86,
    stabilityTier: 'silver',
    vendorId: 'transmission',
    vendorName: 'Transmission',
    author: 'LinuxServer.io',
    manifest: {
      id: 'transmission',
      name: 'Transmission Daemon',
      version: '4.0.5',
      image: 'lscr.io/linuxserver/transmission:4.0.5',
      description: 'Fast, easy BitTorrent client daemon with RPC API.',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'bridge' },
      ports: [{ containerPort: 9091, hostPort: 9091, protocol: 'tcp' }],
    },
  });

  catalog.register({
    category: 'media',
    runtimeType: 'homebridge',
    packageName: 'homebridge-appletv-enhanced',
    verified: true,
    trustScore: 92,
    stabilityTier: 'gold',
    vendorId: 'apple',
    vendorName: 'Apple',
    author: 'lukasroegner',
    repositoryUrl: 'https://github.com/lukasroegner/homebridge-apple-tv-enhanced',
    manifest: {
      id: 'homebridge-appletv-enhanced',
      name: 'Apple TV Enhanced',
      version: '2.1.0',
      image: 'node:22-bookworm-slim',
      description: 'Apple TV remote control, media playback, and app launching via Homebridge.',
      architectures: ['amd64', 'arm64'],
    },
  });

  catalog.register({
    category: 'utility',
    runtimeType: 'hacs',
    featured: true,
    verified: true,
    trustScore: 93,
    stabilityTier: 'gold',
    vendorId: 'meross',
    vendorName: 'Meross',
    author: 'krahabb',
    repositoryUrl: 'https://github.com/krahabb/meross_lan',
    manifest: {
      id: 'meross_lan',
      name: 'Meross LAN',
      version: '5.0.0',
      image: 'python:3.12-slim',
      description: 'Local network control for Meross smart plugs, surge protectors, and bulbs.',
      architectures: ['amd64', 'arm64'],
    },
  });

  catalog.register({
    category: 'integration',
    runtimeType: 'hacs',
    trustScore: 84,
    stabilityTier: 'silver',
    vendorId: 'sensibo',
    vendorName: 'Sensibo',
    author: 'andres-torres-marroquin',
    repositoryUrl: 'https://github.com/andres-torres-marroquin/sensibo',
    manifest: {
      id: 'sensibo',
      name: 'Sensibo Integration',
      version: '1.3.0',
      image: 'python:3.12-slim',
      description: 'Sensibo Sky and AirQ smart AC control and indoor air quality sensors.',
      architectures: ['amd64', 'arm64'],
    },
  });

  catalog.register({
    category: 'security',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 95,
    stabilityTier: 'gold',
    vendorId: 'tuya',
    vendorName: 'Tuya',
    author: 'Resonaura',
    documentationUrl: 'https://github.com/resonaura/scrypted-tuya/tree/main/bridge',
    repositoryUrl: 'https://github.com/resonaura/scrypted-tuya',
    manifest: {
      id: 'tuya-rtsp-bridge',
      name: 'Tuya Camera Bridge',
      version: '2.2.12',
      image: 'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
      description:
        'Tuya & Smart Life camera P2P/WebRTC-to-RTSP bridge with native Haus pairing and snapshot feeds.',
      architectures: ['amd64', 'arm64'],
      network: { mode: 'host' },
      ports: [
        { containerPort: 6766, protocol: 'tcp' },
        { containerPort: 6767, protocol: 'tcp' },
        { containerPort: 8655, protocol: 'tcp' },
      ],
      mounts: [{ target: 'data', containerPath: '/data' }],
      env: {
        DISABLE_MQTT_WITH_HAUS: 'true',
        LOG_LEVEL: 'info',
      },
    },
  });

  catalog.register({
    category: 'security',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 94,
    stabilityTier: 'gold',
    vendorId: 'aqara',
    vendorName: 'Aqara',
    author: 'Resonaura',
    documentationUrl: 'https://github.com/resonaura/aqara-g5pro-mqtt',
    repositoryUrl: 'https://github.com/resonaura/aqara-g5pro-mqtt',
    addonConfigPath: 'app/config.yaml',
    manifest: {
      id: 'aqara-g5pro',
      name: 'Aqara G5 Pro MQTT Bridge',
      version: '1.6.41',
      image: resolveImageArchTemplate('ghcr.io/resonaura/aqara-g5pro-mqtt/{arch}:1.6.41'),
      description: 'MQTT bridge and local camera accessory gateway for Aqara Camera Hub G5 Pro.',
      architectures: ['amd64', 'arm64', 'armv7', 'i386'],
      network: { mode: 'host' },
      mounts: [{ target: 'data', containerPath: '/data' }],
      services: ['mqtt:want'],
      accessories: { protocol: 'haus-camera-v2', port: 8580 },
    },
  });

  catalog.register({
    category: 'bridge',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 92,
    stabilityTier: 'gold',
    vendorId: 'nixie',
    vendorName: 'Nixie Clock',
    author: 'Resonaura',
    documentationUrl: 'https://github.com/resonaura/nixie-clock-mqtt',
    repositoryUrl: 'https://github.com/resonaura/nixie-clock-mqtt',
    addonConfigPath: 'app/config.yaml',
    manifest: {
      id: 'nixie-clock',
      name: 'Nixie Clock MQTT',
      version: '1.3.10',
      image: resolveImageArchTemplate('ghcr.io/resonaura/nixie-clock-mqtt/{arch}:1.3.10'),
      description:
        'MQTT bridge for Clocteck RGB Tube Clock with per-tube color, alarms, timers, and time sync.',
      architectures: ['amd64', 'arm64', 'armv7', 'i386'],
      network: { mode: 'host' },
      mounts: [{ target: 'data', containerPath: '/data' }],
      services: ['mqtt:want'],
    },
  });

  catalog.register({
    category: 'bridge',
    runtimeType: 'docker',
    featured: true,
    verified: true,
    trustScore: 93,
    stabilityTier: 'gold',
    vendorId: 'haus',
    vendorName: 'Haus',
    author: 'Resonaura',
    documentationUrl: 'https://github.com/resonaura/haus-kettle',
    repositoryUrl: 'https://github.com/resonaura/haus-kettle',
    addonConfigPath: 'haus-kettle/config.yaml',
    manifest: {
      id: 'haus-kettle',
      name: 'Haus Kettle',
      version: '0.1.5',
      image: resolveImageArchTemplate('ghcr.io/resonaura/haus-kettle-{arch}:0.1.5'),
      description:
        'Local BLE/MQTT smart kettle bridge with target temperature and keep-warm control.',
      architectures: ['amd64', 'arm64', 'armv7', 'i386'],
      network: { mode: 'host' },
      mounts: [{ target: 'data', containerPath: '/data' }],
      services: ['mqtt:want'],
    },
  });
}
