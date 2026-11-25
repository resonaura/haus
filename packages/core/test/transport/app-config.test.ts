/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  REDACTED_SECRET_PLACEHOLDER,
  buildDemoAppConfig,
  buildDemoAppRepositories,
  formatAddonRepositoryError,
  isGoveeAddon,
  isSecretConfigKey,
  mergeCatalogFieldMeta,
  parseAddonRepositories,
  parseAppConfigInfo,
  parseAppLogsPayload,
  parseCatalogAppsPayload,
  parseCatalogInstallPayload,
  parseConfigJsonObject,
} from '../../src/transport/index.js';

describe('@haus/core transport app-config contracts', () => {
  it('parses Hub catalog entries and logs payload shapes', () => {
    const fromEntries = parseCatalogAppsPayload({
      entries: [
        {
          id: 'matter-bridge',
          name: 'Matter Controller',
          category: 'matter',
          runtimeType: 'docker_app',
          installed: false,
          latestVersion: '1.5.0',
          updateAvailable: false,
          verified: true,
        },
      ],
    });
    expect(fromEntries).toHaveLength(1);
    expect(fromEntries[0]).toMatchObject({ id: 'matter-bridge', verified: true });

    const fromApps = parseCatalogAppsPayload({
      apps: [{ id: 'zigbee2mqtt', name: 'Zigbee2MQTT', installed: true }],
    });
    expect(fromApps[0]).toMatchObject({ id: 'zigbee2mqtt', installed: true });

    expect(parseAppLogsPayload('line 1')).toBe('line 1');
    expect(parseAppLogsPayload({ status: 'ok', data: { logs: 'line 2' } })).toBe('line 2');
    expect(parseAppLogsPayload({ logs: 'line 3' })).toBe('line 3');
    expect(parseAppLogsPayload({ data: 'line 4' })).toBe('line 4');
    expect(parseAppLogsPayload(null)).toBe('');
  });

  it('parses custom add-on repositories and maps repository error codes', () => {
    const repos = parseAddonRepositories({
      repositories: [
        {
          id: 'a1b2c3d4',
          url: 'https://github.com/example/addons#main',
          branch: 'main',
          name: 'Example Add-ons',
          maintainer: 'Example Team',
          infoUrl: 'https://github.com/example/addons',
          addonIds: ['a1b2c3d4-demo'],
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
        { bad: true },
      ],
    });
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      id: 'a1b2c3d4',
      branch: 'main',
      addonIds: ['a1b2c3d4-demo'],
    });

    expect(formatAddonRepositoryError(new Error('addon_repository_is_hacs_repo'))).toContain(
      'HACS',
    );
    expect(
      formatAddonRepositoryError('invalid_addon_repository_missing_repository_yaml'),
    ).toContain('repository.yaml');
    expect(formatAddonRepositoryError('addon_repository_already_exists')).toContain(
      'already added',
    );
    expect(formatAddonRepositoryError('addon_repository_in_use:slug1,slug2')).toContain(
      'slug1,slug2',
    );
    expect(formatAddonRepositoryError('unsupported_addon_repository_host')).toContain('GitHub');
    expect(formatAddonRepositoryError('invalid_addon_repository_url')).toContain('GitHub');
    expect(formatAddonRepositoryError('addon_repository_not_found')).toContain('not found');
    expect(formatAddonRepositoryError('github_rate_limited')).toContain('rate limit');
  });

  it('identifies secret keys, Govee add-ons, and native config payloads without mutating base metadata', () => {
    expect(isSecretConfigKey('mqtt_password')).toBe(true);
    expect(isSecretConfigKey('api_key')).toBe(true);
    expect(isSecretConfigKey('custom_val', { secret: true })).toBe(true);
    expect(isSecretConfigKey('channel')).toBe(false);

    expect(isGoveeAddon('govee')).toBe(true);
    expect(isGoveeAddon('homebridge-govee')).toBe(true);
    expect(isGoveeAddon('govee2mqtt')).toBe(true);
    expect(isGoveeAddon('custom-app', 'ghcr.io/foo/Govee-bridge:1')).toBe(true);
    expect(isGoveeAddon('zigbee2mqtt', 'ghcr.io/koenkk/zigbee2mqtt')).toBe(false);

    const parsed = parseAppConfigInfo({
      status: 'ok',
      data: {
        config: { channel: 20, mqtt_password: REDACTED_SECRET_PLACEHOLDER },
        configuredSecrets: ['mqtt_password'],
        nativeFields: { channel: { title: 'Radio channel', type: 'number' } },
        manifest: { image: 'ghcr.io/haus/zigbee2mqtt:2.1.3' },
      },
    });
    expect(parsed).toEqual({
      config: { channel: 20, mqtt_password: REDACTED_SECRET_PLACEHOLDER },
      configuredSecrets: ['mqtt_password'],
      nativeFields: { channel: { title: 'Radio channel', type: 'number' } },
      image: 'ghcr.io/haus/zigbee2mqtt:2.1.3',
    });

    const merged = mergeCatalogFieldMeta(parsed?.nativeFields, {
      entry: {
        manifest: {
          options: [
            { name: 'channel', description: 'Should not overwrite existing metadata' },
            { name: 'log_level', description: 'Log verbosity', choices: ['info', 'debug'] },
          ],
          secrets: [{ name: 'api_token', description: 'Optional token' }],
        },
      },
    });
    expect(merged.channel).toEqual({ title: 'Radio channel', type: 'number' });
    expect(merged.log_level).toEqual({
      description: 'Log verbosity',
      choices: ['info', 'debug'],
    });
    expect(merged.api_token).toEqual({ description: 'Optional token', secret: true });
  });

  it('extracts manifest install payloads, JSON config objects, and demo fixtures', () => {
    const installPayload = parseCatalogInstallPayload({
      entry: {
        manifest: {
          id: 'aqara-cameras',
          name: 'Aqara Cameras',
          mounts: [{ target: 'media' }, { target: 'data' }],
          network: { mode: 'host' },
          ports: [{ hostPort: 80 }],
          devices: [{ type: 'video' }],
          ingress: { enabled: true },
          permissions: ['custom:perm', { type: 'optional:perm', optional: true }],
        },
      },
    });
    expect(installPayload?.manifest.id).toBe('aqara-cameras');
    expect(installPayload?.grantedPermissions).toEqual([
      'mount:media',
      'network:host',
      'port:privileged',
      'device:video',
      'ingress',
      'custom:perm',
    ]);

    expect(parseConfigJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseConfigJsonObject('[1,2]')).toEqual({
      ok: false,
      error: 'Configuration must be a JSON object.',
    });
    expect(parseConfigJsonObject('{bad')).toEqual({
      ok: false,
      error: 'Configuration must be valid JSON.',
    });

    expect(buildDemoAppRepositories()[0]?.addonIds).toContain('9f3c1e2a-thread-border');
    expect(buildDemoAppConfig('zigbee2mqtt').configuredSecrets).toContain('mqtt_password');
  });
});
