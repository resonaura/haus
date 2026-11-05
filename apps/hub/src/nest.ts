/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { registerOpenApiDocument } from './docs/docs.controller.js';

export interface NestAppOptions {
  port?: number;
  cors?: boolean;
}

export async function createNestApp(options: NestAppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    cors: options.cors ?? true,
    logger: ['error', 'warn', 'log'],
  });

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
    .addTag('Control', 'Provider integration binding, session status, and command routing')
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
}
