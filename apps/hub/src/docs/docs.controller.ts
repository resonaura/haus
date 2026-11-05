/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
    description: 'Serves a dynamically generated Postman collection covering all active endpoints, schemas, and tags.',
  })
  @ApiResponse({
    status: 200,
    description: 'Valid Postman Collection v2.1 JSON',
  })
  @Get('postman.json')
  getPostmanCollection(@Req() req: Request, @Res() res: Response) {
    if (!sharedOpenApiDocument) {
      return res.status(503).json({ error: 'documentation_not_initialized' });
    }
    const host = req.get('host') || 'localhost:8790';
    const protocol = req.protocol || 'http';
    const baseUrl = `${protocol}://${host}`;
    const collection = openApiToPostman(sharedOpenApiDocument, baseUrl);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.json(collection);
  }

  @ApiExcludeEndpoint()
  @Get('postman')
  getPostmanAlias(@Req() req: Request, @Res() res: Response) {
    return this.getPostmanCollection(req, res);
  }
}
