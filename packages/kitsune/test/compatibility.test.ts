/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 only; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-only.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { parseAddress } from '@haus/core/identity';
import {
  KitsuneCompatibilityEngine,
  PluginSecretVault,
  COMPATIBILITY_MATRIX,
  HomebridgeVirtualApi,
  HomebridgeChildBridge,
  HacsVirtualizer,
  PythonSidecarHarness,
  SupervisorApiServer,
  MockAccessory,
  MockService,
  HAPServices,
} from '../dist/index.js';

describe('Kitsune Consolidated Compatibility Engine (P16.2)', () => {
  it('exposes explicit compatibility matrix for Scrypted, Homebridge, HACS, and Supervisor', () => {
    assert.equal(COMPATIBILITY_MATRIX.length, 4);
    const runtimes = COMPATIBILITY_MATRIX.map((entry) => entry.runtime);
    assert.deepEqual(runtimes, ['scrypted', 'homebridge', 'hacs', 'supervisor']);
    for (const entry of COMPATIBILITY_MATRIX) {
      assert.ok(entry.supported.length > 0);
      assert.ok(entry.unsupported.length > 0);
      assert.equal(entry.secretIsolation, 'per_plugin_vault_and_sanitized_env');
      assert.equal(entry.sessionOwnership, 'single_owner_monotonic_epoch');
    }
  });

  it('enforces single-owner session leases, restart epoch increments, and stale epoch fencing', async () => {
    const engine = new KitsuneCompatibilityEngine({ maxAdapters: 4, maxDevicesPerPlugin: 4 });
    const lease1 = engine.acquireSession('scrypted', '@scrypted/hikvision', 'worker-a');
    assert.equal(lease1.epoch, 1);
    assert.equal(lease1.status, 'active');

    // Concurrent second owner is rejected
    assert.throws(
      () => engine.acquireSession('scrypted', '@scrypted/hikvision', 'worker-b'),
      /kitsune_session_conflict/,
    );

    // Restart increments epoch monotonically and fences epoch 1
    const lease2 = engine.restartSession('scrypted', '@scrypted/hikvision', 'worker-a');
    assert.equal(lease2.epoch, 2);

    assert.throws(
      () =>
        engine.registerScryptedDevice('@scrypted/hikvision', 'worker-a', 1, {
          id: 'cam-stale',
          name: 'Stale Camera',
          interfaces: ['VideoCamera'],
          state: { online: true },
        }),
      /kitsune_stale_session_epoch/,
    );

    const activeDev = engine.registerScryptedDevice(
      '@scrypted/hikvision',
      'worker-a',
      2,
      {
        id: 'cam-1',
        name: 'Driveway Camera',
        interfaces: ['VideoCamera', 'MotionSensor', 'Brightness', 'Lock', 'Entry', 'Thermometer'],
        state: {
          online: true,
          motionDetected: true,
          on: true,
          brightness: 75,
          locked: true,
          entryOpen: false,
          temperature: 21.5,
        },
      },
      {
        call: async (method, args, deviceId) => ({ method, args, deviceId }),
      },
    );

    assert.equal(activeDev.endpoints.length, 6);
    const lockCmd = await engine.executeCommand('scrypted', '@scrypted/hikvision', 'worker-a', 2, {
      deviceId: activeDev.id,
      endpointId: 'lock',
      capability: 'lock',
      value: 'unlocked',
    });
    assert.deepEqual(lockCmd, { method: 'unlock', args: [], deviceId: 'cam-1' });

    // Release session and allow new owner takeover at epoch 3
    const released = engine.releaseSession('scrypted', '@scrypted/hikvision', 'worker-a');
    assert.equal(released.status, 'released');

    const lease3 = engine.acquireSession('scrypted', '@scrypted/hikvision', 'worker-b');
    assert.equal(lease3.epoch, 3);
    assert.equal(lease3.ownerId, 'worker-b');
  });

  it('enforces bounded adapter and per-plugin device limits', () => {
    const engine = new KitsuneCompatibilityEngine({ maxAdapters: 1, maxDevicesPerPlugin: 2 });
    const lease = engine.acquireSession('scrypted', '@scrypted/ring', 'owner-1');

    assert.throws(
      () => engine.acquireSession('homebridge', 'homebridge-hue', 'owner-1'),
      /kitsune_adapter_limit_exceeded/,
    );

    engine.registerScryptedDevice('@scrypted/ring', 'owner-1', lease.epoch, {
      id: 'd1',
      name: 'Dev 1',
      interfaces: ['OnOff'],
      state: { on: true },
    });
    engine.registerScryptedDevice('@scrypted/ring', 'owner-1', lease.epoch, {
      id: 'd2',
      name: 'Dev 2',
      interfaces: ['OnOff'],
      state: { on: false },
    });

    assert.throws(
      () =>
        engine.registerScryptedDevice('@scrypted/ring', 'owner-1', lease.epoch, {
          id: 'd3',
          name: 'Dev 3',
          interfaces: ['OnOff'],
          state: { on: false },
        }),
      /kitsune_device_limit_exceeded/,
    );
  });

  it(
    'reports unsupported capabilities clearly across Scrypted, Homebridge, and HACS without fabricating fake endpoints',
    { timeout: 20000 },
    async () => {
      const engine = new KitsuneCompatibilityEngine();

      // 1. Scrypted with unsupported PanTiltZoom & ObjectDetection
      const scryptedLease = engine.acquireSession('scrypted', '@scrypted/amcrest', 'owner-1');
      const scryptedDev = engine.registerScryptedDevice(
        '@scrypted/amcrest',
        'owner-1',
        scryptedLease.epoch,
        {
          id: 'ptz-cam',
          name: 'PTZ Camera',
          interfaces: ['VideoCamera', 'PanTiltZoom', 'ObjectDetection'],
          state: { online: true },
        },
        { call: async () => ({ ok: true }) },
      );
      assert.equal(scryptedDev.endpoints.length, 1);
      assert.equal(scryptedDev.endpoints[0]?.id, 'camera');

      await assert.rejects(
        () =>
          engine.executeCommand('scrypted', '@scrypted/amcrest', 'owner-1', scryptedLease.epoch, {
            deviceId: scryptedDev.id,
            endpointId: 'camera',
            capability: 'pan_tilt_zoom',
            value: { pan: 10 },
          }),
        /kitsune_unsupported_capability:pan_tilt_zoom/,
      );

      // 2. Homebridge with supported WindowCovering + unsupported AirPurifier service
      const hbLease = engine.acquireSession('homebridge', 'homebridge-bravia', 'owner-1');
      const hbApi = new HomebridgeVirtualApi();
      engine.attachHomebridgeApi('homebridge-bravia', 'owner-1', hbLease.epoch, hbApi);

      const acc = new MockAccessory('Living Room Media', 'uuid-tv-1');
      const blindService = acc.addService(new HAPServices.WindowCovering('Living Room Shade'));
      blindService.getCharacteristic('CurrentPosition').updateValue(50);
      blindService.getCharacteristic('TargetPosition').updateValue(50);
      const unsupportedAirPurifierService = new MockService(
        'AirPurifier',
        '000000BB-0000-1000-8000-0026BB765291',
      );
      acc.addService(unsupportedAirPurifierService);

      hbApi.publishExternalAccessories('homebridge-bravia', [acc]);
      const hbDevices = engine.getDevices('homebridge', 'homebridge-bravia');
      assert.equal(hbDevices.length, 1);
      const hbDevice = hbDevices[0];
      assert.ok(hbDevice);
      // Only the supported WindowCovering endpoint is created, not a fake endpoint for AirPurifier
      assert.equal(hbDevice.endpoints.length, 1);
      const hbEndpoint = hbDevice.endpoints[0];
      assert.ok(hbEndpoint);
      assert.equal(hbEndpoint.capabilities[0]?.kind, 'cover');

      await engine.executeCommand('homebridge', 'homebridge-bravia', 'owner-1', hbLease.epoch, {
        deviceId: hbDevice.id,
        endpointId: hbEndpoint.id,
        capability: 'cover',
        value: 100,
      });
      assert.equal(blindService.getCharacteristic('TargetPosition').getValue(), 100);

      await assert.rejects(
        () =>
          engine.executeCommand('homebridge', 'homebridge-bravia', 'owner-1', hbLease.epoch, {
            deviceId: hbDevice.id,
            endpointId: hbEndpoint.id,
            capability: 'remote_key',
            value: 'PLAY',
          }),
        /kitsune_unsupported_capability:remote_key/,
      );

      // 3. HACS with supported cover + unsupported vacuum domain
      const hacsLease = engine.acquireSession('hacs', 'roborock', 'owner-1');
      const virtualizer = new HacsVirtualizer();
      await virtualizer.start();
      try {
        engine.attachHacsVirtualizer('roborock', 'owner-1', hacsLease.epoch, virtualizer);

        await virtualizer.sidecar.registerEntity({
          entityId: 'vacuum.downstairs',
          domain: 'vacuum',
          name: 'Downstairs Vacuum',
          state: 'docked',
          attributes: {},
        });
        await virtualizer.sidecar.registerEntity({
          entityId: 'cover.garage_door',
          domain: 'cover',
          name: 'Garage Door',
          state: 'open',
          attributes: { current_position: 80 },
        });

        const hacsDevices = engine.getDevices('hacs', 'roborock');
        assert.equal(hacsDevices.length, 1);
        const hacsDevice = hacsDevices[0];
        assert.ok(hacsDevice);
        assert.equal(hacsDevice.endpoints[0]?.id, 'cover.garage_door');
        assert.equal(hacsDevice.endpoints[0]?.readings.cover?.value, 80);

        await assert.rejects(
          () =>
            engine.executeCommand('hacs', 'roborock', 'owner-1', hacsLease.epoch, {
              deviceId: hacsDevice.id,
              endpointId: 'cover.garage_door',
              capability: 'locate_vacuum',
              value: true,
            }),
          /kitsune_unsupported_capability:locate_vacuum/,
        );
      } finally {
        await virtualizer.stop();
      }

      const unsupported = engine.getUnsupportedCapabilities();
      assert.ok(
        unsupported.some((u) => u.runtime === 'scrypted' && u.capability === 'PanTiltZoom'),
      );
      assert.ok(
        unsupported.some((u) => u.runtime === 'scrypted' && u.capability === 'ObjectDetection'),
      );
      assert.ok(
        unsupported.some((u) => u.runtime === 'homebridge' && u.capability === 'AirPurifier'),
      );
      assert.ok(unsupported.some((u) => u.runtime === 'hacs' && u.capability === 'vacuum'));

      for (const dev of engine.getDevices()) {
        for (const ep of dev.endpoints) {
          assert.ok(
            ep.address && parseAddress(ep.address),
            `Endpoint address must be valid: ${String(ep.address)}`,
          );
        }
      }
    },
  );

  it('isolates plugin secrets, redacts diagnostics, and strips host secrets from child process environments', () => {
    const vault = new PluginSecretVault();
    vault.setSecret('scrypted', '@scrypted/ring', 'refreshToken', 'ring-super-secret-token-999');
    vault.setSecret('homebridge', 'homebridge-nest', 'accessToken', 'nest-private-token-888');

    assert.equal(
      vault.getSecret('scrypted', '@scrypted/ring', '@scrypted/ring', 'refreshToken'),
      'ring-super-secret-token-999',
    );
    assert.throws(
      () => vault.getSecret('scrypted', '@scrypted/amcrest', '@scrypted/ring', 'refreshToken'),
      /kitsune_secret_access_denied/,
    );

    const engine = new KitsuneCompatibilityEngine({ secretVault: vault });
    engine.recordDiagnostic(
      '@scrypted/ring',
      'error',
      'auth failed with ring-super-secret-token-999',
      {
        refreshToken: 'ring-super-secret-token-999',
        HAUS_API_TOKEN: 'host-token-123',
        statusCode: 401,
      },
    );
    const diags = engine.getDiagnostics('@scrypted/ring');
    assert.equal(diags.length, 1);
    const firstDiag = diags[0];
    assert.ok(firstDiag && firstDiag.detail);
    assert.ok(!firstDiag.event.includes('ring-super-secret-token-999'));
    assert.equal(firstDiag.detail.refreshToken, '[REDACTED]');
    assert.equal(firstDiag.detail.HAUS_API_TOKEN, '[REDACTED]');
    assert.equal(firstDiag.detail.statusCode, 401);

    // Verify child process environments never inherit host credentials
    const fakeHostEnv: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      HAUS_API_TOKEN: 'secret-haus-api-token',
      HAUS_HA_TOKEN: 'secret-ha-token',
      SUPERVISOR_TOKEN: 'secret-supervisor-token',
      AWS_SECRET_ACCESS_KEY: 'secret-aws-key',
    };

    const sidecar = new PythonSidecarHarness({ maxMemoryMb: 256 });
    const pyEnv = sidecar.buildSpawnEnv(fakeHostEnv);
    assert.equal(pyEnv.PATH, '/usr/bin:/bin');
    assert.equal(pyEnv.HAUS_PYTHON_MAX_MEM_MB, '256');
    assert.equal(pyEnv.HAUS_API_TOKEN, undefined);
    assert.equal(pyEnv.HAUS_HA_TOKEN, undefined);
    assert.equal(pyEnv.SUPERVISOR_TOKEN, undefined);
    assert.equal(pyEnv.AWS_SECRET_ACCESS_KEY, undefined);

    const bridge = new HomebridgeChildBridge({
      pluginName: 'homebridge-hue',
      config: { name: 'Hue', platform: 'Hue' },
    });
    const hbEnv = bridge.buildSpawnEnv(fakeHostEnv);
    assert.equal(hbEnv.PATH, '/usr/bin:/bin');
    assert.equal(hbEnv.HOMEBRIDGE_CHILD, '1');
    assert.equal(hbEnv.HAUS_API_TOKEN, undefined);
    assert.equal(hbEnv.SUPERVISOR_TOKEN, undefined);
  });

  describe('Supervisor API capability boundaries and cross-addon isolation', () => {
    let server: http.Server;
    let supervisor: SupervisorApiServer;
    let baseUrl: string;
    let engine: KitsuneCompatibilityEngine;

    beforeAll(async () => {
      engine = new KitsuneCompatibilityEngine();
      supervisor = new SupervisorApiServer();
      supervisor.registerAddon({
        slug: 'zigbee2mqtt',
        name: 'Zigbee2MQTT',
        version: '1.40.0',
        token: 'token-z2m',
        options: { serial: '/dev/ttyACM0' },
      });
      supervisor.registerAddon({
        slug: 'mosquitto',
        name: 'Mosquitto',
        version: '6.4.0',
        token: 'token-mqtt',
        options: { anonymous: false },
      });
      const lease = engine.acquireSession('supervisor', 'zigbee2mqtt', 'sup-owner');
      engine.attachSupervisorServer('zigbee2mqtt', 'sup-owner', lease.epoch, supervisor);

      server = http.createServer((req, res) => {
        void supervisor.handleRequest(req, res);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('rejects forbidden host/docker/backups Supervisor routes with 403 and records UnsupportedCapability', async () => {
      const res = await fetch(`${baseUrl}/docker/info`, {
        headers: { Authorization: 'Bearer token-z2m' },
      });
      assert.equal(res.status, 403);
      const body = (await res.json()) as { message?: string };
      assert.equal(body.message, 'supervisor_capability_unsupported');

      const unsupported = engine.getUnsupportedCapabilities('supervisor', 'zigbee2mqtt');
      assert.ok(unsupported.some((u) => u.capability === 'GET /docker/info'));
    });

    it('prevents cross-addon options access and discovery deletion by non-owner addons', async () => {
      // zigbee2mqtt cannot read mosquitto options
      const crossOpts = await fetch(`${baseUrl}/addons/mosquitto/options`, {
        headers: { Authorization: 'Bearer token-z2m' },
      });
      assert.equal(crossOpts.status, 403);
      const crossBody = (await crossOpts.json()) as { message?: string };
      assert.equal(crossBody.message, 'addon_scope_access_denied');

      // zigbee2mqtt registers a discovery entry
      const createRes = await fetch(`${baseUrl}/discovery`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer token-z2m',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ service: 'mqtt', config: { host: '127.0.0.1' } }),
      });
      assert.equal(createRes.status, 200);
      const { data } = (await createRes.json()) as { data: { uuid: string } };

      // mosquitto cannot delete zigbee2mqtt's discovery entry
      const forbiddenDel = await fetch(`${baseUrl}/discovery/${data.uuid}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token-mqtt' },
      });
      assert.equal(forbiddenDel.status, 403);

      // zigbee2mqtt can delete its own discovery entry
      const ownerDel = await fetch(`${baseUrl}/discovery/${data.uuid}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token-z2m' },
      });
      assert.equal(ownerDel.status, 200);
    });
  });
});
