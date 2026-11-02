/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ServersStatus } from './types';
import { serverErrorMessage } from './server-errors';

import { HausClient } from '@haus/core/helper-client';
export type { ClusterStatus } from '@haus/core/helper-client';
const client = new HausClient(
  {
    request: (request) => {
      if (!window.hausNative) throw new Error('Connect your home in the desktop app first.');
      return window.hausNative.helper(request);
    },
  },
  (diagnostic) => window.hausNative?.logHelperDiagnostic?.(diagnostic),
);

export async function serverRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
) {
  if (!window.hausNative) throw new Error('Connect your home in the desktop app first.');
  try {
    return await client.request<T>({ method, path, ...(data ? { data } : {}) });
  } catch (error) {
    throw new Error(
      serverErrorMessage(error, { serverApi: method === 'GET' && path === '/api/servers' }),
    );
  }
}

export function confirmStorageLimit(status: ServersStatus, id: string, expected: number | null) {
  const server = status.servers.find((item) => item.id === id);
  if (!server?.settings || server.settings.storageLimitBytes !== expected) {
    throw new Error('The new storage limit has not been confirmed. Refresh servers and try again.');
  }
}

export async function saveThenRefresh<T>(
  action: () => Promise<unknown>,
  refresh: () => Promise<T>,
  confirm?: (status: T) => void,
) {
  await action();
  const status = await refresh();
  confirm?.(status);
  return status;
}
