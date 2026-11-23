/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  AppCatalog,
  fetchAndScanAddonRepository,
  getAddonRepositoryHash,
  parseAddonRepositoryUrl,
  parseHaConfigDocument,
} from '../src/index.js';

describe('HA Supervisor custom add-on repositories', () => {
  it('computes the exact 8-char SHA-1 repository slug and parses optional #branch', () => {
    const parsed = parseAddonRepositoryUrl('https://github.com/hassio-addons/repository.git#beta');
    expect(parsed.gitUrl).toBe('https://github.com/hassio-addons/repository');
    expect(parsed.sourceUrl).toBe('https://github.com/hassio-addons/repository#beta');
    expect(parsed.branch).toBe('beta');
    expect(parsed.id).toBe(
      getAddonRepositoryHash('https://github.com/hassio-addons/repository#beta'),
    );
    expect(parsed.id).toMatch(/^[a-f0-9]{8}$/);

    expect(() => parseAddonRepositoryUrl('https://evil.example/owner/repo')).toThrow(
      'unsupported_addon_repository_host',
    );
    expect(() => parseAddonRepositoryUrl('not a url')).toThrow('invalid_addon_repository_url');
  });

  it('parses HA repository.yaml and complex add-on config.yaml files', () => {
    const doc = parseHaConfigDocument(
      [
        'name: "Demo Bridge"',
        'slug: demo_bridge',
        'version: "1.4.2"',
        'description: Local demo bridge',
        'arch:',
        '  - aarch64',
        '  - amd64',
        'ports:',
        '  8080/tcp: 8080',
        'map:',
        '  - share:ro',
        '  - config:rw',
        'options:',
        '  log_level: info',
        '  enable_ble: true',
        'schema:',
        '  log_level: list(debug|info|warning)',
        '  api_token: password',
        '  enable_ble: bool?',
      ].join('\n'),
      'demo/config.yaml',
    );
    expect(doc.name).toBe('Demo Bridge');
    expect(doc.version).toBe('1.4.2');
    expect(doc.arch).toEqual(['aarch64', 'amd64']);
    expect(doc.ports).toEqual({ '8080/tcp': 8080 });
    expect(doc.options).toEqual({ log_level: 'info', enable_ble: true });
    expect(doc.schema).toEqual({
      log_level: 'list(debug|info|warning)',
      api_token: 'password',
      enable_ble: 'bool?',
    });
  });

  it('scans a Supervisor repository, resolves image/{arch}, Dockerfile builds, options, secrets, and skips rootfs', async () => {
    const commitSha = 'a'.repeat(40);
    const fetchMock = (async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/resonaura/custom-addons') {
        return new Response(JSON.stringify({ default_branch: 'main', archived: false }), {
          status: 200,
        });
      }
      if (
        url === 'https://api.github.com/repos/resonaura/custom-addons/git/trees/main?recursive=1'
      ) {
        return new Response(
          JSON.stringify({
            sha: commitSha,
            tree: [
              { path: 'repository.yaml', type: 'blob' },
              { path: 'mqtt_bridge/config.yaml', type: 'blob' },
              { path: 'mqtt_bridge/rootfs/config.yaml', type: 'blob' },
              { path: 'local_builder/config.json', type: 'blob' },
              { path: 'local_builder/Dockerfile', type: 'blob' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/repository.yaml')) {
        return new Response(
          'name: "Resonaura Custom Add-ons"\nurl: https://github.com/resonaura/custom-addons\nmaintainer: Resonaura\n',
          { status: 200 },
        );
      }
      if (url.endsWith('/mqtt_bridge/config.yaml')) {
        return new Response(
          [
            'name: "MQTT Sensor Bridge"',
            'slug: mqtt_bridge',
            'version: "2.1.0"',
            'description: Bridges custom sensors to MQTT',
            'image: ghcr.io/resonaura/mqtt-bridge-{arch}',
            'arch:',
            '  - amd64',
            '  - aarch64',
            'host_network: true',
            'ingress: true',
            'ingress_port: 8099',
            'services:',
            '  - mqtt:want',
            'map:',
            '  - share:ro',
            'options:',
            '  mode: fast',
            '  interval: 30',
            'schema:',
            '  mode: list(fast|balanced|eco)',
            '  interval: int(5,300)',
            '  token: password',
          ].join('\n'),
          { status: 200 },
        );
      }
      if (url.endsWith('/local_builder/config.json')) {
        return new Response(
          JSON.stringify({
            name: 'Local Builder App',
            slug: 'local_builder',
            version: '0.5.0',
            description: 'Built from Dockerfile',
            arch: ['amd64', 'aarch64'],
            ports: { '9000/tcp': 9000 },
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const scanned = await fetchAndScanAddonRepository(
      'https://github.com/resonaura/custom-addons',
      {
        fetchFn: fetchMock,
      },
    );

    expect(scanned.repository.name).toBe('Resonaura Custom Add-ons');
    expect(scanned.repository.maintainer).toBe('Resonaura');
    expect(scanned.repository.branch).toBe('main');
    expect(scanned.entries).toHaveLength(2);

    const bridge = scanned.entries.find((e) => e.manifest.name === 'MQTT Sensor Bridge');
    expect(bridge).toBeDefined();
    expect(bridge?.customRepository).toBe(true);
    expect(bridge?.repositoryId).toBe(scanned.repository.id);
    expect(bridge?.addonConfigPath).toBe('mqtt_bridge/config.yaml');
    expect(bridge?.manifest.network?.mode).toBe('host');
    expect(bridge?.manifest.ingress).toEqual({ enabled: true, port: 8099, slug: 'mqtt_bridge' });
    expect(bridge?.manifest.services).toEqual(['mqtt:want']);
    expect(bridge?.manifest.image).toMatch(
      /^ghcr\.io\/resonaura\/mqtt-bridge-(amd64|aarch64|arm64|armv7|i386):2\.1\.0$/,
    );
    expect(bridge?.manifest.secrets).toEqual([{ name: 'token', required: true }]);
    expect(bridge?.manifest.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'mode',
          type: 'select',
          choices: ['fast', 'balanced', 'eco'],
          default: 'fast',
        }),
        expect.objectContaining({ name: 'interval', type: 'number', default: 30 }),
      ]),
    );

    const builder = scanned.entries.find((e) => e.manifest.name === 'Local Builder App');
    expect(builder).toBeDefined();
    expect(builder?.manifest.build).toEqual({
      repository: 'https://github.com/resonaura/custom-addons',
      commit: commitSha,
      context: 'local_builder',
      dockerfile: 'Dockerfile',
    });

    const catalog = new AppCatalog();
    for (const entry of scanned.entries) catalog.register(entry);
    expect(catalog.list()).toHaveLength(2);
    expect(catalog.unregisterByRepositoryId(scanned.repository.id)).toBe(2);
    expect(catalog.list()).toHaveLength(0);
  });

  it('detects when a user mistakenly adds a HACS repository as an Add-on repository', async () => {
    const fetchMock = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/al-one/hass-xiaomi-miot')) {
        return new Response(JSON.stringify({ default_branch: 'master' }), { status: 200 });
      }
      if (url.includes('/git/trees/master')) {
        return new Response(
          JSON.stringify({
            sha: 'b'.repeat(40),
            tree: [
              { path: 'hacs.json', type: 'blob' },
              { path: 'custom_components/xiaomi_miot/manifest.json', type: 'blob' },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    await expect(
      fetchAndScanAddonRepository('https://github.com/al-one/hass-xiaomi-miot', {
        fetchFn: fetchMock,
      }),
    ).rejects.toThrow('addon_repository_is_hacs_repo');
  });
});
