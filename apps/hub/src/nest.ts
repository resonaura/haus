/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { NvrModule } from './nvr/transport/module.js';
import { NvrTransport } from './nvr/transport/service.js';
import type { NvrOptions } from './nvr/transport/types.js';
import { ValidationPipe, Module } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { registerOpenApiDocument } from './docs/docs.controller.js';
import { configureHubFastifyParsers, createHubFastifyAdapter } from './http/fastify.js';
import { HausWsAdapter } from './live/live.adapter.js';
import { LIVE_SERVICE } from './live/tokens.js';
import type { LiveService } from './live/types.js';
import { STATUS_SERVICE, type IStatusService } from './status/status.controller.js';
import { isExplicitHaAppliance } from './status/status.service.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home/home.service.js';
import { localCameraNode } from './runtime/live-media.js';

export interface NestAppOptions {
  port?: number;
  bindAddress?: string;
  env?: NodeJS.ProcessEnv;
  dataDirectory?: string;
  mediaDirectory?: string;
  cors?: boolean;
  nvr?: NvrOptions;
  appliance?: string;
  apiToken?: string;
  hubId?: string;
}

export async function createNestApp(options: NestAppOptions = {}): Promise<INestApplication> {
  const runtimeEnv = options.env ?? process.env;
  const root =
    options.dataDirectory ?? process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data';
  const requestedMedia = options.mediaDirectory ?? join(root, 'media');
  if (!requestedMedia.trim()) throw Error('invalid_recording_media_directory');
  const mediaDirectory = resolve(requestedMedia);
  // Validate the recording path before opening any Nest-owned catalog connection.
  await mkdir(mediaDirectory, { recursive: true, mode: 0o750 });
  const haAppliance = isExplicitHaAppliance(options.appliance);
  @Module({
    imports: [
      AppModule.forRoot(root, {
        appliance: options.appliance,
        apiToken: options.apiToken,
        mediaDirectory,
        eufyWsUrl: runtimeEnv.HAUS_EUFY_WS_URL?.trim(),
        localCameraNode: localCameraNode(
          options.nvr,
          options.port,
          options.bindAddress ?? '0.0.0.0',
          runtimeEnv,
        ),
        hubId: options.hubId,
      }),
      ...(options.nvr ? [NvrModule.forRoot(options.nvr)] : []),
    ],
  })
  class ComposedHubModule {}
  const app = await NestFactory.create<NestFastifyApplication>(
    ComposedHubModule,
    createHubFastifyAdapter(),
    {
      cors: options.cors ?? true,
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
      rawBody: true,
      bodyParser: false,
    },
  );

  try {
    const fastify = app.getHttpAdapter().getInstance();
    const homeService = app.get<StandaloneHomeService>(STANDALONE_HOME_SERVICE, {
      strict: false,
    });
    if (homeService) {
      await homeService.configureSupervisor({
        dataDirectory: root,
        hostDataDirectory:
          options.env?.HAUS_DATA_HOST_DIR ?? process.env.HAUS_DATA_HOST_DIR ?? root,
        port: options.port ?? Number(options.env?.PORT ?? process.env.PORT ?? 8790),
        listeningPort: () => {
          const address = app.getHttpServer().address();
          return address && typeof address !== 'string' ? address.port : undefined;
        },
        env: runtimeEnv,
      });
    }

    const statusService = app.get<IStatusService & { setMode?: (mode: string) => void }>(
      STATUS_SERVICE,
      { strict: false },
    );
    statusService?.setMode?.(haAppliance ? 'ha-appliance' : 'standalone');
    let nvrTransport: NvrTransport | undefined;
    if (options.nvr) {
      nvrTransport = app.get(NvrTransport);
    }

    if (homeService || nvrTransport) {
      // Intercept raw-stream Supervisor and NVR transport requests before Fastify body parsing.
      fastify.addHook('onRequest', async (req, reply) => {
        const rawUrl = req.raw.url ?? '/';
        const path = rawUrl.split('?', 1)[0] ?? '/';
        if (homeService && (path === '/api/supervisor' || path.startsWith('/api/supervisor/'))) {
          reply.hijack();
          try {
            const handled = await homeService.handleSupervisorRequest(req.raw, reply.raw);
            if (!handled && !reply.raw.headersSent) {
              reply.raw.statusCode = 404;
              reply.raw.setHeader('Content-Type', 'application/json');
              reply.raw.end(JSON.stringify({ result: 'error', message: 'not_found' }));
            }
          } catch {
            if (!reply.raw.headersSent) {
              reply.raw.statusCode = 500;
              reply.raw.setHeader('Content-Type', 'application/json');
              reply.raw.end(
                JSON.stringify({ result: 'error', message: 'supervisor_request_failed' }),
              );
            }
          }
          return;
        }
        if (nvrTransport && NvrTransport.matches(rawUrl)) {
          reply.hijack();
          await nvrTransport.handle(req.raw, reply.raw);
        }
      });
    }

    configureHubFastifyParsers(app);

    const liveService = app.get<LiveService>(LIVE_SERVICE, { strict: false });
    app.useWebSocketAdapter(
      new HausWsAdapter(app, liveService, (req, socket, head) => {
        if (!nvrTransport || req.url !== '/v1/rtsp-peer') return false;
        nvrTransport.upgrade(req, socket, head);
        return true;
      }),
    );

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Haus Hub API')
      .setDescription('Haus Hub Local Camera, Services and Home Orchestration API')
      .setVersion('0.3.76')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Client authentication token or API bearer key',
        },
        'bearer',
      )
      .addTag('System', 'System liveness, health probes, and runtime metrics')
      .addTag('Documentation', 'OpenAPI and dynamic Postman collection endpoints')
      .addTag('Authentication', 'Client session establishment, token refresh, and lifecycle')
      .addTag(
        'Home Domain',
        'Standalone devices, scenes, scripts, automations, and Apps orchestration',
      )
      .addTag('Control', 'Provider integration binding, session status, and command routing')
      .addTag('Preferences', 'Household, room, device, and user interface preferences')
      .addTag('Servers', 'Host telemetry, hardware resources, and storage limits')
      .addTag('Cluster', 'Multi-node cluster peering, topology, and node lifecycle')
      .addTag('Backups', 'Hot snapshot management, Supervisor backup archives, and recovery kits')
      .addTag(
        'Kitsune Plugins',
        'Vendor plugin catalog, onboarding, device creation, and dynamic webhook ingress',
      )
      .addTag('Providers', 'Vendor bridge discovery, native camera import, and HA migration')
      .addTag(
        'Home Assistant Integration',
        'Home Assistant compatibility camera streaming, snapshots, and native entities',
      )
      .addTag('Cameras', 'Camera controls, WebRTC viewers, snapshots, and HomeKit pairing')
      .addTag('Streams', 'Cluster warm streaming proxies and HLS live playback')
      .addTag('Events', 'Event timeline queries, byte-range MP4/HLS video playback, and repair')
      .addTag(
        'Statistics',
        'Telemetry history, adaptive downsampling, and long-term statistical rollups',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    registerOpenApiDocument(document);

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    });

    return app;
  } catch (error) {
    try {
      await app.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'nest_configuration_failed');
    }
    throw error;
  }
}
