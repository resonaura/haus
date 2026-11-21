/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHubFastifyParsers, createHubFastifyAdapter } from '../../src/http/fastify.js';
import { createNestApp } from '../../src/nest.js';

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

async function readStreamUtf8(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Controller('probe')
class FastifyProbeController {
  @Post('json')
  @HttpCode(200)
  echoJson(@Req() req: RawBodyRequest, @Body() body: unknown) {
    return {
      body,
      raw: req.rawBody ? req.rawBody.toString('utf8') : null,
      contentType: req.headers['content-type'] ?? null,
    };
  }

  @Post('stream')
  @HttpCode(200)
  async echoStream(@Req() req: FastifyRequest) {
    const data = await readStreamUtf8(req.raw);
    return {
      size: Buffer.byteLength(data, 'utf8'),
      data,
    };
  }

  @Post('raw')
  @HttpCode(200)
  echoRaw(@Req() req: RawBodyRequest, @Body() body: unknown) {
    return {
      isBuffer: Buffer.isBuffer(body),
      text: Buffer.isBuffer(body) ? body.toString('utf8') : String(body),
      raw: req.rawBody ? req.rawBody.toString('utf8') : null,
    };
  }

  @Get('items/:id')
  echoParam(@Param('id') id: string) {
    return { id, length: id.length };
  }
}

describe('Hub Fastify adapter and parser configuration', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FastifyProbeController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(createHubFastifyAdapter(), {
      rawBody: true,
      bodyParser: false,
    });
    configureHubFastifyParsers(app);
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('fastify_probe_listener_unavailable');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uses the fastify HTTP adapter', () => {
    expect(app.getHttpAdapter().getType()).toBe('fastify');
  });

  it('accepts empty application/json bodies as {}', async () => {
    const res = await fetch(`${baseUrl}/probe/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ body: {} });
  });

  it('preserves exact rawBody bytes for application/json and +json suffixes', async () => {
    const payload = '{  "event": "sync", "n": 42  }';
    for (const contentType of ['application/json', 'application/cloudevents+json']) {
      const res = await fetch(`${baseUrl}/probe/json`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: payload,
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.body).toEqual({ event: 'sync', n: 42 });
      expect(data.raw).toBe(payload);
    }
  });

  it('parses application/x-www-form-urlencoded payloads', async () => {
    const res = await fetch(`${baseUrl}/probe/json`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'alpha=1&beta=two',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.body).toEqual({ alpha: '1', beta: 'two' });
  });

  it('passes audio/* and multipart/form-data streams through req.raw unbuffered', async () => {
    const audioRes = await fetch(`${baseUrl}/probe/stream`, {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      body: 'opus-frame-stream',
    });
    expect(audioRes.status).toBe(200);
    expect(await audioRes.json()).toEqual({ size: 17, data: 'opus-frame-stream' });

    const multipartBody = '--b\r\nContent-Disposition: form-data; name="file"\r\n\r\nhello\r\n--b--';
    const mpRes = await fetch(`${baseUrl}/probe/stream`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=b' },
      body: multipartBody,
    });
    expect(mpRes.status).toBe(200);
    expect(await mpRes.json()).toEqual({
      size: Buffer.byteLength(multipartBody, 'utf8'),
      data: multipartBody,
    });
  });

  it('accepts octet-stream and XML payloads without 415 while preserving rawBody', async () => {
    const binRes = await fetch(`${baseUrl}/probe/raw`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: 'binary-payload',
    });
    expect(binRes.status).toBe(200);
    expect(await binRes.json()).toEqual({
      isBuffer: true,
      text: 'binary-payload',
      raw: 'binary-payload',
    });

    const xmlRes = await fetch(`${baseUrl}/probe/raw`, {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body: '<event>ok</event>',
    });
    expect(xmlRes.status).toBe(200);
    expect(await xmlRes.json()).toEqual({
      isBuffer: false,
      text: '<event>ok</event>',
      raw: '<event>ok</event>',
    });
  });

  it('allows route parameters longer than Fastify default 100 chars', async () => {
    const longId = 'ep_' + 'a'.repeat(180);
    const res = await fetch(`${baseUrl}/probe/items/${longId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: longId, length: longId.length });
  });

  it('boots full Hub Fastify app with apiToken, hubId, and ha-green appliance without duplicate routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-fastify-full-'));
    const fullApp = await createNestApp({
      dataDirectory: root,
      appliance: 'ha-green',
      apiToken: 'fastify-boot-token',
      hubId: 'hub-fastify-01',
    });
    try {
      await fullApp.listen(0, '127.0.0.1');
      expect(fullApp.getHttpAdapter().getType()).toBe('fastify');

      const address = fullApp.getHttpServer().address();
      if (!address || typeof address === 'string') {
        throw new Error('full_app_listener_unavailable');
      }
      const origin = `http://127.0.0.1:${address.port}`;

      const healthRes = await fetch(`${origin}/health`);
      expect(healthRes.status).toBe(200);
      const health = await healthRes.json();
      expect(health.mode).toBe('ha-appliance');

      const identityRes = await fetch(`${origin}/api/auth/identity`);
      expect(identityRes.status).toBe(200);
      const identity = await identityRes.json();
      expect(identity.hub.hubId).toBe('hub-fastify-01');

      const unauthRes = await fetch(`${origin}/api/devices`);
      expect(unauthRes.status).toBe(401);
      const authRes = await fetch(`${origin}/api/devices`, {
        headers: { authorization: 'Bearer fastify-boot-token' },
      });
      expect(authRes.status).toBe(200);
    } finally {
      await fullApp.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('closes promptly after serving a streamed file response over a keep-alive connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'haus-fastify-close-'));
    const file = join(dir, 'sample.bin');
    await writeFile(file, 'recorded');

    @Controller('stream-close')
    class StreamCloseController {
      @Get()
      serve(@Res() res: FastifyReply) {
        res.header('Content-Length', 8);
        return res.send(createReadStream(file));
      }
    }

    try {
      for (let i = 0; i < 3; i++) {
        const moduleRef = await Test.createTestingModule({
          controllers: [StreamCloseController],
        }).compile();
        const streamApp = moduleRef.createNestApplication<NestFastifyApplication>(
          createHubFastifyAdapter(),
          { bodyParser: false },
        );
        await streamApp.listen(0, '127.0.0.1');
        const address = streamApp.getHttpServer().address();
        if (!address || typeof address === 'string') {
          throw new Error('stream_close_listener_unavailable');
        }
        const res = await fetch(`http://127.0.0.1:${address.port}/stream-close`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('recorded');
        const startedAt = Date.now();
        await streamApp.close();
        expect(Date.now() - startedAt).toBeLessThan(1500);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
