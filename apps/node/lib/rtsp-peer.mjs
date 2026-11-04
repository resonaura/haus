/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer, connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { cameraSource } from './camera-source.mjs';

/** Camera-scoped tickets expose an existing local RTSP reader, never the upstream URL or node key. */
export class RtspPeer {
  constructor(cameras, { now = Date.now } = {}) {
    Object.assign(this, { cameras, now });
    this.tickets = new Map();
    this.connections = new Set();
    this.timer = setInterval(() => this.sweep(), 5000);
    this.timer.unref();
  }
  grant({ sessionId, owner }) {
    this.cameras.owned(sessionId, owner);
    if (this.tickets.size >= 128) throw Error('camera_peer_busy');
    const token = randomBytes(32).toString('hex');
    this.tickets.set(token, { sessionId, owner, until: this.now() + 60000, sockets: new Set() });
    return { token, path: new URL(this.cameras.engine.localRtsp(sessionId)).pathname };
  }
  valid(ticket) {
    try {
      return !!this.cameras.owned(ticket.sessionId, ticket.owner);
    } catch {
      return false;
    }
  }
  upgrade(req, socket, head) {
    if (req.url !== '/v1/rtsp-peer' || req.headers.upgrade !== 'haus-rtsp') {
      socket.destroy();
      return;
    }
    const token = req.headers['x-haus-relay-token'];
    const ticket =
      typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
        ? this.tickets.get(token)
        : undefined;
    if (!ticket || ticket.until <= this.now() || ticket.sockets.size >= 4 || !this.valid(ticket)) {
      socket.destroy();
      return;
    }
    const url = new URL(this.cameras.engine.localRtsp(ticket.sessionId));
    const upstream = connect({ host: '127.0.0.1', port: Number(url.port) });
    const pair = { socket, upstream, ticket };
    this.connections.add(pair);
    ticket.sockets.add(pair);
    const close = () => {
      socket.destroy();
      upstream.destroy();
      this.connections.delete(pair);
      ticket.sockets.delete(pair);
    };
    upstream.on('error', close);
    socket.on('error', close);
    socket.on('close', close);
    upstream.on('close', close);
    upstream.once('connect', () => {
      if (!this.valid(ticket)) return close();
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: haus-rtsp\r\n\r\n',
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
  }
  sweep() {
    for (const [key, ticket] of this.tickets) {
      if (!this.valid(ticket))
        for (const pair of ticket.sockets) {
          pair.socket.destroy();
          pair.upstream.destroy();
        }
      if ((!ticket.sockets.size && ticket.until <= this.now()) || !this.valid(ticket))
        this.tickets.delete(key);
    }
  }
  stop() {
    clearInterval(this.timer);
    for (const pair of this.connections) {
      pair.socket.destroy();
      pair.upstream.destroy();
    }
    this.connections.clear();
    this.tickets.clear();
  }
}

/** Bind a private loopback reader over the source node's authenticated, backpressured HTTP(S) tunnel. */
export async function openPeerRtsp(peer) {
  if (
    !peer ||
    !/^[a-f0-9]{64}$/.test(peer.token) ||
    typeof peer.path !== 'string' ||
    !/^\/[a-zA-Z0-9/_-]{1,200}$/.test(peer.path)
  )
    throw Error('invalid_camera_peer');
  const url = new URL(peer.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol === 'http:' && peer.allowHttp !== true)
  )
    throw Error('invalid_camera_peer');
  const pinned = await cameraSource({ kind: 'rtsp', url: `rtsp://${url.host}/` });
  const target = new URL(url);
  target.hostname = new URL(pinned.url).hostname;
  const sockets = new Set();
  const requests = new Set();
  const server = createServer((socket) => {
    if (sockets.size >= 4) return socket.destroy();
    sockets.add(socket);
    socket.pause();
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)({
      protocol: url.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: url.port,
      servername: url.hostname,
      path: '/v1/rtsp-peer',
      method: 'GET',
      timeout: 10000,
      headers: {
        Host: url.host,
        Connection: 'Upgrade',
        Upgrade: 'haus-rtsp',
        'x-haus-relay-token': peer.token,
      },
    });
    requests.add(request);
    const close = () => {
      request.destroy();
      socket.destroy();
      sockets.delete(socket);
      requests.delete(request);
    };
    request.on('error', close);
    request.on('timeout', close);
    request.on('response', (response) => {
      response.resume();
      close();
    });
    socket.on('error', close);
    socket.on('close', close);
    request.once('upgrade', (_response, remote, head) => {
      requests.delete(request);
      request.setTimeout(0);
      sockets.add(remote);
      remote.on('error', close);
      remote.on('close', () => {
        sockets.delete(remote);
        close();
      });
      socket.on('close', () => remote.destroy());
      if (head.length) socket.write(head);
      socket.pipe(remote).pipe(socket);
      socket.resume();
    });
    request.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `rtsp://127.0.0.1:${server.address().port}${peer.path}`,
    stop: () => {
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
