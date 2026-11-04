import { providerId } from './protocol.js';
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  uuid,
  validateInventory,
  inventoryRevision,
  type BridgeInventory,
  type Provider,
  type BridgeCommand,
} from './protocol.js';

const privateAddress = (address: string) =>
  (isIP(address) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) ||
  (isIP(address) === 6 && /^(fc|fd)[a-f0-9]{2}:/i.test(address));
export interface BridgeEndpoint {
  url: string;
  address: string;
  family: 4 | 6;
  allowHttp: boolean;
}
export interface BridgeConnection {
  endpoint: BridgeEndpoint;
  bridgeId: string;
  provider: Provider;
  clientId: string;
  token: string;
}

/** Enrollment pins the selected private endpoint before sending the one-use pairing code. */
export async function cameraBridgeEndpoint(
  input: string,
  allowHttp = false,
  resolve = lookup,
): Promise<BridgeEndpoint> {
  const url = new URL(input),
    host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !allowHttp) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('invalid_bridge_address');
  let timer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    isIP(host)
      ? Promise.resolve([{ address: host, family: isIP(host) }])
      : resolve(host, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('bridge_resolution_timeout')), 1500);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some((item) => !privateAddress(item.address)))
    throw Error('invalid_bridge_address');
  const selected = addresses[0];
  return {
    url: url.origin,
    address: selected.address,
    family: selected.family as 4 | 6,
    allowHttp,
  };
}

export async function bridgeJson(
  endpoint: BridgeEndpoint,
  path: string,
  {
    method = 'GET',
    body,
    token,
    timeout = 8000,
  }: { method?: 'GET' | 'POST'; body?: unknown; token?: string; timeout?: number } = {},
): Promise<unknown> {
  if (
    !privateAddress(endpoint.address) ||
    !/^\/api\/haus\/v2\/[a-zA-Z0-9_/:.-]+$/.test(path) ||
    path.includes('..')
  )
    throw Error('invalid_bridge_request');
  const url = new URL(endpoint.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !endpoint.allowHttp) ||
    !isIP(endpoint.address) ||
    isIP(endpoint.address) !== endpoint.family ||
    (isIP(host) !== 0 && host !== endpoint.address)
  )
    throw Error('invalid_bridge_address');
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (payload && payload.length > 65536) throw Error('invalid_bridge_request');
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      new URL(path, url),
      {
        method,
        headers: {
          Accept: 'application/json',
          'X-Haus-Client': '1',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [{ address: endpoint.address, family: endpoint.family }]);
          else callback(null, endpoint.address, endpoint.family);
        },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          response.headers['content-type']?.split(';')[0] !== 'application/json'
        ) {
          const error = Error(
            response.statusCode === 401 ? 'bridge_access_required' : 'bridge_request_failed',
          );
          response.destroy();
          request.destroy();
          reject(error);
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > (path === '/api/haus/v2/info' ? 4096 : 6 * 1024 ** 2)) {
            response.destroy();
            request.destroy();
            reject(Error('bridge_response_too_large'));
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(Error('bridge_connection_failed')));
        response.on('aborted', () => reject(Error('bridge_connection_failed')));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(Error('invalid_bridge_response'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(Error('bridge_request_timeout')),
      Math.min(15000, Math.max(1000, timeout)),
    );
    request.on('error', () => reject(Error('bridge_connection_failed')));
    request.on('close', () => clearTimeout(timer));
    request.end(payload);
  });
}

export class CameraBridgeClient {
  readonly connection: BridgeConnection;
  constructor(
    connection: BridgeConnection,
    private readonly request = bridgeJson,
  ) {
    if (
      !uuid(connection.bridgeId) ||
      !uuid(connection.clientId) ||
      !providerId(connection.provider) ||
      !/^[a-f0-9]{64}$/.test(connection.token)
    )
      throw Error('invalid_bridge_connection');
    this.connection = Object.freeze({
      ...connection,
      endpoint: Object.freeze({ ...connection.endpoint }),
    });
  }
  static async enroll(
    endpoint: BridgeEndpoint,
    code: string,
    controllerId: string,
    request = bridgeJson,
  ) {
    if (!/^[a-f0-9]{48}$/.test(code) || !uuid(controllerId)) throw Error('invalid_bridge_pairing');
    const info = (await request(endpoint, '/api/haus/v2/info')) as {
      version: number;
      bridgeId: string;
      provider: Provider;
    };
    if (info?.version !== 2 || !uuid(info.bridgeId) || !providerId(info.provider))
      throw Error('invalid_bridge_response');
    const enrolled = (await request(endpoint, '/api/haus/v2/enroll', {
      method: 'POST',
      body: { code, controllerId },
    })) as { version: number; bridgeId: string; clientId: string; token: string };
    if (enrolled?.version !== 2 || enrolled.bridgeId !== info.bridgeId)
      throw Error('bridge_identity_mismatch');
    return new CameraBridgeClient(
      {
        endpoint,
        bridgeId: info.bridgeId,
        provider: info.provider,
        clientId: enrolled.clientId,
        token: enrolled.token,
      },
      request,
    );
  }
  private call(path: string, body?: unknown) {
    return this.request(this.connection.endpoint, path, {
      token: this.connection.token,
      method: body === undefined ? 'GET' : 'POST',
      body,
    });
  }
  async inventory(): Promise<BridgeInventory & { revision: string }> {
    const response = (await this.call('/api/haus/v2/inventory')) as { revision: unknown };
    const inventory = validateInventory(response);
    if (
      inventory.bridgeId !== this.connection.bridgeId ||
      inventory.provider !== this.connection.provider ||
      typeof response.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(response.revision) ||
      response.revision !== inventoryRevision(inventory)
    )
      throw Error('bridge_identity_mismatch');
    return { ...inventory, revision: response.revision };
  }
  ready(revision: string, entities: string[]) {
    return this.call('/api/haus/v2/ready', { revision, entities });
  }
  renew(revision: string) {
    return this.call('/api/haus/v2/lease', { revision });
  }
  revoke() {
    return this.call('/api/haus/v2/revoke', {});
  }
  releaseNative() {
    return this.call('/api/haus/v2/release', {});
  }
  command(cameraId: string, entityId: string, command: BridgeCommand, requestId: string) {
    if (
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(cameraId) ||
      !/^[a-zA-Z0-9_.:-]{1,128}$/.test(entityId) ||
      !uuid(requestId)
    )
      throw Error('invalid_bridge_command');
    // One network attempt. A timeout never silently replays a physical command.
    return this.call(`/api/haus/v2/cameras/${cameraId}/entities/${entityId}/command`, {
      requestId,
      command,
    });
  }
}
