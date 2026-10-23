import { Button } from '@heroui/react';
import { House, Server, Pause, Play, Unplug, AlertCircle } from 'lucide-react';
import { ResourceCards } from './ResourceCards';
import { ServerDisks } from './ServerDisks';
import { ServerServices } from './ServerServices';
import { StorageLimit } from './StorageLimit';
import { telemetryIsFresh } from './presentation';
import type { HomeServer, ResourceSample } from './types';

export function ServerDetail({
  server,
  history,
  admin,
  busy,
  fresh,
  now,
  onSaveLimit,
  onToggle,
  onRemove,
}: {
  server: HomeServer;
  history: ResourceSample[];
  admin: boolean;
  busy: boolean;
  fresh: boolean;
  now: number;
  onSaveLimit: (limit: number | null) => Promise<void>;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const host = server.host;
  const telemetryFresh = telemetryIsFresh(server, fresh, now);
  const hasStaleTelemetry = Boolean(host) && !telemetryFresh;
  const canManage = fresh && server.online;
  const loadAverage =
    host?.cpu.loadAverage.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ) ?? [];
  const lastSeen = server.lastSeen ? new Date(server.lastSeen).toLocaleString() : undefined;
  return (
    <div className="server-detail">
      <section className="server-detail-heading">
        <span className="server-identity-icon">
          {server.kind === 'home-assistant' ? <House size={28} /> : <Server size={28} />}
        </span>
        <div>
          <div className="server-kind">
            {server.kind === 'home-assistant' ? 'Home Assistant' : 'Home server'}
          </div>
          <h2>{server.name}</h2>
          <p>
            {host
              ? [host.hostname, host.platform, host.arch].filter(Boolean).join(' · ')
              : server.url || 'Your home, connected'}
          </p>
        </div>
        <span className={`server-connection ${server.online && fresh ? 'is-online' : ''}`}>
          <i />
          {!fresh
            ? 'Last known status'
            : server.enabled === false
              ? 'Paused'
              : server.online
                ? 'Connected'
                : 'Offline'}
        </span>
      </section>
      {!server.online && (
        <div className="server-notice">
          <AlertCircle size={19} />
          <p>
            {server.enabled === false
              ? 'This server is paused. Resume it to receive new work and refresh its information.'
              : `This server is offline.${lastSeen ? ` Last seen ${lastSeen}.` : ''} Its saved configuration stays available.`}
          </p>
        </div>
      )}
      {server.error && (
        <p className="server-muted" role="status">
          {server.error}
        </p>
      )}
      {server.online && !host && (
        <div className="server-notice" role="status">
          <AlertCircle size={19} />
          <p>
            This server is connected, but it has not shared resource information yet. Update its
            Haus service to see processor, memory, disks and services.
          </p>
        </div>
      )}
      {hasStaleTelemetry && (
        <p className="server-scope-note" role="status">
          Resource information is last known.{' '}
          {host?.sampledAt
            ? `Last sampled ${new Date(host.sampledAt).toLocaleString()}.`
            : 'Waiting for a fresh sample.'}{' '}
          Live measurements resume when this server reports again.
        </p>
      )}
      <ResourceCards server={server} history={history} fresh={telemetryFresh} />
      {(server.roles?.length ||
        server.streams ||
        server.playback ||
        server.backupCopies !== undefined) && (
        <section className="server-work" aria-label="Haus services on this server">
          {server.roles?.length ? (
            <span>
              <strong>Assigned work</strong>
              {server.roles
                .map((role) =>
                  role === 'storage'
                    ? 'Storage'
                    : role === 'stream'
                      ? 'Streaming'
                      : role === 'analysis'
                        ? 'Activity assist'
                        : role,
                )
                .join(' · ')}
            </span>
          ) : null}
          {server.streams && (
            <span>
              <strong>
                {fresh && server.online ? `${server.streams.active} / ${server.streams.max}` : '—'}
              </strong>
              Active streams
            </span>
          )}
          {server.playback && (
            <span>
              <strong>
                {fresh && server.online
                  ? `${server.playback.active} / ${server.playback.max}`
                  : '—'}
              </strong>
              Playback preparation
            </span>
          )}
          {server.backupCopies !== undefined && (
            <span>
              <strong>{server.backupCopies}</strong>
              {fresh ? 'Backup copies' : 'Last known backup copies'}
            </span>
          )}
        </section>
      )}
      {host?.scope === 'container' && (
        <p className="server-scope-note">
          These resources are reported from the Haus container. Host disks and services appear when
          the server shares host information.
        </p>
      )}
      {host?.cpu.model && (
        <div className="server-hardware-line">
          <strong>{host.cpu.model}</strong>
          {telemetryFresh && loadAverage.length > 0 && (
            <span>Load average {loadAverage.map((value) => value.toFixed(2)).join(' · ')}</span>
          )}
        </div>
      )}
      <ServerDisks disks={host?.disks ?? []} lastKnown={hasStaleTelemetry} />
      {server.settings && (
        <StorageLimit
          server={server}
          admin={admin}
          busy={busy || !canManage}
          onSave={onSaveLimit}
        />
      )}
      {host && <ServerServices host={host} lastKnown={hasStaleTelemetry} now={now} />}
      <footer className="server-detail-footer">
        <p>
          {host?.sampledAt
            ? `${telemetryFresh ? 'Updated' : 'Last sampled'} ${new Date(host.sampledAt).toLocaleTimeString()}${telemetryFresh ? ' · refreshes every 5 seconds' : ''}`
            : 'Waiting for resource information'}
        </p>
        {admin && server.kind === 'nvr' && (
          <div>
            <Button variant="ghost" isDisabled={busy || !fresh} onPress={onToggle}>
              {server.enabled === false ? <Play size={15} /> : <Pause size={15} />}{' '}
              {server.enabled === false ? 'Resume server' : 'Pause server'}
            </Button>
            <Button variant="ghost" isDisabled={busy || !fresh} onPress={onRemove}>
              <Unplug size={15} />
              Disconnect
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}
