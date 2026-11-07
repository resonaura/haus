/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface HostStorageMedia {
  transport?: string;
  mediaKind?: string;
  removable?: boolean;
  hotplug?: boolean;
}

export interface HostDisk extends HostStorageMedia {
  id: string;
  name: string | null;
  kind: string;
  type: string;
  physical: boolean | null;
  parentId: string | null;
  parentIds: string[];
  mountpoint: string | null;
  filesystem: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  scope: string;
  partitionNumber?: number;
  partitionRole?: string;
  readOnly?: boolean;
  media?: HostStorageMedia;
  mountpoints?: string[];
  device?: string;
}

export interface HostSwap {
  supported: boolean;
  totalBytes: number | null;
  usedBytes: number | null;
}

export interface HostMemory {
  totalBytes: number;
  installedBytes: number | null;
  availableBytes: number;
  usedBytes: number;
}

export interface HostBattery {
  level: number | null;
  charging: boolean | null;
  powerConnected?: boolean;
}

export interface HostDiskPartition {
  name: string;
  mount?: string;
  path?: string;
  filesystem?: string;
  sizeBytes?: number | null;
  usedBytes?: number | null;
  availableBytes?: number | null;
  media?: HostStorageMedia;
}

export interface HostDiskDevice {
  name: string;
  model?: string | null;
  sizeBytes?: number | null;
  transport?: string | null;
  media?: HostStorageMedia;
  partitions: HostDiskPartition[];
}

export interface HostMemoryReport {
  totalBytes: number | null;
  availableBytes: number | null;
  usedBytes: number | null;
  swap?: {
    supported: boolean;
    totalBytes: number | null;
    usedBytes: number | null;
  };
}

export interface HostCpuTimes {
  total: number;
  idle: number;
}

export interface HostCpuReport {
  model?: string | null;
  logicalCores?: number | null;
  physicalCores?: number | null;
  frequencyMhz?: number | null;
  usagePercent?: number | null;
  loadAverage?: [number, number, number];
  cpuTimes?: HostCpuTimes | null;
}

export interface HostBatteryReport {
  present: boolean;
  charging: boolean;
  percent: number | null;
  acOnline?: boolean;
}

export interface HostHardwareReport {
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  board?: string | null;
  biosVersion?: string | null;
}

export interface HostServiceReport {
  name: string;
  active: boolean;
  substate?: string;
  cpuPercent?: number | null;
  memoryBytes?: number | null;
}

export interface HostTelemetryReport {
  collectedAt: number;
  platform: string;
  osRelease?: {
    name?: string;
    version?: string;
    prettyName?: string;
  } | null;
  isContainer?: boolean;
  cpu: HostCpuReport;
  memory: HostMemoryReport;
  disks: HostDiskDevice[];
  battery?: HostBatteryReport | null;
  hardware?: HostHardwareReport | null;
  services?: HostServiceReport[];
}
