import { useState } from 'react';
import { Box, Workflow } from 'lucide-react';
import { Button } from '@heroui/react';
import { bytes, serviceSampleIsFresh, uptime } from './presentation';
import type { ServerHost } from './types';

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
  const service = host[tab];
  const count = tab === 'docker' ? host.docker.containers.length : host.pm2.processes.length;
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
                  <th>Name</th>
                  <th>Status</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>{tab === 'docker' ? 'Image' : 'Uptime'}</th>
                </tr>
              </thead>
              <tbody>
                {tab === 'docker'
                  ? host.docker.containers.slice(0, expanded ? undefined : 12).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>{item.id.slice(0, 12)}</small>
                        </td>
                        <td>
                          <span
                            className={`server-process-status ${item.state === 'running' ? 'is-running' : ''}`}
                          >
                            {item.state}
                          </span>
                          <small>{item.status}</small>
                        </td>
                        <td>
                          {lastKnown ||
                          !serviceSampleIsFresh(item.sampledAt, now) ||
                          item.cpuPercent === null
                            ? '—'
                            : `${item.cpuPercent.toFixed(1)}%`}
                        </td>
                        <td>
                          {lastKnown ||
                          !serviceSampleIsFresh(item.sampledAt, now) ||
                          item.memoryUsedBytes === null
                            ? '—'
                            : bytes(item.memoryUsedBytes)}
                        </td>
                        <td title={item.image ?? undefined}>{item.image || 'Unavailable'}</td>
                      </tr>
                    ))
                  : host.pm2.processes.slice(0, expanded ? undefined : 12).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            PID {item.pid ?? '—'} · {item.restarts ?? '—'} restarts
                          </small>
                        </td>
                        <td>
                          <span
                            className={`server-process-status ${item.status === 'online' ? 'is-running' : ''}`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td>
                          {lastKnown || item.cpuPercent === null
                            ? '—'
                            : `${item.cpuPercent.toFixed(1)}%`}
                        </td>
                        <td>
                          {lastKnown || item.memoryBytes === null ? '—' : bytes(item.memoryBytes)}
                        </td>
                        <td>{uptime(item.uptimeSeconds)}</td>
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
