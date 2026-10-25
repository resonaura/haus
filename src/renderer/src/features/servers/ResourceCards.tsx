import { Cpu, MemoryStick, ArrowLeftRight, Clock3 } from 'lucide-react';
import { bytes, percent, ratio, uptime } from './presentation';
import type { HomeServer, ResourceSample } from './types';
import { hostMetricsScope } from './host-system';
import { ResourceSparkline } from './ResourceSparkline';

export function ResourceCards({
  server,
  history,
  fresh,
}: {
  server: HomeServer;
  history: ResourceSample[];
  fresh: boolean;
}) {
  const host = server.host;
  const cpu = fresh ? host?.cpu.usage : null;
  const memory = fresh ? ratio(host?.memory.usedBytes, host?.memory.totalBytes) : null;
  const swap = host?.swap;
  const swapRatio = fresh && swap?.supported ? ratio(swap.usedBytes, swap.totalBytes) : null;
  const resources = [
    {
      label: 'Processor',
      Icon: Cpu,
      value: percent(cpu),
      detail: host?.cpu.logicalCores
        ? `${host.cpu.logicalCores} logical cores`
        : 'Core count unavailable',
      field: 'cpu' as const,
    },
    {
      label: 'Memory',
      Icon: MemoryStick,
      value: percent(memory),
      detail:
        host && fresh && host.memory.usedBytes !== null && host.memory.totalBytes !== null
          ? `${bytes(host.memory.usedBytes)} of ${bytes(host.memory.totalBytes)}`
          : host?.memory.totalBytes
            ? `${bytes(host.memory.totalBytes)} total · last known`
            : 'Memory information unavailable',
      field: 'memory' as const,
    },
    {
      label: 'Swap',
      Icon: ArrowLeftRight,
      value: fresh && swap?.supported && swap.usedBytes !== null ? bytes(swap.usedBytes) : '—',
      detail:
        swap?.supported && fresh
          ? swap.totalBytes === 0
            ? 'Swap is not configured'
            : `${bytes(swap.totalBytes)} total · ${percent(swapRatio)} used`
          : swap?.supported
            ? 'Waiting for a fresh sample'
            : 'Not reported by this server',
      field: 'swap' as const,
    },
    {
      label: 'Uptime',
      Icon: Clock3,
      value: fresh && host?.uptimeSeconds !== null ? uptime(host?.uptimeSeconds) : '—',
      detail: hostMetricsScope(host ?? null),
      field: undefined,
    },
  ];
  return (
    <div className="server-resource-grid">
      {resources.map(({ label, Icon, value, detail, field }) => (
        <article className="server-resource" key={label}>
          <div className="server-resource-label">
            <Icon size={16} />
            <span>{label}</span>
          </div>
          <strong>{value}</strong>
          <p>{detail}</p>
          {field && <ResourceSparkline history={history} field={field} />}
        </article>
      ))}
    </div>
  );
}
