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
export type {
  ClusterNodeDrainPlan,
  ClusterStatus,
  ClusterTransferSummary,
  ClusterWorkloadSummary,
  RemoveClusterNodeOptions,
} from '@haus/ha/helper-client';
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
  const [pathname, search = ''] = path.split('?');
  if (method === 'GET' && pathname === '/api/providers') return { operation: 'list' };
  if (method === 'GET' && pathname === '/api/providers/handover')
    return { operation: 'handoverStatus' };
  if (method === 'POST' && pathname === '/api/providers/discover') return { operation: 'discover' };
  if (
    method === 'POST' &&
    pathname === '/api/providers/connect' &&
    typeof data?.bridgeId === 'string'
  )
    return { operation: 'connect', bridgeId: data.bridgeId };
  if (method === 'POST' && pathname === '/api/providers/enroll') {
    const { url, code, allowHttp } = data ?? {};
    if (typeof url === 'string' && typeof code === 'string' && typeof allowHttp === 'boolean')
      return { operation: 'enroll', url, code, allowHttp };
  }
  const preview = /^\/api\/providers\/([\w.:-]+)$/.exec(pathname ?? '');
  if (method === 'GET' && preview) return { operation: 'preview', bridgeId: preview[1]! };
  const removeMatch = /^\/api\/providers\/([\w.:-]+)\/remove$/.exec(pathname ?? '');
  if (method === 'POST' && removeMatch) return { operation: 'remove', bridgeId: removeMatch[1]! };
  const handoverMatch = /^\/api\/providers\/([\w.:-]+)\/handover$/.exec(pathname ?? '');
  if (method === 'POST' && handoverMatch)
    return { operation: 'handover', bridgeId: handoverMatch[1]! };
  const migrationStatus = /^\/api\/providers\/([\w.:-]+)\/migration$/.exec(pathname ?? '');
  if (method === 'GET' && migrationStatus)
    return { operation: 'migrationStatus', bridgeId: migrationStatus[1]! };
  const migrationReview = /^\/api\/providers\/([\w.:-]+)\/migration\/review$/.exec(pathname ?? '');
  if (method === 'POST' && migrationReview)
    return { operation: 'migrationReview', bridgeId: migrationReview[1]! };
  const migrationApply = /^\/api\/providers\/([\w.:-]+)\/migration\/apply$/.exec(pathname ?? '');
  if (
    method === 'POST' &&
    migrationApply &&
    typeof data?.revision === 'string' &&
    Array.isArray(data?.retire) &&
    data.retire.every((value): value is string => typeof value === 'string')
  )
    return {
      operation: 'migrationApply',
      bridgeId: migrationApply[1]!,
      revision: data.revision,
      retire: data.retire,
    };
  const migrationUndo = /^\/api\/providers\/([\w.:-]+)\/migration\/undo$/.exec(pathname ?? '');
  if (method === 'POST' && migrationUndo && typeof data?.revision === 'string')
    return { operation: 'migrationUndo', bridgeId: migrationUndo[1]!, revision: data.revision };
  const loginStateMatch = /^\/api\/providers\/([\w.:-]+)\/login-state$/.exec(pathname ?? '');
  if (method === 'GET' && loginStateMatch) {
    return { operation: 'loginState', bridgeId: loginStateMatch[1]! };
  }
  const loginQrStartMatch = /^\/api\/providers\/([\w.:-]+)\/login\/qr$/.exec(pathname ?? '');
  if (method === 'POST' && loginQrStartMatch) {
    return {
      operation: 'loginQrStart',
      bridgeId: loginQrStartMatch[1]!,
      ...(typeof data?.region === 'string' ? { region: data.region } : {}),
    };
  }
  const loginQrPollMatch = /^\/api\/providers\/([\w.:-]+)\/login\/qr\/poll$/.exec(pathname ?? '');
  if (method === 'GET' && loginQrPollMatch) {
    const token = new URLSearchParams(search).get('token');
    if (token) return { operation: 'loginQrPoll', bridgeId: loginQrPollMatch[1]!, token };
  }
  const importing = /^\/api\/providers\/([\w.:-]+)\/import$/.exec(pathname ?? '');
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
