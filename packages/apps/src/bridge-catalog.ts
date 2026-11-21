/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppCatalog } from './catalog.js';
import { resolveImageArchTemplate } from './image.js';

/** Register official third-party camera and bridge app entries into the default catalog. */
export function registerBridgeCatalogEntries(catalog: AppCatalog): void {
  catalog.register({
    category: 'security',
    runtimeType: 'docker',
    featured: true,
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
