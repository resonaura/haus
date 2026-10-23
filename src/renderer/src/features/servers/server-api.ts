import type { ServersStatus } from './types';
import { serverErrorMessage } from './server-errors';

export interface ClusterStatus {
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
}

export async function serverRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
) {
  if (!window.hausNative) throw new Error('Connect your home in the desktop app first.');
  try {
    return await window.hausNative.helper<T>({ method, path, ...(data ? { data } : {}) });
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
