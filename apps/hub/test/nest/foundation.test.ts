/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { createNestApp } from '../../src/nest.js';

describe('NestJS SWC Foundation & OpenAPI/Postman Engine (P11.1)', () => {
  let app: INestApplication;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createNestApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'object' && address ? address.port : 8790;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('serves liveness health probe at /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('standalone');
    expect(body.ha).toBe(false);
    expect(typeof body.timestamp).toBe('number');
  });

  it('serves api health status at /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('serves Swagger documentation at /api/docs', async () => {
    const res = await fetch(`${baseUrl}/api/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('swagger-ui');
  });

  it('dynamically hosts auto-generated Postman Collection v2.1 at /api/docs/postman.json', async () => {
    const res = await fetch(`${baseUrl}/api/docs/postman.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const collection = await res.json();
    expect(collection.info).toBeDefined();
    expect(collection.info.name).toBe('Haus Hub API');
    expect(collection.info.schema).toBe(
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    );
    expect(Array.isArray(collection.variable)).toBe(true);
    expect(collection.variable[0].key).toBe('baseUrl');
    expect(Array.isArray(collection.item)).toBe(true);

    // Verify System folder exists in Postman collection
    const systemFolder = collection.item.find(
      (folder: { name: string }) => folder.name === 'System',
    );
    expect(systemFolder).toBeDefined();
    expect(Array.isArray(systemFolder.item)).toBe(true);

    // Check health endpoint request definition
    const healthItem = systemFolder.item.find(
      (i: { name: string }) => i.name.includes('health') || i.name.includes('Health'),
    );
    expect(healthItem).toBeDefined();
    expect(healthItem.request.method).toBe('GET');
    expect(healthItem.request.url.raw).toContain('health');
  });

  it('serves /api/docs/postman endpoint alias', async () => {
    const res = await fetch(`${baseUrl}/api/docs/postman`);
    expect(res.status).toBe(200);
    const collection = await res.json();
    expect(collection.info.name).toBe('Haus Hub API');
  });
});
