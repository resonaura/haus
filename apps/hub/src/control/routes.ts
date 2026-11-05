/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Command } from '@haus/core/types';
import type { ControlService } from './service.js';

export interface RouteContext {
  readonly service: ControlService;
  readonly actorId?: string;
  readonly readBody?: (req: IncomingMessage) => Promise<unknown>;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(value));
}

async function defaultReadBody(req: IncomingMessage): Promise<unknown> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.startsWith('application/json')) {
    throw Error('json_required');
  }
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 65536) {
      throw Error('body_too_large');
    }
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Error('invalid_json');
  }
}

function mapErrorStatus(message: string): number {
  switch (message) {
    case 'authentication_required':
      return 401;
    case 'permission_denied':
    case 'control_permission_denied':
      return 403;
    case 'integration_not_found':
      return 404;
    case 'integration_not_connected':
    case 'integration_already_started':
    case 'command_idempotency_conflict':
    case 'integration_recovery_unverified':
    case 'integration_local_recovery_unavailable':
    case 'stale_provider_owner':
    case 'integration_session_changed':
      return 409;
    case 'json_required':
    case 'invalid_json':
    case 'invalid_command_value':
    case 'unsupported_operation':
    case 'invalid_request_payload':
      return 400;
    case 'body_too_large':
      return 413;
    default:
      return 500;
  }
}

/** Handles control routes for integration management and physical commands. */
export async function handleControlRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: RouteContext,
): Promise<boolean> {
  const match =
    /^\/api\/control\/integrations\/([a-zA-Z0-9_-]+)\/(connect|resume|disconnect|refresh|command|session)$/.exec(
      pathname,
    );
  if (!match) return false;

  const resourceId = match[1];
  const action = match[2];

  if (!context.actorId) {
    sendJson(res, 401, { error: 'authentication_required' });
    return true;
  }

  const actorId = context.actorId;
  const read = context.readBody ?? defaultReadBody;

  try {
    if (action === 'session' && req.method === 'GET') {
      const session = await context.service.session(resourceId);
      if (!session) {
        sendJson(res, 404, { error: 'session_not_found' });
      } else {
        sendJson(res, 200, {
          state: session.state,
          generation: session.generation,
          owner: session.owner,
        });
      }
      return true;
    }

    if (action === 'connect' && req.method === 'POST') {
      const body = (await read(req)) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || !('credential' in body)) {
        throw Error('invalid_request_payload');
      }
      await context.service.connect(actorId, resourceId, body.credential);
      sendJson(res, 200, { status: 'connected' });
      return true;
    }

    if (action === 'resume' && req.method === 'POST') {
      const result = await context.service.resume(actorId, resourceId);
      sendJson(res, 200, { status: result });
      return true;
    }

    if (action === 'disconnect' && req.method === 'POST') {
      await context.service.disconnect(actorId, resourceId);
      sendJson(res, 200, { status: 'disconnected' });
      return true;
    }

    if (action === 'refresh' && req.method === 'POST') {
      await context.service.refresh(resourceId);
      sendJson(res, 200, { status: 'refreshed' });
      return true;
    }

    if (action === 'command' && req.method === 'POST') {
      const body = (await read(req)) as Record<string, unknown>;
      if (
        !body ||
        typeof body !== 'object' ||
        typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey ||
        !body.command ||
        typeof body.command !== 'object'
      ) {
        throw Error('invalid_request_payload');
      }
      const reply = await context.service.execute(
        actorId,
        resourceId,
        body.idempotencyKey,
        body.command as Command,
      );
      sendJson(res, 200, { receipt: reply });
      return true;
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'internal_error';
    const status = mapErrorStatus(message);
    sendJson(res, status, { error: message });
    return true;
  }
}
