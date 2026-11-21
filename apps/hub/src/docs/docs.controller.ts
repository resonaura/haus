/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OpenAPIObject } from '@nestjs/swagger';
import { openApiToPostman } from './postman.js';

let sharedOpenApiDocument: OpenAPIObject | undefined;

export function registerOpenApiDocument(doc: OpenAPIObject) {
  sharedOpenApiDocument = doc;
}

export function getOpenApiDocument(): OpenAPIObject | undefined {
  return sharedOpenApiDocument;
}

@ApiTags('Documentation')
@Controller('api/docs')
export class DocsController {
  @ApiOperation({
    summary: 'Dynamic Postman Collection v2.1 export',
    description:
      'Serves a dynamically generated Postman collection covering all active endpoints, schemas, and tags.',
  })
  @ApiResponse({
    status: 200,
    description: 'Valid Postman Collection v2.1 JSON',
  })
  @Get('postman.json')
  getPostmanCollection(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    if (!sharedOpenApiDocument) {
      return res.code(503).send({ error: 'documentation_not_initialized' });
    }
    const host = req.headers.host || 'localhost:8790';
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    const collection = openApiToPostman(sharedOpenApiDocument, baseUrl);
    return res
      .header('Content-Type', 'application/json')
      .header('Cache-Control', 'no-store')
      .code(200)
      .send(collection);
  }

  @ApiExcludeEndpoint()
  @Get('postman')
  getPostmanAlias(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    return this.getPostmanCollection(req, res);
  }
}
