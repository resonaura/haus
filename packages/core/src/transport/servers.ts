/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  computeServerDiskSpace,
  orderServerDisks,
  serverDiskDepth,
  serverDiskDisplayName,
  serverDiskTreeSubtitle,
  serverPartitionPurpose,
  serverStorageMediaLabel,
  summarizeServerDisks,
  visibleServerDisks,
  type ServerDiskMediaKind,
  type ServerDiskPartitionRole,
  type ServerDiskRecord,
  type ServerDiskSpace,
  type ServerDiskSpaceSegment,
} from './servers/disks.js';
import { buildDemoServersState, runDemoTerminalCommand } from './servers/demo.js';
import {
  formatHostBatteryStatus,
  formatHostMetricsScope,
  formatHostOperatingSystem,
  isServerIconId,
  resolveServerIcon,
  sanitizeServerIcon,
  serverIconOptions,
  type ServerIconId,
  type ServerIconSource,
} from './servers/icons.js';
import {
  buildServiceGroupSummary,
  computeDuoBarGaugeMetrics,
  computeServiceUsageScore,
  formatRatioValue,
  formatServiceCpuPercent,
  isGroupedPm2SystemUnit,
  isServerStatusFresh,
  isServiceFailedStatus,
  isServiceRunningStatus,
  isServiceSampleFresh,
  normalizeServiceCpuPercent,
  resolveServiceCpuBasis,
  SERVER_GIB,
  SERVER_STATUS_FRESH_MS,
  SERVER_TELEMETRY_FRESH_MS,
  type ServerCpuPercentBasis,
  type ServerServiceGroupSummary,
  type ServerServiceManager,
} from './servers/metrics.js';

export {
  buildDemoServersState,
  buildServiceGroupSummary,
  computeDuoBarGaugeMetrics,
  computeServerDiskSpace,
  computeServiceUsageScore,
  formatHostBatteryStatus,
  formatHostMetricsScope,
  formatHostOperatingSystem,
  formatServiceCpuPercent,
  isGroupedPm2SystemUnit,
  isServerIconId,
  isServerStatusFresh,
  isServiceFailedStatus,
  isServiceRunningStatus,
  isServiceSampleFresh,
  normalizeServiceCpuPercent,
  orderServerDisks,
  resolveServerIcon,
  resolveServiceCpuBasis,
  runDemoTerminalCommand,
  sanitizeServerIcon,
  SERVER_GIB,
  SERVER_STATUS_FRESH_MS,
  SERVER_TELEMETRY_FRESH_MS,
  serverDiskDepth,
  serverDiskDisplayName,
  serverDiskTreeSubtitle,
  serverIconOptions,
  serverPartitionPurpose,
  serverStorageMediaLabel,
  summarizeServerDisks,
  visibleServerDisks,
  type ServerCpuPercentBasis,
  type ServerDiskMediaKind,
  type ServerDiskPartitionRole,
  type ServerDiskRecord,
  type ServerDiskSpace,
  type ServerDiskSpaceSegment,
  type ServerIconId,
  type ServerIconSource,
  type ServerServiceGroupSummary,
  type ServerServiceManager,
};

export type ServerKind = 'hub' | 'nvr' | 'home-assistant' | 'ssh';

export type ServerDetailTabId =
  'overview' | 'storage' | 'services' | 'nvr' | 'logs' | 'terminal' | 'settings';

export type ServerConnectionState = 'online' | 'paused' | 'offline' | 'unknown';

export interface ServerServiceRow {
  readonly id: string;
  readonly rawId?: string;
  readonly name: string;
  readonly manager: ServerServiceManager;
  readonly running: boolean;
  readonly status: string;
  readonly statusDetail?: string;
  readonly subtitle?: string;
  readonly trailing?: string;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly uptimeSeconds: number | null;
  readonly attention?: boolean;
  readonly groupedWithPm2?: boolean;
}

export interface HausStorageCategoryRecord {
  readonly id: string;
  readonly logicalBytes: number;
  readonly allocatedBytes: number | null;
  readonly files: number;
}

export interface HausStorageUsageRecord {
  readonly sampledAt: number;
  readonly complete: boolean;
  readonly logicalBytes: number | null;
  readonly allocatedBytes: number | null;
  readonly files?: number;
  readonly duplicateFiles?: number;
  readonly categories: readonly HausStorageCategoryRecord[];
}

export interface ServerNvrSummary {
  readonly hasNvr: boolean;
  readonly storageAssigned: boolean;
  readonly streamingAssigned: boolean;
  readonly activeStreams?: string;
  readonly playbackPrep?: string;
  readonly activityAssist?: string;
  readonly backupCopies?: number;
  readonly usedBytes?: number | null;
  readonly limitBytes?: number | null;
  readonly freeBytes?: number | null;
  readonly availableBytes?: number | null;
  readonly archivedBytes?: number;
  readonly cachePolicy?: 'verified-archive';
  readonly hasSettings?: boolean;
  readonly livePriority?: number;
  readonly usage?: HausStorageUsageRecord | null;
}

export interface ServerGraphicsAdapterRecord {
  readonly id?: string;
  readonly name: string;
  readonly vendor?: string | null;
  readonly driver?: string | null;
  readonly kind?: 'integrated' | 'discrete' | 'external' | 'software' | null;
  readonly utilization?: number | null;
  readonly memoryBytes?: number | null;
  readonly memoryUsedBytes?: number | null;
  readonly memoryTotalBytes?: number | null;
}

export interface ServerResourceSample {
  readonly time: number;
  readonly cpu: number | null;
  readonly memory: number | null;
  readonly swap: number | null;
}

export interface ServerRoomOption {
  readonly id: string;
  readonly name: string;
}

export interface ServerIdentityPatch {
  readonly name: string;
  readonly areaId?: string;
  readonly icon?: ServerIconId;
  readonly favorite?: boolean;
  readonly hidden?: boolean;
}

export interface ServerSummaryRecord {
  readonly id: string;
  readonly managedId?: string;
  readonly sshServerId?: string;
  readonly name: string;
  readonly kind: ServerKind;
  readonly roomId?: string;
  readonly roomName?: string;
  readonly icon?: string;
  readonly favorite?: boolean;
  readonly hostname?: string;
  readonly platform?: string;
  readonly release?: string;
  readonly distribution?: string;
  readonly osName?: string;
  readonly architecture?: string;
  readonly reportingScope?: 'host' | 'container';
  readonly metricsScopeLabel?: string;
  readonly online: boolean | null;
  readonly monitoringOnline?: boolean;
  readonly enabled: boolean;
  readonly local?: boolean;
  readonly url?: string;
  readonly lastSeen?: number | string;
  readonly sampledAt?: string;
  readonly osLabel: string;
  readonly cpuModel: string;
  readonly cpuCores: number | null;
  readonly cpuUsage: number | null;
  readonly loadAverageLabel: string;
  readonly memoryUsedBytes: number | null;
  readonly memoryTotalBytes: number | null;
  readonly memoryInstalledBytes?: number | null;
  readonly swapSupported?: boolean;
  readonly swapUsedBytes?: number | null;
  readonly swapTotalBytes?: number | null;
  readonly uptimeSeconds: number | null;
  readonly batteryLevel?: number | null;
  readonly batteryCharging?: boolean;
  readonly batteryStatusLabel?: string;
  readonly graphics?: readonly ServerGraphicsAdapterRecord[];
  readonly disks: readonly ServerDiskRecord[];
  readonly services: readonly ServerServiceRow[];
  readonly serviceGroups?: readonly ServerServiceGroupSummary[];
  readonly nvr?: ServerNvrSummary;
  readonly error?: string;
}

export interface DemoServersState {
  readonly servers: readonly ServerSummaryRecord[];
  readonly logsByServerId: Readonly<Record<string, string>>;
  readonly historyByServerId?: Readonly<Record<string, readonly ServerResourceSample[]>>;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 || unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

export function formatRatio(used?: number | null, total?: number | null): number | null {
  return formatRatioValue(used, total);
}

export function formatPercent(ratio?: number | null): string {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export function formatUptime(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const whole = Math.floor(seconds);
  const days = Math.floor(whole / 86_400);
  const hours = Math.floor((whole % 86_400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function stripAnsiSequences(input: string): string {
  let result = '';
  let i = 0;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    if (code === 0x1b) {
      const next = input[i + 1];
      if (next === '[') {
        i += 2;
        while (i < input.length && !/@|~|[A-Za-z]/.test(input[i] ?? '')) i += 1;
        i += 1;
        continue;
      }
      if (next === ']') {
        i += 2;
        while (i < input.length) {
          if (input.charCodeAt(i) === 0x07) {
            i += 1;
            break;
          }
          if (input.charCodeAt(i) === 0x1b && input[i + 1] === '\\') {
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
      i += 2;
      continue;
    }
    if (code === 0x0d) {
      i += 1;
      continue;
    }
    result += input[i] ?? '';
    i += 1;
  }
  return result;
}

export function appendTerminalOutput(existing: string, chunk: string, maxLines = 400): string {
  const clean = stripAnsiSequences(chunk);
  if (!clean) return existing;
  const combined = existing + clean;
  const lines = combined.split('\n');
  if (lines.length <= maxLines) return combined;
  return lines.slice(lines.length - maxLines).join('\n');
}

export function resolveServerConnectionState(server: {
  readonly online: boolean | null;
  readonly enabled?: boolean;
}): ServerConnectionState {
  if (server.enabled === false) return 'paused';
  if (server.online === true) return 'online';
  if (server.online === false) return 'offline';
  return 'unknown';
}

export function computeStorageQuotaRangeGib(server: ServerSummaryRecord): number {
  const disk = server.disks.find((item) => item.availableBytes !== null);
  const available = server.nvr?.freeBytes ?? disk?.availableBytes ?? 0;
  const used = server.nvr?.usedBytes ?? 0;
  const current = server.nvr?.limitBytes ?? 0;
  return Math.max(1, Math.ceil((available + used) / SERVER_GIB), Math.ceil(current / SERVER_GIB));
}
