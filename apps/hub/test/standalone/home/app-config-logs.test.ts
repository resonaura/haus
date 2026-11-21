/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Apps, type AppManifest, type DockerAppLifecycle } from '@haus/apps';
import { Identities } from '@haus/core/types';
import { createStandaloneAppDriver, type InstalledAppEntry } from '../../../src/home/app-driver.js';
import {
  REDACTED_SECRET_PLACEHOLDER,
  readHomebridgeConfigSchema,
} from '../../../src/home/apps/config.js';
import { AppLogBuffer } from '../../../src/home/apps/log-buffer.js';
import { streamInstalledAppLogs } from '../../../src/home/apps/log-stream.js';
import { AppOptions } from '../../../src/home/options.js';

describe('Native add-on configuration preservation, secret redaction, and live logs', () => {
  it('returns real native options.json with redacted secrets and preserves Govee native keys on save', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-native-config-'));
    try {
      const options = new AppOptions(root);
      const nativeGoveeConfig = {
        name: 'Govee',
        username: 'user@example.com',
        password: 'super-secret-password',
        ignoreMatter: true,
        awsDisable: false,
        bleDisable: false,
        lanDisable: true,
        colourSafeMode: false,
        disableDeviceLogging: false,
        lightDevices: [
          { label: 'Living Room Lamp', deviceId: '0A:A3:60:74:F4:EE:EF:30', ignoreDevice: true },
        ],
        platform: 'Govee',
      };
      options.save('homebridge-govee', nativeGoveeConfig);

      const manifest: AppManifest = {
        id: 'homebridge-govee',
        name: 'Homebridge Govee',
        version: '11.39.1',
        image: 'node:22-bookworm-slim',
        architectures: ['amd64', 'arm64'],
      };
      const installedApps = new Map<string, InstalledAppEntry>([
        [
          'homebridge-govee',
          {
            manifest,
            state: 'running',
            logs: [],
            config: {},
          },
        ],
      ]);

      const apps = new Apps(
        new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
        { authorize: async () => true },
      );
      apps.register(createStandaloneAppDriver(installedApps, undefined, options));

      const inv = await apps.list('admin');
      const app = inv.apps[0]!;
      const infoRes = await apps.operate('admin', app.id, 'info');

      expect(infoRes.status).toBe('ok');
      const infoData = infoRes.data as {
        config: Record<string, unknown>;
        configuredSecrets: string[];
      };
      expect(infoData.configuredSecrets).toEqual(['password']);
      expect(infoData.config.password).toBe(REDACTED_SECRET_PLACEHOLDER);
      expect(infoData.config.lanDisable).toBe(true);
      expect(infoData.config.ignoreMatter).toBe(true);
      expect(infoData.config.lightDevices).toEqual(nativeGoveeConfig.lightDevices);

      // Save full native JSON editing colourSafeMode while keeping password unchanged.
      const saveRes = await apps.operate('admin', app.id, 'configure', {
        __hausReplace: true,
        values: {
          ...infoData.config,
          colourSafeMode: true,
        },
      });
      expect(saveRes.status).toBe('ok');

      const onDisk = JSON.parse(
        readFileSync(join(root, 'homebridge-govee', 'data', 'options.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(onDisk.password).toBe('super-secret-password');
      expect(onDisk.colourSafeMode).toBe(true);
      expect(onDisk.lanDisable).toBe(true);
      expect(onDisk.lightDevices).toEqual(nativeGoveeConfig.lightDevices);
      expect(onDisk).not.toHaveProperty('__hausReplace');
      expect(onDisk).not.toHaveProperty('hybridSplit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves nested secrets (such as haus-kettle mqtt.password) across JSON edits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-nested-secret-'));
    try {
      const options = new AppOptions(root);
      const kettleConfig = {
        name: 'Kitchen Kettle',
        host: '192.168.5.92',
        token: 'kettle-secret-token',
        read_only: false,
        mqtt: { host: '127.0.0.1', port: 1883, username: 'mqtt', password: 'mqtt-secret-password' },
      };
      options.save('haus-kettle', kettleConfig);

      const installedApps = new Map<string, InstalledAppEntry>([
        [
          'haus-kettle',
          {
            manifest: {
              id: 'haus-kettle',
              name: 'Haus Kettle',
              version: '0.1.5',
              image: 'ghcr.io/resonaura/haus-kettle-aarch64:0.1.5',
              architectures: ['arm64'],
            },
            state: 'running',
            logs: [],
            config: kettleConfig,
          },
        ],
      ]);

      const apps = new Apps(
        new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
        { authorize: async () => true },
      );
      apps.register(createStandaloneAppDriver(installedApps, undefined, options));
      const app = (await apps.list('admin')).apps[0]!;

      const info = (await apps.operate('admin', app.id, 'info')).data as {
        config: { mqtt: Record<string, unknown>; token: string; read_only: boolean };
        configuredSecrets: string[];
      };
      expect(info.configuredSecrets).toEqual(['token', 'mqtt.password']);
      expect(info.config.token).toBe(REDACTED_SECRET_PLACEHOLDER);
      expect(info.config.mqtt.password).toBe(REDACTED_SECRET_PLACEHOLDER);

      await apps.operate('admin', app.id, 'configure', {
        __hausReplace: true,
        values: { ...info.config, read_only: true },
      });

      const saved = JSON.parse(
        readFileSync(join(root, 'haus-kettle', 'data', 'options.json'), 'utf8'),
      ) as { token: string; read_only: boolean; mqtt: { password: string } };
      expect(saved.token).toBe('kettle-secret-token');
      expect(saved.mqtt.password).toBe('mqtt-secret-password');
      expect(saved.read_only).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads native Homebridge config.schema.json field metadata from plugin directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haus-hb-schema-'));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'config.schema.json'),
        JSON.stringify({
          pluginAlias: 'Govee',
          schema: {
            type: 'object',
            properties: {
              ignoreMatter: { type: 'boolean', title: 'Ignore Matter', description: 'Skip Matter devices' },
              lightDevices: { type: 'array', title: 'Light Devices' },
              password: { type: 'string', title: 'Password' },
            },
          },
        }),
      );
      const fields = readHomebridgeConfigSchema(dir);
      expect(fields?.ignoreMatter).toEqual({
        title: 'Ignore Matter',
        description: 'Skip Matter devices',
        type: 'boolean',
      });
      expect(fields?.lightDevices?.type).toBe('array');
      expect(fields?.password?.secret).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fetches real Docker container logs on operate("logs") and streams live bridge/Docker logs', async () => {
    const containerId = 'c'.repeat(64);
    const lifecycle = {
      logs: vi.fn().mockResolvedValue(['2026-11-21T10:00:00Z Camera ready']),
      streamLogs: vi.fn(async (_id, _opts, onLine: (l: string) => void) => {
        onLine('2026-11-21T10:00:01Z Stream frame 1');
        onLine('2026-11-21T10:00:02Z Stream frame 2');
      }),
    } as unknown as DockerAppLifecycle;

    const entry: InstalledAppEntry = {
      manifest: {
        id: 'aqara-g5pro',
        name: 'Aqara G5 Pro',
        version: '1.6.41',
        image: 'ghcr.io/resonaura/aqara-g5pro-mqtt/aarch64:1.6.41',
        architectures: ['arm64'],
      },
      state: 'running',
      logs: ['[init] App start'],
      config: {},
      containerId,
    };

    const installedApps = new Map<string, InstalledAppEntry>([['aqara-g5pro', entry]]);
    const apps = new Apps(
      new Identities({ get: (s) => s.externalId, putIfAbsent: (s) => s.externalId }, () => '1'),
      { authorize: async () => true },
    );
    apps.register(createStandaloneAppDriver(installedApps, lifecycle));
    const app = (await apps.list('admin')).apps[0]!;

    const res = await apps.operate('admin', app.id, 'logs');
    expect(res.status).toBe('ok');
    expect((res.data as { lines: string[] }).lines).toEqual(['2026-11-21T10:00:00Z Camera ready']);

    const dockerStreamed: string[] = [];
    await streamInstalledAppLogs({
      entry,
      lifecycle,
      tail: 100,
      onLine: (line) => dockerStreamed.push(line),
      signal: new AbortController().signal,
    });
    expect(dockerStreamed).toEqual([
      '2026-11-21T10:00:01Z Stream frame 1',
      '2026-11-21T10:00:02Z Stream frame 2',
    ]);

    const buffer = new AppLogBuffer(50);
    buffer.append('homebridge-govee', 'buffered line');
    const bridgeStreamed: string[] = [];
    const abort = new AbortController();
    const bridgePromise = streamInstalledAppLogs({
      entry: { ...entry, manifest: { ...entry.manifest, id: 'homebridge-govee' }, logs: [] },
      bridge: {
        supports: () => true,
        install: async () => ({}),
        execute: async () => undefined,
        getLogs: (id) => buffer.get(id),
        subscribeLogs: (id, cb) => buffer.subscribe(id, cb),
      },
      tail: 50,
      onLine: (line) => {
        bridgeStreamed.push(line);
        if (bridgeStreamed.length >= 2) abort.abort();
      },
      signal: abort.signal,
    });
    buffer.append('homebridge-govee', 'live bridge line');
    await bridgePromise;
    expect(bridgeStreamed).toEqual(['buffered line', 'live bridge line']);
  });
});
