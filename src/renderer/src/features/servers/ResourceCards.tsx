import { Cpu, MemoryStick, ArrowLeftRight, Clock3 } from 'lucide-react';
import { bytes, percent, ratio, uptime } from './presentation';
import type { HomeServer, ResourceSample } from './types';
import { hostMetricsScope } from './host-system';

function Sparkline({ values }: { values: (number | null)[] }) {
  const parts: string[] = [];
  let continuous = false;
  values.forEach((value, index) => {
    if (value === null) {
      continuous = false;
      return;
    }
    const x = (index / Math.max(59, values.length - 1)) * 200;
    parts.push(
      `${continuous ? 'L' : 'M'}${x.toFixed(1)},${(39 - Math.min(1, Math.max(0, value)) * 35).toFixed(1)}`,
    );
    continuous = true;
  });
  return (
    <svg
      className="server-sparkline"
      viewBox="0 0 200 42"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={parts.join(' ')} />
    </svg>
  );
}
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
      values: history.map((item) => item.cpu),
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
      values: history.map((item) => item.memory),
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
      values: history.map((item) => item.swap),
    },
    {
      label: 'Uptime',
      Icon: Clock3,
      value: fresh && host?.uptimeSeconds !== null ? uptime(host?.uptimeSeconds) : '—',
      detail: hostMetricsScope(host ?? null),
      values: [],
    },
  ];
  return (
    <div className="server-resource-grid">
      {resources.map(({ label, Icon, value, detail, values }) => (
        <article className="server-resource" key={label}>
          <div className="server-resource-label">
            <Icon size={16} />
            <span>{label}</span>
          </div>
          <strong>{value}</strong>
          <p>{detail}</p>
          <Sparkline values={values} />
        </article>
      ))}
    </div>
  );
}
