/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  HaCatalogCoverageSummary,
  HaCatalogManifest,
  HaRuntimeCategory,
  HaRuntimeCoverage,
} from './types.js';

interface KnownRuntimeProfile {
  readonly category: HaRuntimeCategory;
  readonly runtimeStatus: 'executable' | 'planned';
  readonly adapter: string;
  readonly supportedEntities: readonly string[];
  readonly supportedServices: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly notes?: string;
}

const KNOWN_RUNTIME_PROFILES: Readonly<Record<string, KnownRuntimeProfile>> = {
  // Native Haus domains
  mqtt: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/mqtt',
    supportedEntities: ['switch', 'sensor', 'light', 'camera', 'climate', 'fan', 'event'],
    supportedServices: ['publish', 'subscribe', 'retain'],
    missingCapabilities: [],
    notes: 'Native embedded MQTT broker and client with HA discovery compatibility',
  },
  matter: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/matter',
    supportedEntities: ['switch', 'light', 'sensor', 'cover', 'lock'],
    supportedServices: ['commission', 'open_commissioning_window'],
    missingCapabilities: [],
    notes: 'Native Matter Controller and Commissioning Server',
  },
  homekit: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/homekit',
    supportedEntities: ['light', 'switch', 'lock', 'sensor', 'camera'],
    supportedServices: ['publish_accessory', 'publish_bridge', 'reset_pairing'],
    missingCapabilities: [],
    notes: 'Native HAP server and accessory publisher',
  },
  homekit_controller: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/homekit',
    supportedEntities: ['light', 'switch', 'sensor', 'climate', 'fan'],
    supportedServices: ['pair', 'unpair', 'identify'],
    missingCapabilities: [],
    notes: 'Native HomeKit accessory controller discovery and client',
  },
  generic: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/media',
    supportedEntities: ['camera'],
    supportedServices: ['snapshot', 'stream', 'play'],
    missingCapabilities: [],
    notes: 'Native RTSP and MJPEG camera streaming and recording pipeline',
  },
  onvif: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/media',
    supportedEntities: ['camera', 'sensor', 'event'],
    supportedServices: ['ptz', 'snapshot', 'stream'],
    missingCapabilities: [],
    notes: 'Native ONVIF WS-Discovery, PTZ, and media profile engine',
  },
  automation: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/core',
    supportedEntities: ['automation'],
    supportedServices: ['trigger', 'enable', 'disable', 'reload'],
    missingCapabilities: [],
    notes: 'LocalAutomationEngine with durable execution history',
  },
  scene: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/core',
    supportedEntities: ['scene'],
    supportedServices: ['turn_on', 'apply'],
    missingCapabilities: [],
    notes: 'AutomationExecutor scene transition and compound actuation',
  },
  script: {
    category: 'native_haus',
    runtimeStatus: 'executable',
    adapter: '@haus/core',
    supportedEntities: ['script'],
    supportedServices: ['execute', 'cancel', 'reload'],
    missingCapabilities: [],
    notes: 'AutomationExecutor script sequence and branching engine',
  },

  // Kitsune HACS / Python sidecar integrations
  sensibo: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['climate', 'sensor', 'switch', 'button'],
    supportedServices: ['climate.set_hvac_mode', 'climate.set_temperature', 'button.press'],
    missingCapabilities: [],
    notes: 'Sensibo AirQ AC and air quality monitor under Python sidecar',
  },
  meross_lan: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['switch', 'light', 'sensor'],
    supportedServices: ['switch.turn_on', 'switch.turn_off', 'light.turn_on'],
    missingCapabilities: [],
    notes: 'Local LAN multi-socket surge protector, outdoor plug, and light strip',
  },
  xiaomi_miot: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['switch', 'sensor', 'event'],
    supportedServices: ['switch.turn_on', 'switch.turn_off'],
    missingCapabilities: ['vacuum'],
    notes: 'Smart plugs, bathroom scales, and wireless rotary dimmer action events',
  },
  eero: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['device_tracker', 'sensor', 'switch', 'button', 'update'],
    supportedServices: ['switch.turn_on', 'switch.turn_off', 'button.press', 'update.install'],
    missingCapabilities: [],
    notes: 'Eero gateway router, mesh AP nodes, and user profile pause controls',
  },
  transmission: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['switch', 'sensor', 'event'],
    supportedServices: ['switch.turn_on', 'switch.turn_off'],
    missingCapabilities: [],
    notes: 'Transmission torrent state, bandwidth telemetry, and turtle mode',
  },
  speedtestdotnet: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['sensor'],
    supportedServices: [],
    missingCapabilities: [],
    notes: 'SpeedTest ping latency and bandwidth diagnostics',
  },
  openweathermap: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['weather', 'sensor'],
    supportedServices: [],
    missingCapabilities: [],
    notes: 'OpenWeatherMap weather conditions, temperature, humidity, and wind',
  },
  telegram_bot: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['notify', 'event'],
    supportedServices: ['notify.send_message'],
    missingCapabilities: [],
    notes: 'Telegram Bot notification dispatch and incoming webhook events',
  },
  hue: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:hacs',
    supportedEntities: ['light', 'scene', 'event'],
    supportedServices: ['light.turn_on', 'light.turn_off', 'scene.turn_on'],
    missingCapabilities: [],
    notes: 'Philips Hue bridge lights, scenes, and rotary events under Kitsune virtualizer',
  },
  tuya: {
    category: 'kitsune_hacs',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:native',
    supportedEntities: ['camera', 'switch', 'light'],
    supportedServices: ['camera.snapshot', 'camera.stream', 'switch.turn_on'],
    missingCapabilities: [],
    notes: 'Narnia Tuya camera and local bridge devices',
  },

  // Homebridge module integrations
  govee: {
    category: 'homebridge',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:homebridge',
    supportedEntities: ['light', 'switch', 'sensor'],
    supportedServices: ['light.turn_on', 'light.turn_off', 'switch.turn_on', 'switch.turn_off'],
    missingCapabilities: [],
    notes: '@homebridge-plugins/homebridge-govee with 13 household devices',
  },
  apple_tv: {
    category: 'homebridge',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:homebridge',
    supportedEntities: ['media_player', 'remote'],
    supportedServices: [
      'media_player.turn_on',
      'media_player.turn_off',
      'media_player.play_pause',
      'media_player.select_source',
      'remote.send_command',
    ],
    missingCapabilities: [],
    notes: 'homebridge-appletv-enhanced TV service, speaker, and remote keys',
  },

  // Scrypted camera module integrations
  reolink: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor', 'switch'],
    supportedServices: ['camera.snapshot', 'camera.stream', 'switch.turn_on'],
    missingCapabilities: [],
    notes: '@scrypted/reolink camera integration',
  },
  hikvision: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor'],
    supportedServices: ['camera.snapshot', 'camera.stream'],
    missingCapabilities: [],
    notes: '@scrypted/hikvision camera integration',
  },
  amcrest: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor'],
    supportedServices: ['camera.snapshot', 'camera.stream'],
    missingCapabilities: [],
    notes: '@scrypted/amcrest camera integration',
  },
  unifiprotect: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor', 'event'],
    supportedServices: ['camera.snapshot', 'camera.stream'],
    missingCapabilities: [],
    notes: '@scrypted/unifi-protect camera integration',
  },
  tapo: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor'],
    supportedServices: ['camera.snapshot', 'camera.stream'],
    missingCapabilities: [],
    notes: '@scrypted/tapo camera integration',
  },
  ring: {
    category: 'scrypted',
    runtimeStatus: 'executable',
    adapter: '@haus/kitsune:scrypted',
    supportedEntities: ['camera', 'sensor'],
    supportedServices: ['camera.snapshot', 'camera.stream'],
    missingCapabilities: [],
    notes: '@scrypted/ring camera integration',
  },
};

export function evaluateRuntimeCoverage(manifest: HaCatalogManifest): HaRuntimeCoverage {
  const profile = KNOWN_RUNTIME_PROFILES[manifest.domain];
  if (profile) {
    return {
      domain: manifest.domain,
      name: manifest.name,
      category: profile.category,
      runtimeStatus: profile.runtimeStatus,
      adapter: profile.adapter,
      supportedEntities: profile.supportedEntities,
      supportedServices: profile.supportedServices,
      missingCapabilities: profile.missingCapabilities,
      notes: profile.notes,
    };
  }

  // Fallback for catalog-only entries
  return {
    domain: manifest.domain,
    name: manifest.name,
    category: 'catalog_only',
    runtimeStatus: 'unsupported',
    adapter: 'none',
    supportedEntities: [],
    supportedServices: [],
    missingCapabilities: [
      manifest.config_flow ? 'config_flow_execution' : 'manual_configuration',
      ...manifest.requirements.map((req) => `py_dependency:${req.split('==')[0] ?? req}`),
    ],
    notes: 'Catalog manifest indexed; executable runtime adapter not active',
  };
}

export function summarizeRuntimeCoverage(
  manifests: Readonly<Record<string, HaCatalogManifest>>,
): HaCatalogCoverageSummary {
  let nativeHaus = 0;
  let kitsuneHacs = 0;
  let homebridge = 0;
  let scrypted = 0;
  let catalogOnly = 0;

  for (const manifest of Object.values(manifests)) {
    const coverage = evaluateRuntimeCoverage(manifest);
    switch (coverage.category) {
      case 'native_haus':
        nativeHaus++;
        break;
      case 'kitsune_hacs':
        kitsuneHacs++;
        break;
      case 'homebridge':
        homebridge++;
        break;
      case 'scrypted':
        scrypted++;
        break;
      case 'catalog_only':
        catalogOnly++;
        break;
    }
  }

  const total = Object.keys(manifests).length;
  const executable = nativeHaus + kitsuneHacs + homebridge + scrypted;
  const executableCoveragePercent = total > 0 ? (executable / total) * 100 : 0;

  return {
    totalCatalogIntegrations: total,
    nativeHausCount: nativeHaus,
    kitsuneHacsCount: kitsuneHacs,
    homebridgeCount: homebridge,
    scryptedCount: scrypted,
    catalogOnlyCount: catalogOnly,
    executableCoveragePercent: Number(executableCoveragePercent.toFixed(2)),
  };
}
