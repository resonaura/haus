/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type ServerCpuPercentBasis = 'core' | 'host';
export type ServerServiceManager = 'docker' | 'pm2' | 'systemServices';

export const SERVER_GIB = 1024 ** 3;
export const SERVER_STATUS_FRESH_MS = 20_000;
export const SERVER_TELEMETRY_FRESH_MS = 30_000;

export function formatRatioValue(used?: number | null, total?: number | null): number | null {
  if (
    used === undefined ||
    used === null ||
    total === undefined ||
    total === null ||
    !Number.isFinite(used) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(1, used / total));
}

export function isServerStatusFresh(
  receivedAt: number | null,
  failed: boolean,
  now: number,
): boolean {
  return receivedAt !== null && !failed && now - receivedAt < SERVER_STATUS_FRESH_MS;
}

export function isServiceSampleFresh(sampledAt: string | null | undefined, now: number): boolean {
  if (sampledAt === undefined) return true;
  const sampled = sampledAt ? Date.parse(sampledAt) : NaN;
  return (
    Number.isFinite(sampled) && now - sampled < SERVER_TELEMETRY_FRESH_MS && sampled - now < 5_000
  );
}

export function resolveServiceCpuBasis(
  provider:
    | {
        readonly cpuPercentBasis?: ServerCpuPercentBasis | null;
        readonly source?: string | null;
      }
    | null
    | undefined,
  kind: ServerServiceManager,
): ServerCpuPercentBasis | null {
  if (provider && 'cpuPercentBasis' in provider && provider.cpuPercentBasis !== undefined) {
    return provider.cpuPercentBasis ?? null;
  }
  if (kind === 'pm2') return 'core';
  if (
    kind === 'systemServices' &&
    ['systemd', 'windows', 'launchd', 'launchd-user'].includes(provider?.source ?? '')
  ) {
    return 'core';
  }
  return null;
}

/** Convert each provider's declared units once, at the presentation boundary. */
export function normalizeServiceCpuPercent(
  cpu: number | null | undefined,
  basis: ServerCpuPercentBasis | null,
  logicalCores: number | null | undefined,
): number | null {
  const share =
    basis === 'host'
      ? formatRatioValue(cpu, 100)
      : basis === 'core'
        ? formatRatioValue(cpu, logicalCores == null ? null : logicalCores * 100)
        : null;
  return share === null ? null : share * 100;
}

export function formatServiceCpuPercent(cpu: number | null | undefined): string {
  return cpu === null || cpu === undefined || !Number.isFinite(cpu)
    ? '—'
    : `${Math.min(100, Math.max(0, cpu)).toFixed(1)}%`;
}

/**
 * Larger resource fractions gain nonlinear weight ($L_4$ norm), without diluting either input.
 * Matches Electron's `serviceUsageScore` 1:1.
 */
export function computeServiceUsageScore(
  cpuPercent: number | null | undefined,
  memoryBytes: number | null | undefined,
  totalMemoryBytes: number | null | undefined,
): number | null {
  const cpuShare = formatRatioValue(cpuPercent, 100);
  const memoryShare = formatRatioValue(memoryBytes, totalMemoryBytes);
  return cpuShare === null && memoryShare === null
    ? null
    : Math.min(1, ((cpuShare ?? 0) ** 4 + (memoryShare ?? 0) ** 4) ** 0.25);
}

export function computeDuoBarGaugeMetrics(options: {
  readonly cpuPercent: number | null | undefined;
  readonly memoryBytes: number | null | undefined;
  readonly totalMemoryBytes: number | null | undefined;
  readonly system?: boolean;
}): {
  readonly cpuRatio: number | null;
  readonly memoryRatio: number | null;
  readonly usage: number | null;
  readonly pressure: number;
} {
  const cpuRatio = formatRatioValue(options.cpuPercent, 100);
  const memoryRatio = formatRatioValue(options.memoryBytes, options.totalMemoryBytes);
  const usage = options.system
    ? cpuRatio
    : computeServiceUsageScore(options.cpuPercent, options.memoryBytes, options.totalMemoryBytes);
  const pressure = options.system
    ? Math.min(1, ((cpuRatio ?? 0) ** 4 + 0.1 * (memoryRatio ?? 0) ** 4) ** 0.25)
    : Math.max(cpuRatio ?? 0, memoryRatio ?? 0);
  return { cpuRatio, memoryRatio, usage, pressure };
}

export function isServiceRunningStatus(status: string): boolean {
  return ['running', 'started', 'online', 'active', 'activating', 'reloading'].includes(status);
}

export function isServiceFailedStatus(status: string): boolean {
  return ['dead', 'restarting', 'errored', 'failed'].includes(status);
}

export function isGroupedPm2SystemUnit(unitId: string): boolean {
  return /^pm2(?:-[\w.-]+)?\.service$/.test(unitId.replace(/^(windows|wsl):/, ''));
}

export interface ServerServiceGroupSummary {
  readonly id: ServerServiceManager;
  readonly name: string;
  readonly source: string;
  readonly active: number;
  readonly total: number;
  readonly attention: number;
  readonly attentionNames?: string;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
  readonly cpuIncomplete: boolean;
  readonly memoryIncomplete: boolean;
}

function sumAllIfComplete(values: readonly (number | null | undefined)[]): number | null {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
}

function sumKnown(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length === 0
    ? 0
    : known.length > 0
      ? known.reduce((sum, value) => sum + value, 0)
      : null;
}

export function buildServiceGroupSummary(options: {
  readonly id: ServerServiceManager;
  readonly name: string;
  readonly source: string;
  readonly measured: boolean;
  readonly nativeCpuPercent?: number | null;
  readonly nativeMemoryBytes?: number | null;
  readonly rows: readonly {
    readonly name: string;
    readonly running: boolean;
    readonly attention?: boolean;
    readonly cpuPercent: number | null;
    readonly memoryBytes: number | null;
  }[];
}): ServerServiceGroupSummary {
  const active = options.rows.filter((item) => item.running);
  const cpu = options.measured
    ? options.nativeCpuPercent != null
      ? options.nativeCpuPercent
      : sumAllIfComplete(active.map((item) => item.cpuPercent))
    : null;
  const memory = options.measured
    ? (options.nativeMemoryBytes ?? sumAllIfComplete(active.map((item) => item.memoryBytes)))
    : null;
  const partialCpu =
    cpu === null && options.measured ? sumKnown(active.map((item) => item.cpuPercent)) : null;
  const partialMemory =
    memory === null && options.measured ? sumKnown(active.map((item) => item.memoryBytes)) : null;
  const attentionRows = options.rows.filter((item) => item.attention);
  return {
    id: options.id,
    name: options.name,
    source: options.source,
    total: options.rows.length,
    active: active.length,
    attention: attentionRows.length,
    ...(attentionRows.length
      ? { attentionNames: attentionRows.map((item) => item.name).join('\n') }
      : {}),
    cpuPercent: cpu ?? partialCpu,
    memoryBytes: memory ?? partialMemory,
    cpuIncomplete: cpu === null && partialCpu !== null,
    memoryIncomplete: memory === null && partialMemory !== null,
  };
}
