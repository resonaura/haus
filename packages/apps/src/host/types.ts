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

/** Hardware device classes evaluated for standalone Haus hosting. */
export enum HardwareClassEnum {
  RaspberryPiArm64 = 'rpi_arm64',
  IntelAmd64MiniPc = 'intel_amd64_mini',
}
export const HardwareClass = HardwareClassEnum;
export type HardwareClass = HardwareClassEnum | `${HardwareClassEnum}`;

/** Host operating system targets evaluated against actual hardware constraints. */
export enum HostOsTargetEnum {
  DebianUbuntuDocker = 'debian_ubuntu_docker',
  AlpineDocker = 'alpine_docker',
  HaosHost = 'haos_host',
}
export const HostOsTarget = HostOsTargetEnum;
export type HostOsTarget = HostOsTargetEnum | `${HostOsTargetEnum}`;

/** Evaluation of an OS against a specific hardware constraint category. */
export interface HostConstraintEvaluation {
  readonly score: number; // 0..10
  readonly supported: boolean;
  readonly directHardwareAccess: boolean;
  readonly limitations: readonly string[];
  readonly advantages: readonly string[];
}

/** Comprehensive profile of a host OS target. */
export interface HostOsProfile {
  readonly os: HostOsTarget;
  readonly name: string;
  readonly storage: HostConstraintEvaluation;
  readonly multicast: HostConstraintEvaluation;
  readonly ipv6Thread: HostConstraintEvaluation;
  readonly radios: HostConstraintEvaluation;
  readonly hardwareAcceleration: HostConstraintEvaluation;
  readonly recovery: HostConstraintEvaluation;
  readonly overallScore: number;
  readonly recommended: boolean;
  readonly standaloneCapable: boolean;
}

/** Comparative matrix for a hardware class across candidate host operating systems. */
export interface HardwareSupportComparison {
  readonly hardware: HardwareClass;
  readonly hardwareName: string;
  readonly profiles: readonly HostOsProfile[];
  readonly recommendedTarget: HostOsTarget;
  readonly standaloneLinuxProven: boolean;
  readonly rationale: string;
}
