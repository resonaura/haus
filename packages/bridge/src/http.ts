/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { CameraBridgeProvider } from './provider.js';
import { uuid, validateCommand, type BridgeCommand } from './protocol.js';

interface Options {
  provider: CameraBridgeProvider;
  command: (cameraId: string, entityId: string, command: BridgeCommand) => Promise<void>;
  now?: () => number;
}
interface Receipt {
  fingerprint: string;
  until: number;
  task: Promise<void>;
}
const reply = (res: ServerResponse, status: number, value: unknown) =>
  res
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(value));
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    req.headers['x-haus-client'] !== '1' ||
    !String(req.headers['content-type']).startsWith('application/json')
  )
    throw Error('invalid_bridge_request');
  let text = '';
  for await (const part of req) {
    text += part;
    if (Buffer.byteLength(text) > 65536) throw Error('bridge_request_too_large');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error('invalid_bridge_request');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('invalid_bridge_request');
  return value;
}

/** Mounted by either Node HTTP or a framework adapter; never exposes arbitrary provider methods. */
export class CameraBridgeHttp {
  private readonly provider: CameraBridgeProvider;
  private readonly command: Options['command'];
  private readonly now: () => number;
  private readonly receipts = new Map<string, Receipt>();
  private readonly queues = new Map<string, Promise<void>>();
  private active = 0;
  constructor(options: Options) {
    this.provider = options.provider;
    this.command = options.command;
    this.now = options.now ?? Date.now;
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = req.url ?? '';
    if (!path.startsWith('/api/haus/v2/')) return false;
    try {
      if (path === '/api/haus/v2/info' && req.method === 'GET') {
        reply(res, 200, this.provider.info());
        return true;
      }
      if (path === '/api/haus/v2/enroll' && req.method === 'POST') {
        const value = await body(req);
        if (
          Object.keys(value).sort().join(',') !== 'code,controllerId' ||
          typeof value.code !== 'string' ||
          typeof value.controllerId !== 'string'
        )
          throw Error('invalid_bridge_pairing');
        reply(res, 200, await this.provider.enroll(value.code, value.controllerId));
        return true;
      }
      const clientId = this.provider.authenticate(req.headers.authorization);
      if (!clientId) {
        reply(res, 401, { error: 'bridge_access_required' });
        return true;
      }
      if (path === '/api/haus/v2/inventory' && req.method === 'GET') {
        reply(res, 200, this.provider.readInventory(clientId));
        return true;
      }
      if (path === '/api/haus/v2/revoke' && req.method === 'POST') {
        const value = await body(req);
        if (Object.keys(value).length) throw Error('invalid_bridge_request');
        await this.provider.revoke(clientId);
        reply(res, 200, { revoked: true });
        return true;
      }
      if (path === '/api/haus/v2/ready' && req.method === 'POST') {
        const value = await body(req);
        if (
          Object.keys(value).sort().join(',') !== 'entities,revision' ||
          typeof value.revision !== 'string' ||
          !Array.isArray(value.entities) ||
          value.entities.some((id) => typeof id !== 'string')
        )
          throw Error('incomplete_bridge_handover');
        reply(
          res,
          200,
          await this.provider.confirmNativeReady(
            clientId,
            value as { revision: string; entities: string[] },
          ),
        );
        return true;
      }
      if (path === '/api/haus/v2/lease' && req.method === 'POST') {
        const value = await body(req);
        if (Object.keys(value).join(',') !== 'revision' || typeof value.revision !== 'string')
          throw Error('bridge_handover_required');
        reply(res, 200, this.provider.renew(clientId, value.revision));
        return true;
      }
      const match =
        /^\/api\/haus\/v2\/cameras\/([a-zA-Z0-9_.:-]{1,128})\/entities\/([a-zA-Z0-9_.:-]{1,128})\/command$/.exec(
          path,
        );
      if (match && req.method === 'POST') {
        const value = await body(req);
        if (Object.keys(value).sort().join(',') !== 'command,requestId' || !uuid(value.requestId))
          throw Error('invalid_bridge_command');
        const camera = this.provider
          .readInventory(clientId)
          .cameras.find((camera) => camera.id === match[1]);
        const entity = camera?.entities.find((entity) => entity.id === match[2]);
        if (!camera || !entity) throw Error('bridge_entity_not_found');
        if (!camera.available) throw Error('bridge_entity_unavailable');
        const command = validateCommand(entity, value.command);
        await this.execute(clientId, value.requestId, match[1], match[2], command);
        reply(res, 200, { accepted: true, requestId: value.requestId });
        return true;
      }
      reply(res, 404, { error: 'not_found' });
    } catch (error) {
      // No provider error text, source URLs or command values cross this boundary.
      const code = error instanceof Error ? error.message : '';
      const allowed =
        /^(?:invalid_bridge_(?:request|pairing|command)|bridge_(?:access_required|entity_(?:read_only|not_found|unavailable)|request_too_large|already_owned|clients_full|handover_required|command_(?:conflict|busy))|incomplete_bridge_handover)$/;
      reply(res, allowed.test(code) ? 400 : 503, {
        error: allowed.test(code) ? code : 'bridge_unavailable',
      });
    }
    return true;
  }
  private async execute(
    clientId: string,
    requestId: string,
    cameraId: string,
    entityId: string,
    command: BridgeCommand,
  ) {
    const key = clientId + ':' + requestId;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ cameraId, entityId, command }))
      .digest('hex');
    for (const [id, receipt] of this.receipts)
      if (receipt.until < this.now()) this.receipts.delete(id);
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error('bridge_command_conflict');
      return existing.task;
    }
    if (this.active >= 32 || this.receipts.size >= 2048) throw Error('bridge_command_busy');
    const queueKey = cameraId + ':' + entityId,
      previous = this.queues.get(queueKey) ?? Promise.resolve();
    this.active++;
    const task = previous
      .catch(() => {})
      .then(() => {
        const camera = this.provider
          .readInventory(clientId)
          .cameras.find((camera) => camera.id === cameraId);
        const entity = camera?.entities.find((entity) => entity.id === entityId);
        if (!camera?.available || !entity) throw Error('bridge_entity_unavailable');
        return this.command(cameraId, entityId, validateCommand(entity, command));
      })
      .finally(() => {
        this.active--;
        if (this.queues.get(queueKey) === task) this.queues.delete(queueKey);
        const receipt = this.receipts.get(key);
        if (receipt) receipt.until = this.now() + 120000;
      });
    this.queues.set(queueKey, task);
    this.receipts.set(key, { fingerprint, until: Infinity, task });
    return task;
  }
}
