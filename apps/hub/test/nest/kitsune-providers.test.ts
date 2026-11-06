/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { KitsuneModule } from '../../src/kitsune/kitsune.module.js';
import { ProvidersModule } from '../../src/providers/providers.module.js';
import { HaCamerasModule } from '../../src/ha/ha.module.js';
import { createNestApp } from '../../src/nest.js';

describe('NestJS Kitsune, Providers, and HA Integration Modules (P11.5)', () => {
  describe('Full App OpenAPI & Postman Schema Integration', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      app = await createNestApp();
      await app.listen(0);
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 8795;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('publishes Kitsune, Providers, and HA Integration in dynamic Postman collection', async () => {
      const res = await fetch(`${baseUrl}/api/docs/postman.json`);
      expect(res.status).toBe(200);
      const collection = await res.json();

      const kitsuneFolder = collection.item.find((f: { name: string }) => f.name === 'Kitsune Plugins');
      expect(kitsuneFolder).toBeDefined();

      const providersFolder = collection.item.find((f: { name: string }) => f.name === 'Providers');
      expect(providersFolder).toBeDefined();

      const haFolder = collection.item.find((f: { name: string }) => f.name === 'Home Assistant Integration');
      expect(haFolder).toBeDefined();
    });
  });

  describe('Domain Controllers Functional Validation with Mocked Services', () => {
    let app: INestApplication;
    let baseUrl: string;

    const mockKitsuneService = {
      catalog: () => [
        {
          id: 'tuya',
          name: 'Tuya Native Bridge',
          enabled: true,
          route: { package: '@haus/kitsune-tuya', version: '1.0.0' },
        },
      ],
      onboard: async (vendor: string, fields: Record<string, string>) => ({
        vendor,
        success: true,
        account: fields.username,
      }),
      create: async (vendor: string, settings: Record<string, unknown>) => ({
        vendor,
        deviceId: 'dev-1',
        settings,
      }),
      enable: async (vendor: string) => ({
        vendor,
        enabled: true,
        version: '1.0.0',
      }),
      settings: async (vendor: string) => ({
        vendor,
        schema: { type: 'object' },
      }),
      canWebhook: (_plugin: string, token: string) => token === 'valid-token',
      webhook: async (
        plugin: string,
        subpath: string | undefined,
        request: { method: string; body: string },
      ) => ({
        code: 200,
        headers: { 'content-type': 'application/json', 'x-handled-by': plugin },
        body: JSON.stringify({ handled: true, subpath, method: request.method }),
      }),
    };

    const mockProvidersService = {
      list: () => [
        {
          id: 'bridge-1',
          kind: 'eufy',
          name: 'Eufy HomeBase',
          connected: true,
        },
      ],
      discover: async () => [
        { id: 'bridge-2', kind: 'tuya', name: 'Tuya Hub', host: '192.168.1.150' },
      ],
      add: async (p: { kind: string; name: string }) => ({
        id: 'bridge-3',
        kind: p.kind,
        name: p.name,
        connected: false,
      }),
      connect: async (bridgeId: string) => ({ bridgeId, connected: true }),
      preview: async (bridgeId: string) => [{ id: 'cam-1', bridgeId, name: 'Doorbell' }],
      import: async (bridgeId: string, cameras: string[]) => ({ bridgeId, imported: cameras }),
      remove: async () => {},
      handover: async (bridgeId?: string) => ({ bridgeId: bridgeId ?? 'all', handover: 'complete' }),
      migrationStatus: async (bridgeId: string) => ({ bridgeId, status: 'idle' }),
      migrationReview: async (bridgeId: string) => ({ bridgeId, changes: [] }),
      migrationStart: async (bridgeId: string, _input: unknown, isUndo: boolean) => ({
        bridgeId,
        action: isUndo ? 'undo' : 'apply',
        status: 'queued',
      }),
    };

    const mockHaService = {
      setup: async (input: { url: string }) => ({ configured: true, url: input.url }),
      enroll: async (input: unknown) => ({ enrolled: true, details: input }),
      revoke: async (clientId: string) => ({ revoked: true, clientId }),
      authenticate: (authHeader?: string) =>
        authHeader === 'Bearer valid-ha-token' ? 'client-ha-1' : undefined,
      cameras: () => [
        { entityId: 'camera.living_room', name: 'Living Room', online: true },
      ],
      snapshot: async (_id: string) => ({
        buffer: Buffer.from('fake-jpeg-bytes'),
        mime: 'image/jpeg',
        at: 1000,
        stale: false,
      }),
      command: async (clientId: string, camera: string, action: string) => ({
        clientId,
        camera,
        action,
        status: 'accepted',
      }),
      nativeDevices: () => [{ id: 'native-1', name: 'Smart Plug' }],
      nativeCommand: async (camera: string, entity: string) => ({
        camera,
        entity,
        status: 'dispatched',
      }),
      nativeAcknowledge: (clientId: string) => ({ acknowledged: true, clientId }),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          KitsuneModule.forRoot(mockKitsuneService),
          ProvidersModule.forRoot(mockProvidersService),
          HaCamerasModule.forRoot(mockHaService),
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
        }),
      );
      await app.listen(0);
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 8796;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    // Kitsune tests
    it('retrieves plugins catalog at /api/kitsune/catalog', async () => {
      const res = await fetch(`${baseUrl}/api/kitsune/catalog`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.vendors.length).toBe(1);
      expect(body.vendors[0].id).toBe('tuya');
    });

    it('onboards vendor plugin at /api/kitsune/:vendor/onboard', async () => {
      const res = await fetch(`${baseUrl}/api/kitsune/tuya/onboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: { username: 'user@example.com' } }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.created.success).toBe(true);
      expect(body.created.account).toBe('user@example.com');
    });

    it('enforces DTO validation on onboard payload', async () => {
      const res = await fetch(`${baseUrl}/api/kitsune/tuya/onboard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('handles dynamic webhook ingress with valid token', async () => {
      const res = await fetch(`${baseUrl}/api/kitsune/hooks/valid-token/eufy/motion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motion: true }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-handled-by')).toBe('eufy');
      const body = await res.json();
      expect(body.handled).toBe(true);
      expect(body.subpath).toBe('motion');
    });

    it('rejects dynamic webhook ingress with invalid token', async () => {
      const res = await fetch(`${baseUrl}/api/kitsune/hooks/bad-token/eufy/motion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motion: true }),
      });
      expect(res.status).toBe(401);
    });

    // Providers tests
    it('lists registered providers at /api/providers', async () => {
      const res = await fetch(`${baseUrl}/api/providers`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers.length).toBe(1);
      expect(body.providers[0].id).toBe('bridge-1');
    });

    it('triggers bridge discovery at /api/providers/discover', async () => {
      const res = await fetch(`${baseUrl}/api/providers/discover`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers.length).toBe(1);
    });

    it('enrolls provider bridge at /api/providers/enroll', async () => {
      const res = await fetch(`${baseUrl}/api/providers/enroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'tuya', name: 'Living Room Tuya', config: {} }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBe('bridge-3');
    });

    it('imports cameras at /api/providers/:id/import', async () => {
      const res = await fetch(`${baseUrl}/api/providers/bridge-1/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cameras: ['cam-1', 'cam-2'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cameras.imported.length).toBe(2);
    });

    it('removes provider bridge at /api/providers/:id/remove', async () => {
      const res = await fetch(`${baseUrl}/api/providers/bridge-1/remove`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.removed).toBe(true);
    });

    it('applies native migration at /api/providers/:id/migration/apply', async () => {
      const res = await fetch(`${baseUrl}/api/providers/bridge-1/migration/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.action).toBe('apply');
    });

    // HA Integration tests
    it('configures HA integration at /api/ha-integration', async () => {
      const res = await fetch(`${baseUrl}/api/ha-integration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'http://192.168.4.44:8123', token: 'secret-token' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
    });

    it('rejects unauthenticated /ha/cameras request', async () => {
      const res = await fetch(`${baseUrl}/ha/cameras`);
      expect(res.status).toBe(401);
    });

    it('lists exposed cameras at /ha/cameras with bearer token', async () => {
      const res = await fetch(`${baseUrl}/ha/cameras`, {
        headers: { authorization: 'Bearer valid-ha-token' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile).toBe(1);
      expect(body.cameras.length).toBe(1);
      expect(body.cameras[0].entityId).toBe('camera.living_room');
    });

    it('serves camera live snapshot at /ha/cameras/:id/snapshot', async () => {
      const res = await fetch(`${baseUrl}/ha/cameras/camera.living_room/snapshot`, {
        headers: { authorization: 'Bearer valid-ha-token' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      const text = await res.text();
      expect(text).toBe('fake-jpeg-bytes');
    });

    it('dispatches camera viewer command at /ha/cameras/:id/:action', async () => {
      const res = await fetch(`${baseUrl}/ha/cameras/camera.living_room/viewer`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-ha-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ stream: 'live' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.action).toBe('viewer');
      expect(body.status).toBe('accepted');
    });

    it('lists native devices at /ha/native/devices', async () => {
      const res = await fetch(`${baseUrl}/ha/native/devices`, {
        headers: { authorization: 'Bearer valid-ha-token' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.devices.length).toBe(1);
    });
  });
});
