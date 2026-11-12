/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ServersStatus } from './types';
import { serverErrorMessage } from './server-errors';
import type { NativeProviderRequest } from '../../../../shared/providers';

import { HausClient } from '@haus/ha/helper-client';
export type { ClusterStatus } from '@haus/ha/helper-client';
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
    if (path.startsWith('/api/providers')) {
      const session = await window.hausNative.getSession();
      if (session?.kind === 'haus-hub') {
        const request = providerRequest(method, path, data);
        if (!request) throw new Error('Unsupported camera bridge operation.');
        return await window.hausNative.nativeProviders<T>(request);
      }
    }
    return await client.request<T>({ method, path, ...(data ? { data } : {}) });
  } catch (error) {
    throw new Error(
      serverErrorMessage(error, { serverApi: method === 'GET' && path === '/api/servers' }),
    );
  }
}

function providerRequest(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
): NativeProviderRequest | undefined {
  if (method === 'GET' && path === '/api/providers') return { operation: 'list' };
  if (method === 'POST' && path === '/api/providers/discover') return { operation: 'discover' };
  if (method === 'POST' && path === '/api/providers/connect' && typeof data?.bridgeId === 'string')
    return { operation: 'connect', bridgeId: data.bridgeId };
  if (method === 'POST' && path === '/api/providers/enroll') {
    const { url, code, allowHttp } = data ?? {};
    if (typeof url === 'string' && typeof code === 'string' && typeof allowHttp === 'boolean')
      return { operation: 'enroll', url, code, allowHttp };
  }
  const preview = /^\/api\/providers\/([\w.:-]+)$/.exec(path);
  if (method === 'GET' && preview) return { operation: 'preview', bridgeId: preview[1]! };
  const importing = /^\/api\/providers\/([\w.:-]+)\/import$/.exec(path);
  if (
    method === 'POST' &&
    importing &&
    Array.isArray(data?.cameras) &&
    data.cameras.every((value): value is string => typeof value === 'string')
  )
    return {
      operation: 'import',
      bridgeId: importing[1]!,
      cameras: data.cameras,
    };
  return undefined;
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
