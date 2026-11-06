/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import type { OpenAPIObject } from '@nestjs/swagger';

export interface PostmanHeader {
  key: string;
  value: string;
  type?: string;
  description?: string;
}

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: Array<{ key: string; value: string; description?: string }>;
  variable?: Array<{ key: string; value: string; description?: string }>;
}

export interface PostmanRequestBody {
  mode: 'raw';
  raw: string;
  options?: {
    raw: {
      language: 'json';
    };
  };
}

export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: PostmanRequestBody;
  description?: string;
}

export interface PostmanItem {
  name: string;
  request: PostmanRequest;
  response: unknown[];
}

export interface PostmanFolder {
  name: string;
  item: PostmanItem[];
  description?: string;
}

export interface PostmanCollection {
  info: {
    _postman_id: string;
    name: string;
    description?: string;
    schema: string;
  };
  variable: Array<{ key: string; value: string; type: string }>;
  item: Array<PostmanFolder | PostmanItem>;
}

export function openApiToPostman(
  document: OpenAPIObject,
  baseUrl = 'http://localhost:8790',
): PostmanCollection {
  const collectionId = randomUUID();
  const folders = new Map<string, PostmanItem[]>();
  const rootItems: PostmanItem[] = [];

  const paths = document.paths ?? {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;

    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;

      const tag = op.tags?.[0] ?? 'Default';
      const summary = op.summary ?? `${method.toUpperCase()} ${pathKey}`;
      const description = op.description;

      const headers: PostmanHeader[] = [{ key: 'Accept', value: 'application/json', type: 'text' }];

      let body: PostmanRequestBody | undefined;
      if (['post', 'put', 'patch'].includes(method)) {
        headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
        body = {
          mode: 'raw',
          raw: '{}',
          options: { raw: { language: 'json' } },
        };
      }

      // Convert path params /api/cameras/:id to {{baseUrl}}/api/cameras/:id
      const cleanPath = pathKey.replace(/^\/+/, '');
      const segments = cleanPath.split('/');
      const rawUrl = `{{baseUrl}}/${cleanPath}`;

      const postmanItem: PostmanItem = {
        name: summary,
        request: {
          method: method.toUpperCase(),
          header: headers,
          url: {
            raw: rawUrl,
            host: ['{{baseUrl}}'],
            path: segments,
          },
          ...(body ? { body } : {}),
          ...(description ? { description } : {}),
        },
        response: [],
      };

      if (!folders.has(tag)) {
        folders.set(tag, []);
      }
      folders.get(tag)!.push(postmanItem);
    }
  }

  const items: Array<PostmanFolder | PostmanItem> = [];
  for (const [tag, groupItems] of folders.entries()) {
    items.push({
      name: tag,
      item: groupItems,
    });
  }

  return {
    info: {
      _postman_id: collectionId,
      name: document.info?.title ?? 'Haus Hub API',
      description: document.info?.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [{ key: 'baseUrl', value: baseUrl, type: 'string' }],
    item: items.length ? items : rootItems,
  };
}
