/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { test } from 'vitest';
import { port } from '../support/values.js';
import assert from 'node:assert/strict';
import { createServer as tcp, connect, Socket } from 'node:net';
import { createServer as http } from 'node:http';
import { once } from 'node:events';
import { RtspPeer, openPeerRtsp } from '../../src/camera/peer.js';

test('node-to-node RTSP shares only an owned source and closes when its lease is revoked', async (t) => {
  const source = tcp((socket) =>
    socket.on('data', () => socket.write('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n')),
  );
  t.onTestFinished(() => {
    source.close();
  });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  let allowed = true;
  const peers = new RtspPeer({
    owned: () => {
      if (!allowed) throw Error('revoked');
      return { id: 'owned' };
    },
    engine: { localRtsp: () => `rtsp://127.0.0.1:${port(source)}/fixture` },
  });
  t.onTestFinished(() => peers.stop());
  const server = http();
  t.onTestFinished(() => {
    server.close();
  });
  server.on('upgrade', (req, socket, head) => {
    assert.ok(socket instanceof Socket);
    peers.upgrade(req, socket, head);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const grant = peers.grant({ sessionId: 'owned', owner: 'owner' });
  const reader = await openPeerRtsp({
    url: `http://127.0.0.1:${port(server)}`,
    allowHttp: true,
    ...grant,
  });
  t.onTestFinished(() => reader.stop());
  const socket = connect(Number(new URL(reader.url).port), '127.0.0.1');
  t.onTestFinished(() => {
    socket.destroy();
  });
  await once(socket, 'connect');
  socket.write('OPTIONS rtsp://source/fixture RTSP/1.0\r\nCSeq: 1\r\n\r\n');
  assert.match(String((await once(socket, 'data'))[0]), /RTSP\/1.0 200/);
  const closed = once(socket, 'close');
  allowed = false;
  peers.sweep();
  await closed;
  assert.throws(() => peers.grant({ sessionId: 'owned', owner: 'owner' }), /revoked/);
});
