/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateApiOptions } from '@haus/hub/runtime';

interface Listenable {
  listen(port: number, host: string, callback: () => void): unknown;
  address(): string | AddressInfo | null;
}

interface Closable {
  close(callback: (error?: Error) => void): unknown;
}

/** Bind to an ephemeral loopback port and resolve once it is accepting connections. */
export function listen(server: Listenable): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
}

/** The actual ephemeral port of a listening server. */
export function port(server: Pick<Listenable, 'address'>): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server_not_listening');
  return address.port;
}

export function closeServer(server: Closable): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export type HttpServer = Server;

export function stubStore(): CreateApiOptions['store'] {
  return {
    totals: async () => ({
      bytes: 0,
      archivedBytes: 0,
      unavailableBytes: 0,
      totalBytes: 0,
      localEvents: 0,
      archivedEvents: 0,
    }),
    recordedDays: async () => [],
    list: async () => ({ items: [] }),
    availability: async () => ({}),
    overrides: async () => ({}),
    setCamera: async () => ({}),
    pinMedia: async () => () => {},
    get: async () => undefined,
    archive: { hasVerifiedLocation: async () => false },
    path: () => '/tmp/unused',
    setLocal: async () => ({}),
  };
}
