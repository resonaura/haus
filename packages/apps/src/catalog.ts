/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppManifest, AppSecretDeclaration } from './manifest.js';

export type AppCatalogCategory =
  'security' | 'media' | 'automation' | 'utility' | 'network' | 'bridge' | 'integration';

export type AppRuntimeType = 'docker' | 'hacs' | 'homebridge' | 'scrypted';

export interface AppCatalogVersion {
  readonly version: string;
  readonly manifest: AppManifest;
  readonly releaseNotes?: string;
  readonly publishedAt?: string;
}

export interface AppCatalogEntry {
  readonly manifest: AppManifest;
  readonly category: AppCatalogCategory;
  readonly runtimeType?: AppRuntimeType;
  readonly channel?: 'stable' | 'beta';
  readonly featured?: boolean;
  readonly documentationUrl?: string;
  readonly repositoryUrl?: string;
  readonly author?: string;
  readonly versions?: readonly AppCatalogVersion[];
}

export interface MarketplaceAppEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly category: AppCatalogCategory;
  readonly runtimeType: AppRuntimeType;
  readonly channel: 'stable' | 'beta';
  readonly featured: boolean;
  readonly documentationUrl?: string;
  readonly repositoryUrl?: string;
  readonly author?: string;
  readonly installed: boolean;
  readonly state?: 'running' | 'stopped' | 'attention';
  readonly currentVersion?: string;
  readonly latestVersion: string;
  readonly updateAvailable: boolean;
  readonly releaseNotes?: string;
}

export interface AppUpdateCheckResult {
  readonly updateAvailable: boolean;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly targetManifest?: AppManifest;
  readonly releaseNotes?: string;
}

export interface AppCatalogFilter {
  readonly category?: AppCatalogCategory;
  readonly runtimeType?: AppRuntimeType;
  readonly search?: string;
  readonly channel?: 'stable' | 'beta';
  readonly installed?: boolean;
}

function compareVersions(v1: string, v2: string): number {
  const p1 = v1
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const p2 = v2
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0;
    const b = p2[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export class AppCatalog {
  private readonly entries = new Map<string, AppCatalogEntry>();

  register(entry: AppCatalogEntry): void {
    if (!entry?.manifest?.id) throw new Error('invalid_catalog_entry');
    this.entries.set(entry.manifest.id, entry);
  }

  get(appId: string): AppCatalogEntry | undefined {
    return this.entries.get(appId);
  }

  list(filter?: AppCatalogFilter): readonly AppCatalogEntry[] {
    const all = Array.from(this.entries.values());
    return all.filter((entry) => {
      if (filter?.category && entry.category !== filter.category) return false;
      if (filter?.runtimeType && (entry.runtimeType ?? 'docker') !== filter.runtimeType)
        return false;
      if (filter?.channel && entry.channel && entry.channel !== filter.channel) return false;
      if (filter?.search) {
        const query = filter.search.toLowerCase();
        const matchesName = entry.manifest.name.toLowerCase().includes(query);
        const matchesId = entry.manifest.id.toLowerCase().includes(query);
        const matchesDesc = (entry.manifest.description ?? '').toLowerCase().includes(query);
        const matchesAuthor = (entry.author ?? '').toLowerCase().includes(query);
        if (!matchesName && !matchesId && !matchesDesc && !matchesAuthor) return false;
      }
      return true;
    });
  }

  checkUpdate(appId: string, currentVersion: string): AppUpdateCheckResult {
    const entry = this.entries.get(appId);
    if (!entry) {
      return { updateAvailable: false, currentVersion };
    }

    let latestVersion = entry.manifest.version;
    let targetManifest: AppManifest = entry.manifest;
    let releaseNotes: string | undefined;

    if (entry.versions && entry.versions.length > 0) {
      for (const v of entry.versions) {
        if (compareVersions(v.version, latestVersion) > 0) {
          latestVersion = v.version;
          targetManifest = v.manifest;
          releaseNotes = v.releaseNotes;
        }
      }
    }

    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    return {
      updateAvailable,
      currentVersion,
      latestVersion: updateAvailable ? latestVersion : undefined,
      targetManifest: updateAvailable ? targetManifest : undefined,
      releaseNotes: updateAvailable ? releaseNotes : undefined,
    };
  }

  toMarketplaceEntries(
    installed: ReadonlyMap<string, { manifest: AppManifest; state: 'running' | 'stopped' }>,
    filter?: AppCatalogFilter,
  ): readonly MarketplaceAppEntry[] {
    const results: MarketplaceAppEntry[] = [];
    const processedIds = new Set<string>();

    for (const entry of this.list(filter)) {
      processedIds.add(entry.manifest.id);
      const installedInfo = installed.get(entry.manifest.id);
      const isInstalled = Boolean(installedInfo);

      if (filter?.installed !== undefined && filter.installed !== isInstalled) {
        continue;
      }

      const updateCheck = isInstalled
        ? this.checkUpdate(entry.manifest.id, installedInfo!.manifest.version)
        : { updateAvailable: false, currentVersion: entry.manifest.version };

      let latestVersion = entry.manifest.version;
      let latestNotes: string | undefined;
      for (const v of entry.versions ?? []) {
        if (compareVersions(v.version, latestVersion) > 0) {
          latestVersion = v.version;
          latestNotes = v.releaseNotes;
        }
      }

      results.push({
        id: entry.manifest.id,
        name: entry.manifest.name,
        description: entry.manifest.description,
        category: entry.category,
        runtimeType: entry.runtimeType ?? 'docker',
        channel: entry.channel ?? 'stable',
        featured: Boolean(entry.featured),
        documentationUrl: entry.documentationUrl,
        repositoryUrl: entry.repositoryUrl,
        author: entry.author,
        installed: isInstalled,
        state: installedInfo?.state,
        currentVersion: installedInfo?.manifest.version,
        latestVersion,
        updateAvailable: updateCheck.updateAvailable,
        releaseNotes: updateCheck.releaseNotes ?? latestNotes,
      });
    }

    // Include installed apps not present in the catalog if filter permits
    if (filter?.installed !== false) {
      for (const [id, installedInfo] of installed) {
        if (processedIds.has(id)) continue;
        if (filter?.search) {
          const query = filter.search.toLowerCase();
          const matchesName = installedInfo.manifest.name.toLowerCase().includes(query);
          const matchesId = id.toLowerCase().includes(query);
          if (!matchesName && !matchesId) continue;
        }
        results.push({
          id,
          name: installedInfo.manifest.name,
          description: installedInfo.manifest.description,
          category: 'utility',
          runtimeType: 'docker',
          channel: 'stable',
          featured: false,
          installed: true,
          state: installedInfo.state,
          currentVersion: installedInfo.manifest.version,
          latestVersion: installedInfo.manifest.version,
          updateAvailable: false,
        });
      }
    }

    return results;
  }

  static createDefaultCatalog(): AppCatalog {
    const catalog = new AppCatalog();
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

    catalog.register({
      category: 'security',
      runtimeType: 'docker',
      featured: true,
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
      category: 'bridge',
      runtimeType: 'docker',
      featured: true,
      author: 'Haus Community',
      manifest: {
        id: 'govee2mqtt',
        name: 'Govee to MQTT',
        version: '2024.10.1',
        image: 'ghcr.io/haus-home/govee2mqtt:2024.10.1',
        description: 'Bridge Govee BLE and LAN devices to Haus MQTT broker.',
        architectures: ['amd64', 'arm64'],
        network: { mode: 'host' },
      },
    });

    catalog.register({
      category: 'network',
      runtimeType: 'docker',
      featured: true,
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
      category: 'integration',
      runtimeType: 'homebridge',
      featured: true,
      author: 'Haus',
      repositoryUrl: 'https://github.com/bwp91/homebridge-govee',
      manifest: {
        id: 'govee',
        name: 'Govee',
        version: '11.39.1',
        image: 'node:22-bookworm-slim',
        description:
          'Unified Govee integration: smart outlets via Homebridge Govee (LAN/BLE) and lights via Govee2MQTT.',
        architectures: ['amd64', 'arm64'],
        options: [
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
            description:
              'Route smart outlets to Homebridge Govee (LAN/BLE) and lights to Govee2MQTT.',
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
        ],
        secrets: goveeSecrets,
      },
    });

    catalog.register({
      category: 'bridge',
      runtimeType: 'homebridge',
      featured: true,
      author: 'bwp91',
      repositoryUrl: 'https://github.com/bwp91/homebridge-govee',
      manifest: {
        id: 'homebridge-govee',
        name: 'Homebridge Govee',
        version: '11.39.1',
        image: 'node:22-bookworm-slim',
        description: 'Homebridge plugin for Govee devices via LAN and BLE with full color control.',
        architectures: ['amd64', 'arm64'],
        options: [
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
            description:
              'Route smart outlets to Homebridge Govee and leave lights on Govee2MQTT when both run together.',
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
        ],
        secrets: goveeSecrets,
      },
    });

    catalog.register({
      category: 'media',
      runtimeType: 'homebridge',
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

    return catalog;
  }
}
