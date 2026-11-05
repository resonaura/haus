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
import { AuthModule } from '../../src/auth/auth.module.js';
import { ControlModule } from '../../src/control/control.module.js';
import type { HubAuthService } from '../../src/auth/service.js';
import type { ControlService } from '../../src/control/service.js';
import type { Command } from '@haus/core/types';
import { createNestApp } from '../../src/nest.js';

describe('NestJS Auth & Control Modules (P11.3)', () => {
  describe('Full App OpenAPI & Postman Schema Integration', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      app = await createNestApp();
      await app.listen(0);
      const address = app.getHttpServer().address();
      const port = typeof address === 'object' && address ? address.port : 8791;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('publishes Authentication and Control in Swagger & dynamic Postman collection', async () => {
      const res = await fetch(`${baseUrl}/api/docs/postman.json`);
      expect(res.status).toBe(200);
      const collection = await res.json();

      const authFolder = collection.item.find((f: { name: string }) => f.name === 'Authentication');
      expect(authFolder).toBeDefined();
      const authItems = authFolder.item.map((i: { name: string }) => i.name.toLowerCase());
      expect(authItems.some((n: string) => n.includes('pair'))).toBe(true);
      expect(authItems.some((n: string) => n.includes('resume'))).toBe(true);
      expect(authItems.some((n: string) => n.includes('refresh'))).toBe(true);
      expect(authItems.some((n: string) => n.includes('logout'))).toBe(true);
      expect(authItems.some((n: string) => n.includes('session'))).toBe(true);

      const controlFolder = collection.item.find((f: { name: string }) => f.name === 'Control');
      expect(controlFolder).toBeDefined();
      const controlItems = controlFolder.item.map((i: { name: string }) => i.name.toLowerCase());
      expect(controlItems.some((n: string) => n.includes('connect'))).toBe(true);
      expect(controlItems.some((n: string) => n.includes('command'))).toBe(true);
      expect(controlItems.some((n: string) => n.includes('disconnect'))).toBe(true);
    });

    it('rejects unauthenticated control routes without actor header', async () => {
      const res = await fetch(`${baseUrl}/api/control/integrations/ha-1/session`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('authentication_required');
    });

    it('rejects unauthenticated resume route without bearer token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'csess-test' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Validation & Execution with Dynamic Module Providers', () => {
    let app: INestApplication;
    let baseUrl: string;

    const mockAuthService = {
      pair: async () => ({
        sessionId: 'sess-123',
        token: 'token-abc',
        refreshToken: 'refresh-xyz',
        issuedAt: 1000,
        expiresAt: 2000,
        refreshExpiresAt: 5000,
      }),
      resume: async (sessionId: string) => ({
        status: 'active' as const,
        session: { sessionId, actorId: 'usr-1', createdAt: 1000, lastUsedAt: 1000 },
      }),
      refresh: async () => ({
        status: 'renewed' as const,
        credentials: {
          sessionId: 'sess-123',
          token: 'token-new',
          refreshToken: 'refresh-new',
          issuedAt: 2000,
          expiresAt: 3000,
          refreshExpiresAt: 6000,
        },
      }),
      logout: async () => {},
      authenticate: async () => ({
        sessionId: 'sess-123',
        actorId: 'usr-1',
        createdAt: 1000,
        lastUsedAt: 1000,
      }),
      getSession: async () => ({
        sessionId: 'sess-123',
        actorId: 'usr-1',
        createdAt: 1000,
        lastUsedAt: 1000,
      }),
    };

    const mockControlService = {
      session: async (id: string) => ({
        resource: { domain: 'mock', instance: id },
        state: 'connected' as const,
        generation: 1,
        owner: { hubId: 'hub-1', processId: 'proc-1' },
      }),
      connect: async () => {},
      resume: async () => 'connected' as const,
      disconnect: async () => {},
      refresh: async () => {},
      execute: async (_actorId: string, _resourceId: string, idempotencyKey: string, cmd: Command) => ({
        correlationId: idempotencyKey,
        status: 'confirmed' as const,
        details: { entity: cmd.endpointId },
      }),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          AuthModule.forRoot(mockAuthService as unknown as HubAuthService),
          ControlModule.forRoot(mockControlService as unknown as ControlService),
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
      const port = typeof address === 'object' && address ? address.port : 8792;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      if (app) {
        await app.close();
      }
    });

    it('enforces DTO validation on pair payload', async () => {
      const res = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('successfully processes valid pair request', async () => {
      const validGrant = {
        challengeId: 'ch-1',
        code: '123456',
        clientFingerprint: 'fp-1',
      };
      const res = await fetch(`${baseUrl}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: validGrant }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionId).toBe('sess-123');
      expect(body.token).toBe('token-abc');
    });

    it('enforces DTO validation on refresh payload', async () => {
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-123' }), // missing refreshToken
      });
      expect(res.status).toBe(400);
    });

    it('refreshes credentials successfully', async () => {
      const res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-123', refreshToken: 'refresh-xyz' }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('renewed');
      expect(body.credentials.token).toBe('token-new');
    });

    it('queries active integration session using x-actor-id', async () => {
      const res = await fetch(`${baseUrl}/api/control/integrations/ha-provider/session`, {
        headers: { 'x-actor-id': 'admin-user' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBe('connected');
      expect(body.generation).toBe(1);
    });

    it('queries active integration session using Bearer authorization', async () => {
      const res = await fetch(`${baseUrl}/api/control/integrations/ha-provider/session`, {
        headers: { authorization: 'Bearer token-test' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.state).toBe('connected');
    });

    it('enforces DTO validation on dispatch command payload', async () => {
      const res = await fetch(`${baseUrl}/api/control/integrations/ha-provider/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'admin-user',
        },
        body: JSON.stringify({ idempotencyKey: 'idem-1' }), // missing command
      });
      expect(res.status).toBe(400);
    });

    it('dispatches command successfully with validated payload and idempotency key', async () => {
      const res = await fetch(`${baseUrl}/api/control/integrations/ha-provider/command`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor-id': 'admin-user',
        },
        body: JSON.stringify({
          idempotencyKey: 'idem-abc',
          command: {
            id: 'cmd-1',
            endpointId: 'ep-kitchen-light',
            capabilityId: 'cap-switch',
            operation: 'turn_on',
            arguments: { brightness: 80 },
          },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.receipt.correlationId).toBe('idem-abc');
      expect(body.receipt.status).toBe('confirmed');
    });
  });
});
