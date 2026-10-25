import { useId, useState, type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { Pause, Play, Unplug, AlertCircle } from 'lucide-react';
import { ServerIcon } from '../../components/icons/ServerIcon';
import { ServerOverview } from './ServerOverview';
import { ServerDisks } from './ServerDisks';
import { ServerServices } from './ServerServices';
import { ServerTerminal } from './ServerTerminal';
import { ServerNvr } from './ServerNvr';
import { telemetryIsFresh } from './presentation';
import type { HomeServer, ResourceSample } from './types';
import { serverErrorMessage } from './server-errors';
import { ServerIdentitySettings } from './ServerIdentitySettings';
import type { ServerDevicePreference, ServerRoom } from './server-rooms';
import { serverHasNvr } from './server-connections';
import { ServerMonitoringSettings } from './ServerMonitoringSettings';

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
  rooms = [],
  preference,
  onSaveIdentity,
  backups,
  activeTab,
  onTabChange,
  contextualNavigation = false,
  monitoringSupported = false,
  onConnectMonitoring,
  onMonitoringChanged,
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
  rooms?: ServerRoom[];
  preference?: ServerDevicePreference;
  onSaveIdentity?: (value: ServerDevicePreference) => void | Promise<void>;
  backups?: ReactNode;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  contextualNavigation?: boolean;
  monitoringSupported?: boolean;
  onConnectMonitoring?: () => void;
  onMonitoringChanged?: () => Promise<void>;
}) {
  const [localTab, setLocalTab] = useState('overview');
  const tabId = useId();
  const tabs = [
    ['overview', 'Overview'],
    ['storage', 'Disks'],
    ['services', 'Services'],
    ['terminal', 'Terminal'],
    ...(serverHasNvr(server) ? [['backups', 'NVR']] : []),
    ...(admin ? [['settings', 'Settings']] : []),
  ];
  const selectedTab = activeTab ?? localTab;
  const tab = tabs.some(([id]) => id === selectedTab) ? selectedTab : 'overview';
  const setTab = (id: string) => {
    setLocalTab(id);
    onTabChange?.(id);
  };
  const host = server.host;
  const connectionFresh = fresh || server.kind === 'ssh';
  const telemetryFresh = telemetryIsFresh(server, fresh, now);
  const hasStaleTelemetry = Boolean(host) && !telemetryFresh;
  const connection = !connectionFresh
    ? 'Last known status'
    : server.enabled === false
      ? 'Paused'
      : server.online === true
        ? 'Connected'
        : server.online === false
          ? 'Offline'
          : 'Not checked';
  const lastSeen = server.lastSeen ? new Date(server.lastSeen).toLocaleString() : undefined;
  return (
    <div className={`server-detail ${contextualNavigation ? 'is-contextual' : ''}`}>
      {!contextualNavigation && (
        <section className="server-detail-heading">
          <span className="server-identity-icon">
            <ServerIcon server={server} icon={preference?.icon} size={28} />
          </span>
          <div>
            <div className="server-kind">
              {server.kind === 'home-assistant'
                ? 'Home Assistant'
                : server.kind === 'ssh'
                  ? 'SSH server'
                  : 'Home server'}
            </div>
            <h2>{server.name}</h2>
            <p>
              {host
                ? [host.hostname, host.platform, host.arch].filter(Boolean).join(' · ')
                : server.url || 'Your home, connected'}
            </p>
          </div>
          <span
            className={`server-connection ${server.online === true && connectionFresh ? 'is-online' : ''}`}
          >
            <i />
            {connection}
          </span>
        </section>
      )}
      {server.online === false && (
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
          {serverErrorMessage(server.error)}
        </p>
      )}
      {server.online === true && server.monitoringOnline === false && (
        <p className="server-muted" role="status">
          SSH is available, but Haus Helper is not reporting. Resource information is last known.
        </p>
      )}
      {server.online === true && !host && (
        <div className="server-notice" role="status">
          <AlertCircle size={19} />
          <p>
            {server.kind === 'ssh'
              ? 'SSH is connected. Connect monitoring in Settings to see processor, memory, disks and services.'
              : 'This server is connected, but it has not shared resource information yet. Update its Haus service to see processor, memory, disks and services.'}
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
      {!contextualNavigation && (
        <div
          className="server-tabs"
          role="tablist"
          aria-label="Server details"
          onKeyDown={(event) => {
            const index = tabs.findIndex(([id]) => id === tab);
            const target =
              event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1;
            if (target < 0) return;
            event.preventDefault();
            setTab(tabs[target][0]);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[data-tab="${tabs[target][0]}"]`)
              ?.focus();
          }}
        >
          {tabs.map(([id, label]) => (
            <button
              type="button"
              role="tab"
              key={id}
              id={`${tabId}-${id}-tab`}
              data-tab={id}
              aria-selected={tab === id}
              aria-controls={`${tabId}-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <section
        className="server-tab-panel"
        role="tabpanel"
        id={`${tabId}-overview`}
        aria-labelledby={contextualNavigation ? undefined : `${tabId}-overview-tab`}
        aria-label={contextualNavigation ? 'Overview' : undefined}
        hidden={tab !== 'overview'}
      >
        <ServerOverview
          server={server}
          history={history}
          fresh={telemetryFresh}
          now={now}
          onNavigate={setTab}
        />
      </section>
      <section
        className="server-tab-panel server-disk-panel"
        role="tabpanel"
        id={`${tabId}-storage`}
        aria-labelledby={contextualNavigation ? undefined : `${tabId}-storage-tab`}
        aria-label={contextualNavigation ? 'Disks' : undefined}
        hidden={tab !== 'storage'}
      >
        <ServerDisks disks={host?.disks ?? []} lastKnown={hasStaleTelemetry} />
      </section>
      <section
        className="server-tab-panel server-services-panel"
        role="tabpanel"
        id={`${tabId}-services`}
        aria-labelledby={contextualNavigation ? undefined : `${tabId}-services-tab`}
        aria-label={contextualNavigation ? 'Services' : undefined}
        hidden={tab !== 'services'}
      >
        {host && <ServerServices host={host} lastKnown={hasStaleTelemetry} now={now} />}
        {!host && (
          <p className="server-muted">
            {server.kind === 'ssh'
              ? 'Install Haus Helper to report service information for this server.'
              : 'Service information will appear when this server connects.'}
          </p>
        )}
      </section>
      {serverHasNvr(server) && (
        <section
          className="server-tab-panel"
          role="tabpanel"
          id={`${tabId}-backups`}
          aria-labelledby={contextualNavigation ? undefined : `${tabId}-backups-tab`}
          aria-label={contextualNavigation ? 'NVR' : undefined}
          hidden={tab !== 'backups'}
        >
          <ServerNvr
            server={server}
            fresh={fresh}
            admin={admin}
            busy={busy}
            onSaveLimit={onSaveLimit}
            backups={backups}
          />
        </section>
      )}
      {admin && (
        <section
          className="server-tab-panel"
          role="tabpanel"
          id={`${tabId}-settings`}
          aria-labelledby={contextualNavigation ? undefined : `${tabId}-settings-tab`}
          aria-label={contextualNavigation ? 'Settings' : undefined}
          hidden={tab !== 'settings'}
        >
          {onSaveIdentity && (
            <ServerIdentitySettings
              key={`${server.id}:${server.name}:${preference?.areaId ?? ''}:${preference?.icon ?? ''}`}
              server={server}
              rooms={rooms}
              preference={preference}
              onSave={onSaveIdentity}
            />
          )}
          {server.kind === 'ssh' && onConnectMonitoring && onMonitoringChanged && (
            <ServerMonitoringSettings
              server={server}
              supported={monitoringSupported}
              fresh={fresh}
              busy={busy}
              onConnect={onConnectMonitoring}
              onChanged={onMonitoringChanged}
            />
          )}
          {(server.kind === 'nvr' || server.kind === 'ssh') && (
            <div className="server-panel server-management-actions">
              <div className="server-section-heading">
                <div>
                  <h3>Connection</h3>
                  <p>
                    {server.kind === 'nvr' || server.managedId
                      ? 'Pause this Haus connection, or remove it from your home. The server’s other services keep running.'
                      : 'Remove this SSH connection from your home. The server and its files are not changed.'}
                  </p>
                </div>
              </div>
              <div>
                {(server.kind === 'nvr' || server.managedId) && (
                  <Button variant="secondary" isDisabled={busy || !fresh} onPress={onToggle}>
                    {server.enabled === false ? <Play size={15} /> : <Pause size={15} />}{' '}
                    {server.enabled === false ? 'Resume connection' : 'Pause connection'}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  isDisabled={busy || (server.kind !== 'ssh' && !fresh)}
                  onPress={onRemove}
                >
                  <Unplug size={15} />
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      <section
        className="server-tab-panel server-terminal-panel"
        role="tabpanel"
        id={`${tabId}-terminal`}
        aria-labelledby={contextualNavigation ? undefined : `${tabId}-terminal-tab`}
        aria-label={contextualNavigation ? 'Terminal' : undefined}
        hidden={tab !== 'terminal'}
      >
        <ServerTerminal server={server} active={tab === 'terminal'} />
      </section>
      <footer className="server-detail-footer" hidden={tab === 'terminal'}>
        <p>
          {host?.sampledAt
            ? `${telemetryFresh ? 'Updated' : 'Last sampled'} ${new Date(host.sampledAt).toLocaleTimeString()}${telemetryFresh ? ' · refreshes every second' : ''}`
            : server.kind === 'ssh'
              ? 'Resource reporting is not configured'
              : 'Waiting for resource information'}
        </p>
      </footer>
    </div>
  );
}
