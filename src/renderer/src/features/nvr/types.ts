export interface NvrNode {
  id: string;
  name: string;
  url: string;
  roles: string[];
  enabled: boolean;
  online?: boolean;
  lastSeen?: number;
  backupCopies: number;
  error?: string;
  remote?: {
    storage: { usedBytes: number; maxBytes: number; freeBytes: number };
    streams: { active: number; max: number };
  };
}
export interface NvrStatus {
  nodes: NvrNode[];
  busy: boolean;
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
  sync: { enabled: boolean; authority: string };
}
export const size = (bytes: number) => {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
};
export async function nvrRequest<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: Record<string, unknown>,
) {
  if (!window.hausNative) throw new Error('Connect your home in the desktop app first.');
  return window.hausNative.helper<T>({ method, path, ...(data ? { data } : {}) });
}
