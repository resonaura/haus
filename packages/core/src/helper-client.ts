import { validateHelperRequest, type HelperRequest } from './helper-request.js';
import type { ServersStatus } from './server-types.js';

export interface HelperPort {
  request<T>(request: HelperRequest): Promise<T>;
}
export interface ClusterStatus {
  backups: {
    items: { digest: string; kind: 'haus' | 'ha'; createdAt: number; bytes: number }[];
    busy: boolean;
    error?: string;
  };
}

/** Authenticated native/mobile port, with the same operation allowlist as Electron main. */
export class HausClient {
  private generation = 0;
  private disposed = false;
  constructor(private readonly port: HelperPort) {}

  async request<T>(input: HelperRequest): Promise<T> {
    if (this.disposed) throw new Error('session-changed');
    const generation = this.generation;
    const request = validateHelperRequest(input);
    try {
      const response = await this.port.request<T>(request);
      if (generation !== this.generation) throw new Error('session-changed');
      return response;
    } catch (error) {
      if (generation !== this.generation) throw new Error('session-changed');
      throw error;
    }
  }

  servers(): Promise<ServersStatus> {
    return this.request({ method: 'GET', path: '/api/servers' });
  }
  cluster(): Promise<ClusterStatus> {
    return this.request({ method: 'GET', path: '/api/cluster' });
  }
  async setStorageLimit(serverId: string, bytes: number | null): Promise<ServersStatus> {
    if (serverId !== 'home-assistant' && !/^[a-f0-9-]{36}$/.test(serverId))
      throw new Error('invalid-server');
    const path =
      serverId === 'home-assistant'
        ? '/api/servers/home-assistant'
        : `/api/cluster/nodes/${serverId}`;
    await this.request({ method: 'PATCH', path, data: { storageLimitBytes: bytes } });
    const status = await this.servers();
    if (
      status.servers.find((server) => server.id === serverId)?.settings?.storageLimitBytes !== bytes
    )
      throw new Error('storage-limit-unconfirmed');
    return status;
  }
  dispose(): void {
    this.disposed = true;
    ++this.generation;
  }
}
