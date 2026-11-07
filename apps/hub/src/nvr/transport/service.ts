/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { NvrOptions } from './types.js';
import { authenticator, EMPTY_DIGEST } from '../auth.js';
import { verifyGrant } from '../grants.js';
import { reply, failure } from './reply.js';
import { BlobRoutes } from './blobs.js';
import { cameraRoutes } from './camera.js';
import { metadataRoutes } from './metadata.js';
import { nvrStatus } from './status.js';

/** One protocol owner serves standalone fixtures and the shared Nest HTTP server. */
export class NvrTransport {
  private readonly authenticate: ReturnType<typeof authenticator>;
  private readonly blobRoutes: BlobRoutes;
  private shutdown?: Promise<void>;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly responses = new Set<ServerResponse>();
  constructor(readonly options: NvrOptions) {
    this.authenticate = authenticator(options.key);
    this.blobRoutes = new BlobRoutes(options);
    const { streams, cameras, capacity, maxStreams = 4 } = options;
    if (streams)
      streams.capacity = () =>
        capacity?.pressured ? 0 : Math.max(0, maxStreams - (cameras?.sessions.size ?? 0));
    if (cameras) cameras.otherStreams = () => streams?.size ?? 0;
  }
  static matches(url: string): boolean {
    const path = new URL(url, 'http://node.invalid').pathname;
    return /^\/(?:v1|media)(?:\/|$)/.test(path);
  }
  handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const task = this.serve(req, res);
    this.inFlight.add(task);
    void task.then(
      () => this.inFlight.delete(task),
      () => this.inFlight.delete(task),
    );
    return task;
  }
  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.shutdown) {
      reply(res, 503, { error: 'node_unavailable' });
      return;
    }
    this.responses.add(res);
    try {
      const { roles = ['storage', 'stream'], cameraAccess, blobs, capacity, key } = this.options;
      if (
        req.url === '/health' &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      ) {
        reply(res, 200, { status: 'ok' });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://node.invalid');
      const path = url.pathname;
      if (roles.includes('stream') && cameraAccess && (await cameraAccess.handle(req, res, path)))
        return;
      const grant = verifyGrant(key, url);
      if (!grant && !this.authenticate(req)) {
        reply(res, 401, { error: 'authentication_required' });
        return;
      }
      if (await cameraRoutes(this.options, req, res, url, grant)) return;
      if (!roles.length && path !== '/v1/status') {
        reply(res, 404, { error: 'not_found' });
        return;
      }
      const verify = /^\/v1\/blobs\/([a-f0-9]{64})\/verify$/.exec(path);
      if (!grant && verify && req.method === 'POST') {
        if (capacity?.pressured) {
          reply(res, 503, { error: 'verification_busy' });
          return;
        }
        if (
          req.headers['x-haus-digest'] !== EMPTY_DIGEST ||
          Number(req.headers['content-length'] || 0) !== 0 ||
          req.headers['transfer-encoding']
        )
          throw Error('invalid_body');
        const abort = new AbortController(),
          cancel = () => abort.abort();
        res.on('close', cancel);
        req.on('aborted', cancel);
        try {
          reply(res, 200, await blobs.verify(verify[1], { signal: abort.signal }));
        } finally {
          res.off('close', cancel);
          req.off('aborted', cancel);
        }
        return;
      }
      if (req.method === 'GET' && path === '/v1/status') {
        reply(res, 200, await nvrStatus(this.options, this.blobRoutes.serving));
        return;
      }
      if (await metadataRoutes(this.options, req, res, url, grant)) return;
      if (await this.blobRoutes.handle(req, res, path, grant)) return;
      reply(res, 404, { error: 'not_found' });
    } catch (error) {
      failure(req, res, error);
    } finally {
      this.responses.delete(res);
    }
  }
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.shutdown) {
      socket.destroy();
      return;
    }
    if (req.url !== '/v1/rtsp-peer') return;
    if (
      this.options.roles?.includes('stream') === false ||
      !this.options.peers ||
      !(socket instanceof Socket)
    ) {
      socket.destroy();
      return;
    }
    this.options.peers.upgrade(req, socket, head);
  }
  close(): Promise<void> {
    this.shutdown ??= this.stop();
    return this.shutdown;
  }
  private async stop(): Promise<void> {
    for (const response of this.responses) response.destroy();
    const resources = this.options;
    const errors: unknown[] = [];
    // Revoke policy admission and relay users before the camera engine and recording index.
    const releases = resources.lifetime
      ? [() => resources.lifetime?.stop()]
      : [
          () => resources.peers?.stop(),
          () => resources.host?.stop(),
          () => resources.continuity?.stop(),
          () => resources.cameraActivity?.stop(),
          () => resources.homekit?.stop(),
          () => resources.detectors?.stop(),
          () => resources.streams?.stop(),
          () => resources.playback?.stop(),
          () => resources.cameras?.stop(),
          () => resources.cameraRecordings?.stop(),
          () => resources.storageUsage?.stop(),
        ];
    for (const release of releases) {
      try {
        await release();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const outcome of await Promise.allSettled(this.inFlight)) {
      if (outcome.status === 'rejected') errors.push(outcome.reason);
    }
    try {
      if (resources.lifetime) await resources.lifetime.closeStorage();
      else await resources.recordings?.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'nvr_shutdown_incomplete');
  }
}

export function createNode(options: NvrOptions): Server {
  const transport = new NvrTransport(options);
  const server = createServer((req, res) => {
    void transport.handle(req, res);
  });
  if (options.peers)
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/v1/rtsp-peer') socket.destroy();
      else transport.upgrade(req, socket, head);
    });
  server.headersTimeout = 10000;
  server.requestTimeout = 120000;
  server.on('close', () => {
    void transport.close().catch(() => console.warn('NVR shutdown needs attention.'));
  });
  return server;
}
