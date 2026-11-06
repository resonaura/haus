/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Auth,
  createConnection,
  subscribeEntities,
  ERR_INVALID_AUTH,
  type AuthData,
} from 'home-assistant-js-websocket';
import {
  HaClientError,
  type HaTransport,
  type HaConnectionState,
  type HaMessage,
} from './ha-client.js';

/** Call only inside a trusted platform session adapter, after loading Auth from secure storage. */
export async function openHaTransport(auth: Auth, commandTimeoutMs = 15_000): Promise<HaTransport> {
  if (!Number.isFinite(commandTimeoutMs) || commandTimeoutMs <= 0)
    throw new Error('invalid-command-timeout');
  const connection = await createConnection({ auth, setupRetry: 0, connectTimeout: 10_000 }).catch(
    (error: unknown) => {
      throw new HaClientError(error === ERR_INVALID_AUTH ? 'auth-required' : 'connection-failed');
    },
  );
  return {
    get connected() {
      return connection.connected;
    },
    close: () => connection.close(),
    async request<T>(message: HaMessage) {
      if (!connection.connected) throw new HaClientError('offline');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          connection.sendMessagePromise<T>(message),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new HaClientError('timeout'));
              connection.reconnect(true);
            }, commandTimeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    watchEntities: (callback) =>
      subscribeEntities(connection, (entities) => callback(Object.values(entities))),
    watchState(callback) {
      const ready = () => callback('connected');
      const disconnected = () => callback('reconnecting');
      const failed = (_connection: unknown, error?: unknown) =>
        callback(error === ERR_INVALID_AUTH ? 'auth-required' : 'reconnecting');
      connection.addEventListener('ready', ready);
      connection.addEventListener('disconnected', disconnected);
      connection.addEventListener('reconnect-error', failed);
      return () => {
        connection.removeEventListener('ready', ready);
        connection.removeEventListener('disconnected', disconnected);
        connection.removeEventListener('reconnect-error', failed);
      };
    },
  };
}
export { Auth };
export type { AuthData, HaConnectionState, HaTransport };
