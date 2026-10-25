import { ratio } from './presentation';
import type { ServerCpuPercentBasis, ServerHost } from './types';

export function serviceCpuBasis(
  host: ServerHost,
  kind: 'docker' | 'pm2' | 'systemServices',
): ServerCpuPercentBasis | null {
  const provider = host[kind];
  if (provider && 'cpuPercentBasis' in provider) return provider.cpuPercentBasis ?? null;
  // Older, known contracts. Never infer a Docker engine's OS from its client platform.
  if (kind === 'pm2') return 'core';
  if (
    kind === 'systemServices' &&
    ['systemd', 'windows', 'launchd', 'launchd-user'].includes(provider?.source ?? '')
  )
    return 'core';
  return null;
}

/** Convert each provider's declared units once, at the presentation boundary. */
export function normalizeServiceCpu(
  cpu: number | null,
  basis: ServerCpuPercentBasis | null,
  logicalCores: number | null,
) {
  const share =
    basis === 'host'
      ? ratio(cpu, 100)
      : basis === 'core'
        ? ratio(cpu, logicalCores === null ? null : logicalCores * 100)
        : null;
  return share === null ? null : share * 100;
}

export function serviceCpuPercent(cpu: number | null) {
  return cpu === null ? '—' : `${Math.min(100, Math.max(0, cpu)).toFixed(1)}%`;
}

/** Larger resource fractions gain nonlinear weight, without diluting either input. */
export function serviceUsageScore(
  cpu: number | null,
  memory: number | null,
  totalMemory: number | null,
) {
  const cpuShare = ratio(cpu, 100);
  const memoryShare = ratio(memory, totalMemory);
  return cpuShare === null && memoryShare === null
    ? null
    : Math.min(1, ((cpuShare ?? 0) ** 4 + (memoryShare ?? 0) ** 4) ** 0.25);
}
