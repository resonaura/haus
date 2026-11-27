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
  type HaEntityObservation,
  type HaTransport,
  type HaConnectionState,
  type HaMessage,
} from './ha-client.js';
import type { HassEntity } from './types.js';

function decodeStateChangedEntity(raw: unknown): HassEntity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.entity_id !== 'string' ||
    typeof record.state !== 'string' ||
    !record.attributes ||
    typeof record.attributes !== 'object' ||
    Array.isArray(record.attributes)
  ) {
    return null;
  }
  return {
    entity_id: record.entity_id,
    state: record.state,
    attributes: { ...(record.attributes as Record<string, unknown>) },
    last_changed: typeof record.last_changed === 'string' ? record.last_changed : '',
    last_updated: typeof record.last_updated === 'string' ? record.last_updated : undefined,
  };
}

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
    watchObservations(callback) {
      let active = true;
      let unsubscribePromise: Promise<() => Promise<void>> | undefined = connection
        .subscribeEvents((rawEvent: unknown) => {
          if (!active || !rawEvent || typeof rawEvent !== 'object') return;
          const event = rawEvent as {
            data?: { entity_id?: unknown; new_state?: unknown };
            context?: { id?: unknown };
          };
          const entityId =
            typeof event.data?.entity_id === 'string' ? event.data.entity_id : undefined;
          if (!entityId) return;
          const value =
            event.data?.new_state === null ? null : decodeStateChangedEntity(event.data?.new_state);
          if (event.data?.new_state !== null && !value) return;
          const correlationId =
            typeof event.context?.id === 'string' && event.context.id.length > 0
              ? event.context.id
              : undefined;
          callback({ entityId, value, correlationId });
        }, 'state_changed')
        .catch(() => async () => {});
      return () => {
        active = false;
        const pending = unsubscribePromise;
        unsubscribePromise = undefined;
        void pending?.then((stop) => stop()).catch(() => {});
      };
    },
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
export type { AuthData, HaConnectionState, HaEntityObservation, HaTransport };
