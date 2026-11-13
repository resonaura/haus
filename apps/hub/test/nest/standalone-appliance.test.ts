/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createNestApp } from '../../src/nest.js';
import { AuthGuard } from '../../src/auth/auth.guard.js';
import { ControlGuard } from '../../src/control/control.guard.js';

const ADMIN_TOKEN = 'pairing-test-admin-token';
process.env.HAUS_API_TOKEN = ADMIN_TOKEN;

describe('Standalone Composition & HA Appliance Exception (P16.1)', () => {
  describe('Guard Fail-Closed Invariants Without Injected AuthService', () => {
    const fakeContext = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer arbitrary-unverified-token' } }),
      }),
    } as object as ExecutionContext;

    it('AuthGuard rejects arbitrary bearer tokens when no HubAuthService is injected', async () => {
      await expect(new AuthGuard(undefined).canActivate(fakeContext)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('ControlGuard rejects arbitrary bearer tokens when no HubAuthService is injected', async () => {
      await expect(new ControlGuard(undefined).canActivate(fakeContext)).rejects.toMatchObject({
        status: 401,
      });
    });
  });

  describe('Default Standalone Boot, Onboarding, Devices, Scenes, Automations & Apps', () => {
    let app: INestApplication;
    let baseUrl: string;
    let wsUrl: string;
    let pairedSessionToken: string;

    beforeAll(async () => {
      app = await createNestApp();
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      wsUrl = `ws://127.0.0.1:${port}/api/live`;
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    it('boots in standalone mode with no HA overlay composed', async () => {
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.json()).toMatchObject({ status: 'ok', mode: 'standalone', ha: false });

      expect((await fetch(`${baseUrl}/ha/cameras`)).status).toBe(404);
      const haSetupRes = await fetch(`${baseUrl}/api/ha-integration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.4.44:8123', token: 'unused' }),
      });
      expect(haSetupRes.status).toBe(404);

      const collection = await (await fetch(`${baseUrl}/api/docs/postman.json`)).json();
      expect(
        collection.item.find((f: { name: string }) => f.name === 'Home Assistant Integration'),
      ).toBeUndefined();
      expect(collection.item.find((f: { name: string }) => f.name === 'Home Domain')).toBeDefined();
    });

    it('rejects unauthenticated access and prototype fixture credentials across HTTP and WebSocket', async () => {
      const protectedPaths = [
        '/api/status',
        '/api/devices',
        '/api/scenes',
        '/api/scripts',
        '/api/automations',
        '/api/apps',
        '/api/preferences',
        '/api/cameras',
        '/api/events',
      ];
      for (const path of protectedPaths) {
        expect((await fetch(`${baseUrl}${path}`)).status).toBe(401);
        expect(
          (await fetch(`${baseUrl}${path}`, { headers: { authorization: 'Bearer fixture' } }))
            .status,
        ).toBe(401);
      }

      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: 'Bearer fixture', 'X-Haus-Client': '1' },
      });
      await expect(
        new Promise((_, reject) => {
          socket.on('error', reject);
          socket.on('open', () => reject(new Error('Fixture token must not open WebSocket')));
        }),
      ).rejects.toThrow();
      socket.terminate();
    });

    it('completes standalone onboarding (identity -> challenge -> confirm -> pair) and issues a session token', async () => {
      const identityRes = await fetch(`${baseUrl}/api/auth/identity`);
      expect(identityRes.status).toBe(200);
      const identityBody = await identityRes.json();
      expect(identityBody.hub.hubId).toBeDefined();
      expect(identityBody.hub.homeId).toBeDefined();
      expect(identityBody.hub.name).toBeDefined();

      const firstAnonymousRes = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeCode: 'CHOSEN-BY-CLIENT' }),
      });
      expect(firstAnonymousRes.status).toBe(201);
      const firstAnonymous = await firstAnonymousRes.json();
      expect(firstAnonymous.sessionId).toBeDefined();
      expect(firstAnonymous.firstOnboarding).toBe(true);
      expect(firstAnonymous.challengeCode).toMatch(/^[A-F0-9]{8}$/);
      expect(firstAnonymous.challengeCode).not.toBe('CHOSEN-BY-CLIENT');

      const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = await challengeRes.json();
      expect(challenge.sessionId).toBeDefined();
      expect(challenge.challengeCode).toMatch(/^[A-F0-9]{8}$/);

      const confirmRes = await fetch(`${baseUrl}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          client: { clientId: 'client-iphone-1', clientName: 'Standalone iPhone', role: 'admin' },
          challengeCode: challenge.challengeCode,
          expectedHomeId: identityBody.hub.homeId,
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = await confirmRes.json();
      expect(confirmed.grant).toBeDefined();

      const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      expect(pairRes.status).toBe(201);
      const paired = await pairRes.json();
      expect(typeof paired.credentials.sessionToken).toBe('string');
      pairedSessionToken = paired.credentials.sessionToken;

      const subsequentAnonymousRes = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeCode: 'CHOSEN-BY-CLIENT' }),
      });
      expect(subsequentAnonymousRes.status).toBe(201);
      const subsequentAnonymous = await subsequentAnonymousRes.json();
      expect(subsequentAnonymous.sessionId).toBeDefined();
      expect(subsequentAnonymous.firstOnboarding).toBe(false);
      expect(subsequentAnonymous.challengeCode).toBeUndefined();

      const statusRes = await fetch(`${baseUrl}/api/status`, {
        headers: { authorization: `Bearer ${pairedSessionToken}` },
      });
      expect(statusRes.status).toBe(200);
      expect(await statusRes.json()).toMatchObject({ connected: true, mode: 'standalone' });

      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${pairedSessionToken}`, 'X-Haus-Client': '1' },
      });
      const [, message] = await Promise.all([once(socket, 'open'), once(socket, 'message')]);
      const payload = JSON.parse(String(message[0]));
      expect(payload.topic).toBe('home');
      expect(payload.connected).toBe(true);
      socket.terminate();
    });

    it('executes standalone device commands, scenes, scripts, and automations end-to-end with no HA', async () => {
      const headers = {
        authorization: `Bearer ${pairedSessionToken}`,
        'content-type': 'application/json',
      };

      // 1. Register two standalone devices (a motion sensor and a hallway light)
      const motionRes = await fetch(`${baseUrl}/api/devices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'device-hallway-motion',
          name: 'Hallway Motion',
          category: 'sensor',
          roomId: 'room-hallway',
          available: true,
          endpoints: [
            {
              id: 'ep-hallway-motion',
              deviceId: 'device-hallway-motion',
              name: 'Motion',
              capabilities: [
                {
                  id: 'motion',
                  type: 'binary',
                  readable: true,
                  writable: false,
                  eventDriven: true,
                },
              ],
              readings: [{ capabilityId: 'motion', value: false, updatedAt: Date.now() }],
            },
          ],
          services: [{ protocol: 'zigbee', externalId: 'zb-motion-1' }],
        }),
      });
      expect(motionRes.status).toBe(201);

      const lightRes = await fetch(`${baseUrl}/api/devices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'device-hallway-light',
          name: 'Hallway Light',
          category: 'lighting',
          roomId: 'room-hallway',
          available: true,
          endpoints: [
            {
              id: 'ep-hallway-light',
              deviceId: 'device-hallway-light',
              name: 'Light',
              capabilities: [
                { id: 'on_off', type: 'binary', readable: true, writable: true, eventDriven: true },
                {
                  id: 'brightness',
                  type: 'numeric',
                  readable: true,
                  writable: true,
                  eventDriven: true,
                },
              ],
              readings: [
                { capabilityId: 'on_off', value: false, updatedAt: Date.now() },
                { capabilityId: 'brightness', value: 0, updatedAt: Date.now() },
              ],
            },
          ],
          services: [{ protocol: 'matter', externalId: 'matter-light-1' }],
        }),
      });
      expect(lightRes.status).toBe(201);

      // 2. Register an automation triggered by motion -> turns on hallway light
      const autoRes = await fetch(`${baseUrl}/api/automations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'auto-hallway-motion-light',
          name: 'Hallway Motion Light',
          enabled: true,
          triggers: [
            { type: 'state', endpointId: 'ep-hallway-motion', property: 'motion', to: true },
          ],
          conditions: [],
          actions: [
            {
              type: 'device_command',
              endpointId: 'ep-hallway-light',
              capability: 'on_off',
              command: 'turn_on',
            },
          ],
        }),
      });
      expect(autoRes.status).toBe(201);

      // 3. Trigger motion state update on device-hallway-motion and verify automation fires
      const triggerRes = await fetch(`${baseUrl}/api/devices/device-hallway-motion/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: 'ep-hallway-motion',
          capability: 'motion',
          command: 'set_motion',
          parameters: { value: true },
        }),
      });
      expect(triggerRes.status).toBe(200);
      const triggerBody = await triggerRes.json();
      expect(triggerBody.triggeredExecutions).toHaveLength(1);
      expect(triggerBody.triggeredExecutions[0].sourceId).toBe('auto-hallway-motion-light');
      expect(triggerBody.triggeredExecutions[0].status).toBe('completed');

      const lightGetRes = await fetch(`${baseUrl}/api/devices/device-hallway-light`, { headers });
      expect(lightGetRes.status).toBe(200);
      expect((await lightGetRes.json()).endpointStates['ep-hallway-light'].on_off).toBe(true);

      // 4. Register and activate a scene
      const sceneRes = await fetch(`${baseUrl}/api/scenes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'scene-evening',
          name: 'Evening Dim',
          members: [
            {
              endpointId: 'ep-hallway-light',
              capability: 'brightness',
              command: 'set_brightness',
              parameters: { value: 35 },
            },
          ],
        }),
      });
      expect(sceneRes.status).toBe(201);

      const activateSceneRes = await fetch(`${baseUrl}/api/scenes/scene-evening/activate`, {
        method: 'POST',
        headers,
      });
      expect(activateSceneRes.status).toBe(200);
      expect((await activateSceneRes.json()).execution.status).toBe('completed');

      const lightAfterScene = await (
        await fetch(`${baseUrl}/api/devices/device-hallway-light`, { headers })
      ).json();
      expect(lightAfterScene.endpointStates['ep-hallway-light'].brightness).toBe(35);

      // 5. Register and execute a script
      const scriptRes = await fetch(`${baseUrl}/api/scripts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: 'script-goodnight',
          name: 'Goodnight',
          steps: [
            {
              type: 'device_command',
              endpointId: 'ep-hallway-light',
              capability: 'on_off',
              command: 'turn_off',
            },
          ],
        }),
      });
      expect(scriptRes.status).toBe(201);

      const execScriptRes = await fetch(`${baseUrl}/api/scripts/script-goodnight/execute`, {
        method: 'POST',
        headers,
      });
      expect(execScriptRes.status).toBe(200);
      expect((await execScriptRes.json()).execution.status).toBe('completed');

      const lightAfterScript = await (
        await fetch(`${baseUrl}/api/devices/device-hallway-light`, { headers })
      ).json();
      expect(lightAfterScript.endpointStates['ep-hallway-light'].on_off).toBe(false);

      // 6. Verify execution history and atomic room move with retained alias resolution
      const historyRes = await fetch(`${baseUrl}/api/automations/history`, { headers });
      expect(historyRes.status).toBe(200);
      expect((await historyRes.json()).history.length).toBeGreaterThanOrEqual(3);

      const moveRes = await fetch(`${baseUrl}/api/devices/device-hallway-light/move-room`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetRoomId: 'room-kitchen' }),
      });
      expect(moveRes.status).toBe(200);
      const moveBody = await moveRes.json();
      expect(moveBody.toRoomId).toBe('room-kitchen');
      expect(moveBody.retainedAliases.length).toBeGreaterThan(0);

      const aliasCmdRes = await fetch(`${baseUrl}/api/devices/device-hallway-light/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          endpointId: moveBody.retainedAliases[0],
          capability: 'on_off',
          command: 'turn_on',
        }),
      });
      expect(aliasCmdRes.status).toBe(200);
      const aliasCmdBody = await aliasCmdRes.json();
      expect(aliasCmdBody.endpointId).toBe('ep-hallway-light');
      expect(aliasCmdBody.state.on_off).toBe(true);
    });

    it('installs, inspects, executes, and operates standalone Apps while enforcing security boundaries', async () => {
      const headers = {
        authorization: `Bearer ${pairedSessionToken}`,
        'content-type': 'application/json',
      };

      const installRes = await fetch(`${baseUrl}/api/apps/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          manifest: {
            id: 'zigbee2mqtt',
            name: 'Zigbee2MQTT',
            version: '2.1.0',
            image: 'koenkk/zigbee2mqtt:2.1.0',
            architectures: ['arm64', 'amd64'],
            devices: [{ type: 'serial', hostPath: '/dev/ttyACM0' }],
          },
          grantedPermissions: ['device:serial'],
        }),
      });
      expect(installRes.status).toBe(201);
      const installed = await installRes.json();
      expect(installed.manifest.id).toBe('zigbee2mqtt');
      const appId = installed.appId as string;

      const listRes = await fetch(`${baseUrl}/api/apps`, { headers });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.apps).toHaveLength(1);

      const execRes = await fetch(`${baseUrl}/api/apps/${encodeURIComponent(appId)}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'restart' }),
      });
      expect(execRes.status).toBe(200);
      const execBody = await execRes.json();
      expect(execBody.status).toBe('ok');

      const operateRes = await fetch(`${baseUrl}/api/apps/${encodeURIComponent(appId)}/operate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operation: 'logs',
        }),
      });
      expect(operateRes.status).toBe(200);
      const operateBody = await operateRes.json();
      expect(operateBody.status).toBe('ok');

      // Verify forbidden Docker socket mount is rejected
      const forbiddenRes = await fetch(`${baseUrl}/api/apps/install`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          manifest: {
            id: 'unsafe-docker-app',
            name: 'Unsafe App',
            version: '1.0.0',
            image: 'alpine:3.20',
            architectures: ['arm64', 'amd64'],
            mounts: [
              {
                target: 'data',
                containerPath: '/var/run/docker.sock',
                hostPath: '/var/run/docker.sock',
                readOnly: false,
              },
            ],
          },
          grantedPermissions: [],
        }),
      });
      expect(forbiddenRes.status).toBe(400);
      const forbiddenBody = await forbiddenRes.json();
      expect(forbiddenBody.error).toContain('FORBIDDEN_DOCKER_SOCKET');
    });
  });
});
