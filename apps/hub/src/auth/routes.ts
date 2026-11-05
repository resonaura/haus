/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HubAuthService } from './service.js';
import type { PairingGrant } from '@haus/core/pairing';

export interface AuthRouteContext {
  readonly service: HubAuthService;
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

function extractBearerToken(req: IncomingMessage): string | undefined {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string') return undefined;
  const match = /^Bearer\s+([a-zA-Z0-9_-]+)$/.exec(auth);
  return match ? match[1] : undefined;
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
    case 'invalid_credentials':
    case 'session_expired':
    case 'session_revoked':
    case 'grant_expired':
    case 'grant_revoked':
    case 'reauth_required':
      return 401;
    case 'wrong_home':
    case 'spoofed_hub':
      return 403;
    case 'invalid_session':
    case 'session_not_found':
      return 404;
    case 'json_required':
    case 'invalid_json':
    case 'invalid_request_payload':
    case 'invalid_pairing_grant':
      return 400;
    case 'body_too_large':
      return 413;
    default:
      return 500;
  }
}

export async function handleAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  context: AuthRouteContext,
): Promise<boolean> {
  if (!pathname.startsWith('/api/auth/')) return false;

  const action = pathname.slice('/api/auth/'.length);
  const read = context.readBody ?? defaultReadBody;

  try {
    if (action === 'pair' && req.method === 'POST') {
      const body = (await read(req)) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || !body.grant) {
        sendJson(res, 400, { error: 'invalid_request_payload' });
        return true;
      }
      const result = await context.service.pair(body.grant as PairingGrant);
      sendJson(res, 200, result);
      return true;
    }

    if (action === 'resume' && req.method === 'POST') {
      const token = extractBearerToken(req);
      const body = (await read(req)) as Record<string, unknown>;
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;

      if (!token || !sessionId) {
        sendJson(res, 401, { error: 'authentication_required' });
        return true;
      }

      const result = await context.service.resume(sessionId, token);
      if (result.status === 'active' && result.session) {
        sendJson(res, 200, { status: 'active', session: result.session });
      } else {
        const error = result.error ?? 'invalid_credentials';
        sendJson(res, mapErrorStatus(error), { error });
      }
      return true;
    }

    if (action === 'refresh' && req.method === 'POST') {
      const body = (await read(req)) as Record<string, unknown>;
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
      const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;

      if (!sessionId || !refreshToken) {
        sendJson(res, 400, { error: 'invalid_request_payload' });
        return true;
      }

      const result = await context.service.refresh(sessionId, refreshToken);
      if (result.status === 'renewed' && result.credentials) {
        sendJson(res, 200, { status: 'renewed', credentials: result.credentials });
      } else {
        const error = result.error ?? 'reauth_required';
        sendJson(res, mapErrorStatus(error), { error });
      }
      return true;
    }

    if (action === 'logout' && req.method === 'POST') {
      const token = extractBearerToken(req);
      let sessionId: string | undefined;

      try {
        const body = (await read(req)) as Record<string, unknown>;
        if (typeof body?.sessionId === 'string') sessionId = body.sessionId;
      } catch {
        // Body reading optional for logout if token provided
      }

      if (!sessionId && token) {
        const session = await context.service.authenticate(token);
        sessionId = session?.sessionId;
      }

      if (sessionId) {
        await context.service.logout(sessionId, token);
      }

      sendJson(res, 200, { status: 'logged_out' });
      return true;
    }

    if (action === 'session' && req.method === 'GET') {
      const token = extractBearerToken(req);
      if (!token) {
        sendJson(res, 401, { error: 'authentication_required' });
        return true;
      }

      const session = await context.service.authenticate(token);
      if (!session) {
        sendJson(res, 401, { error: 'invalid_credentials' });
        return true;
      }

      const view = await context.service.getSession(session.sessionId);
      sendJson(res, 200, { session: view });
      return true;
    }

    sendJson(res, 404, { error: 'not_found' });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'internal_error';
    const status = mapErrorStatus(message);
    sendJson(res, status, { error: message });
    return true;
  }
}
