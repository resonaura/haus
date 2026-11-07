/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import dgram from 'node:dgram';
import { reservePort } from '../../../src/stream/native-ports.js';

export async function freePort(udp = false): Promise<number> {
  const reservation = await reservePort(udp ? 'udp' : 'tcp');
  const port = reservation.port;
  await reservation.release();
  return port;
}
export const freeTcpPort = () => freePort();
export const freeUdpPort = () => freePort(true);

export async function availableReceiveBuffer(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
  try {
    for (let bytes = 8 * 1024 * 1024; bytes >= 256 * 1024; bytes /= 2) {
      try {
        socket.setRecvBufferSize(bytes);
        break;
      } catch {
        continue;
      } // Hosts may cap SO_RCVBUF; try the next bounded request.
    }
    return socket.getRecvBufferSize();
  } finally {
    socket.close();
  }
}
