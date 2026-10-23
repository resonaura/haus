import { useState } from 'react';
import { ArrowDown, ArrowUp, Box, Workflow } from 'lucide-react';
import { Button } from '@heroui/react';
import { bytes, serviceSampleIsFresh, uptime } from './presentation';
import type { ServerHost } from './types';
import {
  sortServerServiceRows,
  type ServerServiceRow,
  type ServerServiceSortKey,
} from './server-services-sort';

interface DisplayServiceRow extends ServerServiceRow {
  subtitle: string;
  statusDetail: string;
  trailing: string;
}

export function ServerServices({
  host,
  lastKnown = false,
  now = Date.now(),
}: {
  host: ServerHost;
  lastKnown?: boolean;
  now?: number;
}) {
  const [tab, setTab] = useState<'docker' | 'pm2'>('docker');
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<{
    key: ServerServiceSortKey;
    direction: 'ascending' | 'descending';
  }>({ key: 'name', direction: 'ascending' });
  const service = host[tab];
  const count = tab === 'docker' ? host.docker.containers.length : host.pm2.processes.length;
  const rows: DisplayServiceRow[] =
    tab === 'docker'
      ? host.docker.containers.map((item) => {
          const sampleFresh = !lastKnown && serviceSampleIsFresh(item.sampledAt, now);
          return {
            id: item.id,
            name: item.name,
            status: item.state,
            cpu: sampleFresh ? item.cpuPercent : null,
            memory: sampleFresh ? item.memoryUsedBytes : null,
            extra: item.image || 'Unavailable',
            subtitle: item.id.slice(0, 12),
            statusDetail: item.status,
            trailing: item.image || 'Unavailable',
          };
        })
      : host.pm2.processes.map((item) => ({
          id: String(item.id),
          name: item.name,
          status: item.status,
          cpu: lastKnown ? null : item.cpuPercent,
          memory: lastKnown ? null : item.memoryBytes,
          extra: item.uptimeSeconds,
          subtitle: `PID ${item.pid ?? '—'} · ${item.restarts ?? '—'} restarts`,
          statusDetail: '',
          trailing: uptime(item.uptimeSeconds),
        }));
  const sortedRows = sortServerServiceRows(rows, sort.key, sort.direction);
  const sortHeader = (key: ServerServiceSortKey, label: string) => (
    <th aria-sort={sort.key === key ? sort.direction : 'none'}>
      <button
        type="button"
        className="server-sort-button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key && current.direction === 'ascending' ? 'descending' : 'ascending',
          }))
        }
      >
        {label}
        {sort.key === key &&
          (sort.direction === 'ascending' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );
  return (
    <section className="server-panel server-services">
      <div className="server-section-heading">
        <h3>Services{lastKnown && <small className="server-last-known">Last known</small>}</h3>
        <span>
          {tab === 'docker' && service.source === 'supervisor'
            ? 'Home Assistant managed'
            : service.source === 'host-collector'
              ? 'Server reported'
              : ''}
        </span>
      </div>
      <div className="server-service-tabs" aria-label="Service type">
        <Button
          variant={tab === 'docker' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'docker'}
          onPress={() => {
            setTab('docker');
            setExpanded(false);
          }}
        >
          <Box size={16} />
          Docker <span>{host.docker.available ? host.docker.containers.length : '—'}</span>
        </Button>
        <Button
          variant={tab === 'pm2' ? 'secondary' : 'ghost'}
          aria-pressed={tab === 'pm2'}
          onPress={() => {
            setTab('pm2');
            setExpanded(false);
          }}
        >
          <Workflow size={16} />
          PM2 <span>{host.pm2.available ? host.pm2.processes.length : '—'}</span>
        </Button>
      </div>
      {!service.available ? (
        <div className="server-service-empty">
          <span>{tab === 'docker' ? <Box size={26} /> : <Workflow size={26} />}</span>
          <h4>{tab === 'docker' ? 'Docker' : 'PM2'} is not reporting</h4>
          <p>
            When this server shares its {tab === 'docker' ? 'containers' : 'processes'}, they appear
            here automatically.
          </p>
        </div>
      ) : !count ? (
        <p className="server-muted server-service-empty">
          No {tab === 'docker' ? 'containers' : 'processes'} are running on this server.
        </p>
      ) : (
        <>
          <div className="server-service-table">
            <table>
              <thead>
                <tr>
                  {sortHeader('name', 'Name')}
                  {sortHeader('status', 'Status')}
                  {sortHeader('cpu', 'CPU')}
                  {sortHeader('memory', 'Memory')}
                  {sortHeader('extra', tab === 'docker' ? 'Image' : 'Uptime')}
                </tr>
              </thead>
              <tbody>
                {sortedRows.slice(0, expanded ? undefined : 12).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.subtitle}</small>
                    </td>
                    <td>
                      <span
                        className={`server-process-status ${item.status === 'running' || item.status === 'online' ? 'is-running' : ''}`}
                      >
                        {item.status}
                      </span>
                      {item.statusDetail && <small>{item.statusDetail}</small>}
                    </td>
                    <td>{item.cpu === null ? '—' : `${item.cpu.toFixed(1)}%`}</td>
                    <td>{item.memory === null ? '—' : bytes(item.memory)}</td>
                    <td title={typeof item.extra === 'string' ? item.extra : undefined}>
                      {item.trailing}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {count > 12 && (
            <Button
              variant="ghost"
              className="server-show-services"
              onPress={() => setExpanded(!expanded)}
            >
              {expanded
                ? 'Show fewer'
                : `Show all ${count} ${tab === 'docker' ? 'containers' : 'processes'}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
