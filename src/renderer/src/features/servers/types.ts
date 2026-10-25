export type ServerCpuPercentBasis = 'core' | 'host';

export interface ServerDisk {
  id: string;
  name: string;
  kind: 'disk' | 'volume';
  type?: 'disk' | 'partition' | 'container' | 'volume';
  physical?: boolean | null;
  parentId: string | null;
  parentIds?: string[];
  mountpoint: string | null;
  filesystem: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  scope: 'host' | 'container';
  partitionRole?:
    | 'efi'
    | 'reserved'
    | 'recovery'
    | 'data'
    | 'boot'
    | 'system'
    | 'kernel'
    | 'boot-state'
    | 'overlay'
    | 'swap'
    | 'home'
    | 'lvm'
    | 'raid'
    | 'encrypted';
  partitionNumber?: number;
  device?: string;
  mountpoints?: string[];
  readOnly?: boolean;
  transport?: string;
  mediaKind?: 'hdd' | 'ssd' | 'solid-state' | 'flash' | 'sd' | 'mmc' | 'optical';
  removable?: boolean;
  hotplug?: boolean;
}
export interface ServerHost {
  sampledAt: string;
  scope: 'host' | 'container';
  hostname: string | null;
  platform: string | null;
  distribution?: string | null;
  osName?: string | null;
  operatingSystem?: {
    name: string;
    version: string;
    build: string;
    architecture: string;
    platform: string;
    source: string;
  };
  metricsScope?: 'wsl' | 'windows';
  serviceScope?: 'wsl';
  runtime?: { kind: 'wsl'; platform: 'linux'; release: string };
  gpus?: {
    available: boolean;
    source: string;
    sampledAt?: string;
    adapters: {
      id: string;
      name: string;
      vendor: string | null;
      driver: string | null;
      kind: 'integrated' | 'discrete' | 'external' | 'software' | null;
      memoryBytes: number | null;
    }[];
  };
  release: string | null;
  arch: string | null;
  uptimeSeconds: number | null;
  battery?: {
    level: number | null;
    charging: boolean | null;
    powerConnected?: boolean | null;
  } | null;
  cpu: {
    model: string | null;
    logicalCores: number | null;
    usage: number | null;
    loadAverage: (number | null)[];
  };
  memory: {
    totalBytes: number | null;
    installedBytes?: number | null;
    availableBytes: number | null;
    usedBytes: number | null;
  };
  swap: { supported: boolean; totalBytes: number | null; usedBytes: number | null };
  disks: ServerDisk[];
  docker: {
    available: boolean;
    source: string;
    cpuPercentBasis?: ServerCpuPercentBasis | null;
    containers: {
      id: string;
      name: string;
      image: string | null;
      state: string;
      status: string;
      cpuPercent: number | null;
      memoryUsedBytes: number | null;
      memoryLimitBytes: number | null;
      sampledAt?: string | null;
    }[];
  };
  pm2: {
    available: boolean;
    source: string;
    cpuPercentBasis?: ServerCpuPercentBasis | null;
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
  systemServices?: {
    available: boolean;
    source: string;
    cpuPercentBasis?: ServerCpuPercentBasis | null;
    sampledAt?: string | null;
    cpuPercent?: number | null;
    memoryBytes?: number | null;
    services: {
      id: string;
      name: string;
      status: string;
      detail?: string;
      pid: number | null;
      cpuPercent: number | null;
      memoryBytes: number | null;
      uptimeSeconds: number | null;
      sharedProcess?: boolean;
      domain?: 'windows' | 'wsl';
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
    cachePolicy?: 'verified-archive';
    archivedBytes?: number;
    archivedEvents?: number;
    usedBytes: number;
    maxBytes?: number | null;
    limitBytes?: number | null;
    freeBytes?: number | null;
    availableBytes?: number | null;
  } | null;
  url?: string;
  enabled?: boolean;
  roles?: string[];
  streams?: { active: number; max: number };
  analysis?: { active: number; max: number };
  playback?: { active: number; max: number };
  backupCopies?: number;
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
