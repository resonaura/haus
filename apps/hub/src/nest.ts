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
import { NvrModule } from './nvr/transport/module.js';
import { NvrTransport } from './nvr/transport/service.js';
import type { NvrOptions } from './nvr/transport/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ValidationPipe, Module } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { registerOpenApiDocument } from './docs/docs.controller.js';
import { HausWsAdapter } from './live/live.adapter.js';
import { LIVE_SERVICE } from './live/tokens.js';
import type { LiveService } from './live/types.js';
import { STATUS_SERVICE, type IStatusService } from './status/status.controller.js';
import { isExplicitHaAppliance } from './status/status.service.js';
import { STANDALONE_HOME_SERVICE, StandaloneHomeService } from './home/home.service.js';

export interface NestAppOptions {
  port?: number;
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
        hubId: options.hubId,
      }),
      ...(options.nvr ? [NvrModule.forRoot(options.nvr)] : []),
    ],
  })
  class ComposedHubModule {}
  const app = await NestFactory.create(ComposedHubModule, {
    cors: options.cors ?? true,
    logger: ['error', 'warn', 'log'],
    abortOnError: false,
    rawBody: true,
  });

  try {
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
        env: options.env ?? process.env,
      });
      app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = req.url?.split('?', 1)[0] ?? '/';
        if (path !== '/api/supervisor' && !path.startsWith('/api/supervisor/')) return next();
        void homeService
          .handleSupervisorRequest(req, res)
          .then((handled) => {
            if (!handled) next();
          })
          .catch(() => {
            if (res.headersSent) return;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ result: 'error', message: 'supervisor_request_failed' }));
          });
      });
    }

    const statusService = app.get<IStatusService & { setMode?: (mode: string) => void }>(
      STATUS_SERVICE,
      { strict: false },
    );
    statusService?.setMode?.(haAppliance ? 'ha-appliance' : 'standalone');
    let nvrTransport: NvrTransport | undefined;
    if (options.nvr) {
      const transport = app.get(NvrTransport);
      // Register before Nest installs JSON parsing: blob digests cover the exact raw bytes.
      app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!NvrTransport.matches(req.url ?? '/')) return next();
        void transport.handle(req, res);
      });
      nvrTransport = transport;
    }

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
