import { serviceSampleIsFresh } from './presentation';
import { normalizeServiceCpu, serviceCpuBasis, serviceUsageScore } from './service-usage-score';
import type { ServerHost } from './types';

export type ServiceKind = 'docker' | 'pm2' | 'systemServices';

export const isServiceRunning = (status: string) =>
  ['running', 'started', 'online', 'active', 'activating', 'reloading'].includes(status);
const failed = (status: string) => ['dead', 'restarting', 'errored', 'failed'].includes(status);
const total = (values: (number | null | undefined)[]) =>
  values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce<number>((sum, value) => sum + value!, 0)
    : null;
const knownTotal = (values: (number | null | undefined)[]) => {
  const known = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return !values.length ? 0 : known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

export function serviceActivity(host: ServerHost | null, fresh: boolean, now: number) {
  if (!host) return [];
  return [
    {
      id: 'docker' as const,
      name: 'Docker',
      available: host.docker.available,
      source: host.docker.source,
      rows: host.docker.containers.map((item) => ({
        name: item.name,
        status: item.state,
        attention: failed(item.state) || /\bunhealthy\b/i.test(item.status),
        cpu: serviceSampleIsFresh(item.sampledAt, now)
          ? normalizeServiceCpu(
              item.cpuPercent,
              serviceCpuBasis(host, 'docker'),
              host.cpu.logicalCores,
            )
          : null,
        memory: serviceSampleIsFresh(item.sampledAt, now) ? item.memoryUsedBytes : null,
      })),
    },
    {
      id: 'pm2' as const,
      name: 'PM2',
      available: host.pm2.available,
      source: host.pm2.source,
      rows: host.pm2.processes.map((item) => ({
        name: item.name,
        status: item.status,
        attention: failed(item.status),
        cpu: normalizeServiceCpu(
          item.cpuPercent,
          serviceCpuBasis(host, 'pm2'),
          host.cpu.logicalCores,
        ),
        memory: item.memoryBytes,
      })),
    },
    {
      id: 'systemServices' as const,
      name: 'System Services',
      available: host.systemServices?.available === true,
      source: host.systemServices?.source ?? '',
      rows: (host.systemServices?.services ?? []).map((item) => ({
        name: item.id,
        status: item.status,
        attention: failed(item.status),
        cpu: serviceSampleIsFresh(host.systemServices?.sampledAt, now)
          ? normalizeServiceCpu(
              item.cpuPercent,
              serviceCpuBasis(host, 'systemServices'),
              host.cpu.logicalCores,
            )
          : null,
        memory: serviceSampleIsFresh(host.systemServices?.sampledAt, now) ? item.memoryBytes : null,
      })),
    },
  ]
    .filter((group) => group.available)
    .map((group) => {
      const active = group.rows.filter((item) => isServiceRunning(item.status));
      const native = group.id === 'systemServices' ? host.systemServices : undefined;
      const measured = fresh && (!native || serviceSampleIsFresh(native.sampledAt, now));
      const cpu = measured
        ? native?.cpuPercent != null
          ? normalizeServiceCpu(
              native.cpuPercent,
              serviceCpuBasis(host, 'systemServices'),
              host.cpu.logicalCores,
            )
          : total(active.map((item) => item.cpu))
        : null;
      const memory = measured
        ? (native?.memoryBytes ?? total(active.map((item) => item.memory)))
        : null;
      const partialCpu =
        cpu === null && measured ? knownTotal(active.map((item) => item.cpu)) : null;
      const partialMemory =
        memory === null && measured ? knownTotal(active.map((item) => item.memory)) : null;
      return {
        ...group,
        total: group.rows.length,
        active: active.length,
        attention: group.rows.filter((item) => item.attention).length,
        attentionNames: group.rows
          .filter((item) => item.attention)
          .map((item) => item.name)
          .join('\n'),
        cpu: cpu ?? partialCpu,
        memory: memory ?? partialMemory,
        cpuIncomplete: cpu === null && partialCpu !== null,
        memoryIncomplete: memory === null && partialMemory !== null,
      };
    })
    .sort(
      (a, b) =>
        (serviceUsageScore(b.cpu, b.memory, host.memory.totalBytes) ?? -1) -
          (serviceUsageScore(a.cpu, a.memory, host.memory.totalBytes) ?? -1) ||
        (b.cpu ?? -1) - (a.cpu ?? -1) ||
        (b.memory ?? -1) - (a.memory ?? -1),
    );
}
