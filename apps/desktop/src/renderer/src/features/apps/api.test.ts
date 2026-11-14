/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { describe, expect, it } from 'vitest';
import { parseApps } from './api';
import {
  initialConfigFromManifest,
  parseCatalog,
  parseCatalogDetail,
  parseInstallProgress,
  parseUpdateCheck,
  requiredManifestPermissions,
  sanitizeOptionsSubmission,
} from './catalog-api';

describe('Hub Apps API parsers & helpers', () => {
  it('extracts source.externalId alongside resolved App id in parseApps', () => {
    const parsed = parseApps({
      drivers: [{ id: 'standalone-local', capabilities: { logs: true } }],
      apps: [
        {
          id: 'app-ulid-1',
          name: 'Aqara Camera Bridge',
          version: '1.2.0',
          state: 'running',
          available: true,
          managed: true,
          actions: ['stop', 'restart'],
          source: { instanceId: 'standalone-local', externalId: 'aqara-cameras' },
        },
      ],
    });
    expect(parsed).toEqual([
      {
        id: 'app-ulid-1',
        externalId: 'aqara-cameras',
        name: 'Aqara Camera Bridge',
        version: '1.2.0',
        state: 'running',
        available: true,
        managed: true,
        actions: ['stop', 'restart'],
        logs: true,
      },
    ]);
  });

  it('parses marketplace catalog entries and full catalog detail manifests', () => {
    const entries = parseCatalog({
      entries: [
        {
          id: 'govee',
          name: 'Govee',
          description: 'Unified Govee integration',
          category: 'integration',
          runtimeType: 'homebridge',
          channel: 'stable',
          featured: true,
          author: 'Haus',
          installed: true,
          state: 'running',
          currentVersion: '11.39.0',
          latestVersion: '11.39.1',
          updateAvailable: true,
          releaseNotes: 'Fix LAN retries',
        },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'govee',
      installed: true,
      updateAvailable: true,
      latestVersion: '11.39.1',
    });

    const detail = parseCatalogDetail({
      entry: {
        category: 'security',
        runtimeType: 'docker',
        author: 'Resonaura',
        manifest: {
          id: 'tuya-rtsp-bridge',
          name: 'Tuya Camera Bridge',
          version: '2.2.12',
          image: 'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
          architectures: ['amd64', 'arm64'],
          network: { mode: 'host' },
          ports: [{ containerPort: 80, hostPort: 80, protocol: 'tcp' }],
          mounts: [
            { target: 'data', containerPath: '/data' },
            { target: 'media', containerPath: '/media' },
          ],
          devices: [{ type: 'video', hostPath: '/dev/video0' }],
          ingress: { enabled: true, port: 8080 },
          options: [
            { name: 'region', type: 'select', choices: ['us', 'eu'], default: 'us' },
            { name: 'debug', type: 'boolean', default: false },
          ],
          secrets: [{ name: 'password', required: false }],
        },
      },
    });

    expect(requiredManifestPermissions(detail.manifest)).toEqual([
      'mount:media',
      'network:host',
      'port:privileged',
      'device:video',
      'ingress',
    ]);
    expect(initialConfigFromManifest(detail.manifest)).toEqual({
      region: 'us',
      debug: false,
    });
    expect(
      sanitizeOptionsSubmission(detail.manifest, {
        region: ' eu ',
        debug: true,
        password: '  ',
      }),
    ).toEqual({
      region: 'eu',
      debug: true,
    });
  });

  it('parses update checks including required permissions and install progress stages', () => {
    const update = parseUpdateCheck({
      updateAvailable: true,
      currentVersion: '1.2.0',
      latestVersion: '1.3.0',
      releaseNotes: 'Low latency',
      targetManifest: {
        id: 'aqara-cameras',
        name: 'Aqara Camera Bridge',
        version: '1.3.0',
        image: 'ghcr.io/haus-home/aqara-cameras:1.3.0',
        architectures: ['amd64', 'arm64'],
        network: { mode: 'host' },
      },
    });
    expect(update).toEqual({
      updateAvailable: true,
      currentVersion: '1.2.0',
      latestVersion: '1.3.0',
      releaseNotes: 'Low latency',
      requiredPermissions: ['network:host'],
    });
    expect(
      parseInstallProgress({
        appId: 'aqara-cameras',
        stage: 'pulling',
        current: 1,
        total: 3,
      }),
    ).toEqual({
      appId: 'aqara-cameras',
      stage: 'pulling',
      current: 1,
      total: 3,
    });
  });
});
