/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { AppCatalog } from './catalog.js';

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
}
