/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  buildServiceGroupSummary,
  computeServiceUsageScore,
  formatHostBatteryStatus,
  formatHostMetricsScope,
  formatHostOperatingSystem,
  formatUptime,
  isGroupedPm2SystemUnit,
  isServiceFailedStatus,
  isServiceRunningStatus,
  isServiceSampleFresh,
  normalizeServiceCpuPercent,
  resolveServiceCpuBasis,
  type ServerDiskRecord,
  type ServerNvrSummary,
  type ServerServiceGroupSummary,
  type ServerServiceRow,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import type { HomeServer } from '@haus/core/servers';

export function normalizeHomeServer(server: HomeServer, now = Date.now()): ServerSummaryRecord {
  const host = server.host;
  const osLabel = formatHostOperatingSystem(host);
  const loadValues =
    host?.cpu?.loadAverage?.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ) ?? [];
  const logicalCores = host?.cpu?.logicalCores ?? null;
  const totalMemoryBytes = host?.memory?.totalBytes ?? null;

  const disks: ServerDiskRecord[] = (host?.disks ?? []).map((disk) => ({
    id: disk.id,
    name: disk.name,
    kind: disk.kind,
    type: disk.type,
    physical: disk.physical,
    parentId: disk.parentId,
    ...(disk.parentIds ? { parentIds: disk.parentIds } : {}),
    mountpoint: disk.mountpoint,
    ...(disk.mountpoints ? { mountpoints: disk.mountpoints } : {}),
    filesystem: disk.filesystem,
    totalBytes: disk.totalBytes,
    usedBytes: disk.usedBytes,
    availableBytes: disk.availableBytes,
    scope: disk.scope,
    ...(disk.partitionRole ? { partitionRole: disk.partitionRole } : {}),
    ...(disk.partitionNumber !== undefined ? { partitionNumber: disk.partitionNumber } : {}),
    ...(disk.device ? { device: disk.device } : {}),
    ...(disk.readOnly !== undefined ? { readOnly: disk.readOnly } : {}),
    ...(disk.transport ? { transport: disk.transport } : {}),
    ...(disk.mediaKind ? { mediaKind: disk.mediaKind } : {}),
    ...(disk.removable !== undefined ? { removable: disk.removable } : {}),
    ...(disk.hotplug !== undefined ? { hotplug: disk.hotplug } : {}),
  }));

  const dockerBasis = host ? resolveServiceCpuBasis(host.docker, 'docker') : null;
  const pm2Basis = host ? resolveServiceCpuBasis(host.pm2, 'pm2') : null;
  const sysBasis = host ? resolveServiceCpuBasis(host.systemServices, 'systemServices') : null;
  const hasActivePm2 = Boolean(host?.pm2?.available && (host.pm2.processes?.length ?? 0) > 0);
  const sysSampleFresh = isServiceSampleFresh(host?.systemServices?.sampledAt, now);

  const dockerRows: ServerServiceRow[] = (host?.docker?.containers ?? []).map((c) => {
    const fresh = isServiceSampleFresh(c.sampledAt, now);
    return {
      id: `docker:${c.id}`,
      rawId: c.id,
      name: c.name,
      manager: 'docker',
      running: isServiceRunningStatus(c.state),
      status: c.state,
      statusDetail: c.status,
      subtitle: c.id.slice(0, 12),
      trailing: c.image || 'Unavailable',
      attention: isServiceFailedStatus(c.state) || /\bunhealthy\b/i.test(c.status),
      cpuPercent: fresh
        ? normalizeServiceCpuPercent(c.cpuPercent, dockerBasis, logicalCores)
        : null,
      memoryBytes: fresh ? c.memoryUsedBytes : null,
      uptimeSeconds: null,
    };
  });

  const pm2Rows: ServerServiceRow[] = (host?.pm2?.processes ?? []).map((p) => ({
    id: `pm2:${p.id}`,
    rawId: p.name || String(p.id),
    name: p.name,
    manager: 'pm2',
    running: isServiceRunningStatus(p.status),
    status: p.status,
    subtitle: `PID ${p.pid ?? '—'} · ${p.restarts ?? '—'} restarts`,
    trailing: formatUptime(p.uptimeSeconds),
    attention: isServiceFailedStatus(p.status),
    cpuPercent: normalizeServiceCpuPercent(p.cpuPercent, pm2Basis, logicalCores),
    memoryBytes: p.memoryBytes,
    uptimeSeconds: p.uptimeSeconds,
  }));

  const sysRows: ServerServiceRow[] = (host?.systemServices?.services ?? []).map((s) => ({
    id: `sys:${s.id}`,
    rawId: s.id,
    name: s.name,
    manager: 'systemServices',
    running: isServiceRunningStatus(s.status),
    status: s.status,
    statusDetail: s.detail,
    subtitle: [
      s.domain === 'wsl' ? 'WSL' : s.domain === 'windows' ? 'Windows' : '',
      s.id !== s.name ? s.id.replace(/^(windows|wsl):/, '') : '',
      s.pid ? `PID ${s.pid}` : '',
      s.sharedProcess ? 'Shared process' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    trailing: s.uptimeSeconds === null ? '—' : formatUptime(s.uptimeSeconds),
    attention: isServiceFailedStatus(s.status),
    groupedWithPm2: hasActivePm2 && isGroupedPm2SystemUnit(s.id),
    cpuPercent: sysSampleFresh
      ? normalizeServiceCpuPercent(s.cpuPercent, sysBasis, logicalCores)
      : null,
    memoryBytes: sysSampleFresh ? s.memoryBytes : null,
    uptimeSeconds: s.uptimeSeconds,
  }));

  const services: ServerServiceRow[] = [...dockerRows, ...pm2Rows, ...sysRows];

  const serviceGroups: ServerServiceGroupSummary[] = [
    ...(host?.docker?.available
      ? [
          buildServiceGroupSummary({
            id: 'docker',
            name: 'Docker',
            source: host.docker.source,
            measured: server.online === true,
            rows: dockerRows,
          }),
        ]
      : []),
    ...(host?.pm2?.available
      ? [
          buildServiceGroupSummary({
            id: 'pm2',
            name: 'PM2',
            source: host.pm2.source,
            measured: server.online === true,
            rows: pm2Rows,
          }),
        ]
      : []),
    ...(host?.systemServices?.available
      ? [
          buildServiceGroupSummary({
            id: 'systemServices',
            name: 'System Services',
            source: host.systemServices.source,
            measured: server.online === true && sysSampleFresh,
            nativeCpuPercent:
              host.systemServices.cpuPercent != null
                ? normalizeServiceCpuPercent(host.systemServices.cpuPercent, sysBasis, logicalCores)
                : undefined,
            nativeMemoryBytes: host.systemServices.memoryBytes,
            rows: sysRows,
          }),
        ]
      : []),
  ].sort(
    (a, b) =>
      (computeServiceUsageScore(b.cpuPercent, b.memoryBytes, totalMemoryBytes) ?? -1) -
        (computeServiceUsageScore(a.cpuPercent, a.memoryBytes, totalMemoryBytes) ?? -1) ||
      (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1) ||
      (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1),
  );

  const hasNvr =
    server.kind === 'nvr' ||
    Boolean(server.roles?.some((r) => r === 'storage' || r === 'stream')) ||
    Boolean(
      server.streams || server.playback || server.analysis || server.backupCopies !== undefined,
    );
  const nvr: ServerNvrSummary | undefined = hasNvr
    ? {
        hasNvr: true,
        hasSettings: Boolean(server.settings),
        storageAssigned: Boolean(server.roles?.includes('storage')),
        streamingAssigned: Boolean(server.roles?.includes('stream')),
        ...(server.streams
          ? { activeStreams: `${server.streams.active} / ${server.streams.max}` }
          : {}),
        ...(server.playback
          ? { playbackPrep: `${server.playback.active} / ${server.playback.max}` }
          : {}),
        ...(server.analysis
          ? { activityAssist: `${server.analysis.active} / ${server.analysis.max}` }
          : {}),
        ...(server.backupCopies !== undefined ? { backupCopies: server.backupCopies } : {}),
        usedBytes: server.storage?.usedBytes ?? null,
        limitBytes: server.settings?.storageLimitBytes ?? server.storage?.limitBytes ?? null,
        freeBytes: server.storage?.freeBytes ?? null,
        ...(server.storage && Object.hasOwn(server.storage, 'availableBytes')
          ? { availableBytes: server.storage.availableBytes }
          : {}),
        ...(server.storage?.archivedBytes !== undefined
          ? { archivedBytes: server.storage.archivedBytes }
          : {}),
        ...(server.storage?.cachePolicy ? { cachePolicy: server.storage.cachePolicy } : {}),
        ...(server.storage?.usage !== undefined ? { usage: server.storage.usage } : {}),
      }
    : undefined;

  return {
    id: server.id,
    ...(server.managedId ? { managedId: server.managedId } : {}),
    ...(server.sshServerId ? { sshServerId: server.sshServerId } : {}),
    name: server.name,
    kind: server.kind,
    ...(host?.hostname ? { hostname: host.hostname } : {}),
    ...(host?.platform ? { platform: host.platform } : {}),
    ...(host?.release ? { release: host.release } : {}),
    ...(host?.distribution ? { distribution: host.distribution } : {}),
    ...(host?.operatingSystem?.name || host?.osName
      ? { osName: host?.operatingSystem?.name ?? host?.osName ?? undefined }
      : {}),
    ...(host?.arch ? { architecture: host.arch } : {}),
    ...(host?.scope ? { reportingScope: host.scope } : {}),
    metricsScopeLabel: formatHostMetricsScope(host),
    online: server.online,
    ...(server.monitoringOnline !== undefined ? { monitoringOnline: server.monitoringOnline } : {}),
    enabled: server.enabled !== false,
    local: server.local,
    ...(server.url ? { url: server.url } : {}),
    ...(server.lastSeen !== undefined ? { lastSeen: server.lastSeen } : {}),
    ...(host?.sampledAt ? { sampledAt: host.sampledAt } : {}),
    osLabel,
    cpuModel: host?.cpu?.model?.replace(/\bGfx\b/g, 'GFX') || 'Not reported',
    cpuCores: logicalCores,
    cpuUsage: host?.cpu?.usage ?? null,
    loadAverageLabel: loadValues.length
      ? loadValues.map((value) => value.toFixed(2)).join(' · ')
      : 'Not available',
    memoryUsedBytes: host?.memory?.usedBytes ?? null,
    memoryTotalBytes: totalMemoryBytes,
    memoryInstalledBytes: host?.memory?.installedBytes ?? totalMemoryBytes,
    swapSupported: host?.swap?.supported ?? false,
    swapUsedBytes: host?.swap?.usedBytes ?? null,
    swapTotalBytes: host?.swap?.totalBytes ?? null,
    uptimeSeconds: host?.uptimeSeconds ?? null,
    ...(host?.battery
      ? {
          batteryLevel: host.battery.level,
          batteryCharging: Boolean(host.battery.charging || host.battery.powerConnected),
          batteryStatusLabel: formatHostBatteryStatus(host.battery) || undefined,
        }
      : {}),
    ...(host?.gpus?.available && host.gpus.adapters.length
      ? {
          graphics: host.gpus.adapters.map((g) => ({
            id: g.id,
            name: g.name,
            vendor: g.vendor,
            driver: g.driver,
            kind: g.kind,
            memoryBytes: g.memoryBytes,
          })),
        }
      : {}),
    disks,
    services,
    serviceGroups,
    ...(nvr ? { nvr } : {}),
    ...(server.error ? { error: server.error } : {}),
  };
}
