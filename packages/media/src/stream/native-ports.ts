/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer } from 'node:net';
import dgram from 'node:dgram';

export interface PortReservation {
  port: number;
  release: () => Promise<void>;
}

export async function reservePort(protocol: 'tcp' | 'udp'): Promise<PortReservation> {
  if (protocol === 'tcp') {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error('camera_port_unavailable');
    }
    return {
      port: address.port,
      release: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
  return {
    port: socket.address().port,
    release: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}
