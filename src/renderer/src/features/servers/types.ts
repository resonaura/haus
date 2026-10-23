export interface ServerDisk {
  id: string;
  name: string;
  kind: 'disk' | 'volume';
  parentId: string | null;
  mountpoint: string | null;
  filesystem: string | null;
  totalBytes: number;
  usedBytes: number | null;
  availableBytes: number | null;
  scope: 'host' | 'container';
}
export interface ServerHost {
  sampledAt: string;
  scope: 'host' | 'container';
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimeSeconds: number;
  cpu: {
    model: string;
    logicalCores: number;
    usage: number | null;
    loadAverage: number[];
  };
  memory: { totalBytes: number; availableBytes: number; usedBytes: number };
  swap: { supported: boolean; totalBytes: number | null; usedBytes: number | null };
  disks: ServerDisk[];
  docker: {
    available: boolean;
    source: string;
    containers: {
      id: string;
      name: string;
      image: string;
      state: string;
      status: string;
      cpuPercent: number | null;
      memoryUsedBytes: number | null;
      memoryLimitBytes: number | null;
    }[];
  };
  pm2: {
    available: boolean;
    source: string;
    processes: {
      id: number | string;
      name: string;
      status: string;
      pid: number | null;
      cpuPercent: number | null;
      memoryBytes: number | null;
      uptimeSeconds: number | null;
      restarts: number | null;
    }[];
  };
}
export interface HomeServer {
  id: string;
  kind: 'home-assistant' | 'nvr';
  name: string;
  online: boolean;
  lastSeen?: number | string;
  host: ServerHost | null;
  storage?: {
    usedBytes: number;
    maxBytes?: number | null;
    limitBytes?: number | null;
    freeBytes?: number;
    availableBytes?: number;
  } | null;
  url?: string;
  enabled?: boolean;
  roles?: string[];
  settings?: { storageLimitBytes: number | null };
  error?: string;
}
export interface ServersStatus {
  servers: HomeServer[];
  sampledAt: number | string;
}
export interface ResourceSample {
  time: number;
  cpu: number | null;
  memory: number | null;
  swap: number | null;
}
