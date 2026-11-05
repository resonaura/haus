/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { AppArchitecture } from '../manifest.js';
import type { AppPermissionType, AppPolicyViolation } from '../policy.js';

export interface HostCpuMetrics {
  readonly totalPercent: number;
  readonly userPercent: number;
  readonly systemPercent: number;
  readonly cores: number;
  readonly loadAvg: readonly [number, number, number];
}

export interface HostMemoryMetrics {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
  readonly availableBytes: number;
  readonly usedPercent: number;
}

export interface HostSystemInfo {
  readonly platform: 'linux' | 'darwin' | 'win32' | 'unknown';
  readonly arch: AppArchitecture;
  readonly kernelRelease: string;
  readonly hostname: string;
  readonly uptimeSeconds: number;
}

export interface HostMetrics {
  readonly cpu: HostCpuMetrics;
  readonly memory: HostMemoryMetrics;
  readonly system: HostSystemInfo;
}

export interface HostDiskUsage {
  readonly mountPoint: string;
  readonly fsType: string;
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly availableBytes: number;
  readonly usedPercent: number;
}

export interface HostNetworkInterface {
  readonly name: string;
  readonly physical: boolean;
  readonly addresses: readonly {
    readonly ip: string;
    readonly family: 'IPv4' | 'IPv6';
    readonly internal: boolean;
    readonly netmask: string;
  }[];
  readonly mac: string;
  readonly operstate?: 'up' | 'down' | 'unknown';
}

export interface HostDeviceNode {
  readonly path: string;
  readonly type: 'serial' | 'usb' | 'gpu' | 'video' | 'other';
  readonly accessible: boolean;
  readonly description?: string;
}

export interface HostAdapter {
  getMetrics(): Promise<HostMetrics>;
  getDiskUsage(): Promise<readonly HostDiskUsage[]>;
  getNetworkInterfaces(): Promise<readonly HostNetworkInterface[]>;
  getDeviceNodes(): Promise<readonly HostDeviceNode[]>;
  checkDeviceAccess(path: string, mode?: 'r' | 'w' | 'rw'): Promise<boolean>;
}

export enum ContainerTierEnum {
  Ordinary = 'ordinary',
  Simple = 'simple',
  Hardware = 'hardware',
}

export const ContainerTier = ContainerTierEnum;
export type ContainerTier = ContainerTierEnum | `${ContainerTierEnum}`;

export interface HostCapabilityEvaluation {
  readonly tier: ContainerTier;
  readonly compatible: boolean;
  readonly missingCapabilities: readonly string[];
  readonly missingPermissions: readonly AppPermissionType[];
  readonly violations: readonly AppPolicyViolation[];
  readonly evaluatedAt: string;
}
