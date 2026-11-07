/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { required } from '../values.js';
export { delay };

export async function waitUntil(
  predicate: () => boolean,
  description: string | (() => string),
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), typeof description === 'function' ? description() : description);
}

/** Demultiplex real RTSP responses and interleaved video/audio RTP packets. */
export async function rtspReader(port: number, path: string) {
  const socket = createConnection({ port, host: '127.0.0.1' });
  const packets: Buffer[] = [],
    audioPackets: Buffer[] = [],
    responses: string[] = [];
  let pending: Buffer = Buffer.alloc(0),
    cseq = 0;
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (!pending.length) return;
      if (pending[0] === 0x24) {
        if (pending.length < 4) return;
        const length = pending.readUInt16BE(2);
        if (pending.length < length + 4) return;
        if (pending[1] === 0) packets.push(Buffer.from(pending.subarray(4, length + 4)));
        if (pending[1] === 2) audioPackets.push(Buffer.from(pending.subarray(4, length + 4)));
        pending = pending.subarray(length + 4);
      } else {
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) return;
        const header = pending.subarray(0, end + 4).toString();
        const bodyLength = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1] ?? 0);
        if (pending.length < end + 4 + bodyLength) return;
        responses.push(pending.subarray(0, end + 4 + bodyLength).toString());
        pending = pending.subarray(end + 4 + bodyLength);
      }
    }
  });
  await once(socket, 'connect');
  return {
    socket,
    packets,
    audioPackets,
    async request(method: string, suffix = '', headers = ''): Promise<string> {
      const sequence = ++cseq;
      socket.write(
        `${method} rtsp://127.0.0.1:${port}/${path}${suffix} RTSP/1.0\r\nCSeq: ${sequence}\r\n${headers}\r\n`,
      );
      await waitUntil(
        () => responses.some((response) => response.includes(`CSeq: ${sequence}\r\n`)),
        `${method} response`,
      );
      const response = required(responses.find((item) => item.includes(`CSeq: ${sequence}\r\n`)));
      assert.match(response, /^RTSP\/1\.0 200 OK/);
      return response;
    },
  };
}
