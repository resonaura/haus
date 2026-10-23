import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowLeft, Plus, RefreshCw, Server, AlertCircle, LayoutGrid } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { PairServerDialog } from './PairServerDialog';
import { confirmStorageLimit, serverRequest } from './server-api';
import { ServerDetail } from './ServerDetail';
import { ServerBackups } from './ServerBackups';
import { useServers } from './useServers';
import { ServerCard } from './ServerCard';
import {
  groupServersByRoom,
  namedServer,
  type ServerDevicePreference,
  type ServerDevicePreferences,
  type ServerRoom,
} from './server-rooms';
import type { HomeServer } from './types';

export function ServersPage({
  demo,
  admin,
  rooms = [],
  serverDevices = {},
  onServerDeviceChange,
  onServerChange,
  onServerStatusChange,
  initialServerId,
  activeTab,
  onTabChange,
  onOpenServer,
  onBack,
  contextualNavigation = false,
}: {
  demo: boolean;
  admin: boolean;
  rooms?: ServerRoom[];
  serverDevices?: ServerDevicePreferences;
  onServerDeviceChange?: (id: string, value: ServerDevicePreference) => void | Promise<void>;
  onServerChange?: (server: HomeServer | undefined) => void;
  onServerStatusChange?: (status: 'online' | 'offline' | 'paused' | 'unknown') => void;
  initialServerId?: string;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onOpenServer?: (id: string | undefined) => void;
  onBack?: () => void;
  contextualNavigation?: boolean;
}) {
  const { status, cluster, history, error, busy, fresh, now, receivedAt, refresh, act } =
    useServers(demo);
  const [selected, setSelected] = useState<string | undefined>(initialServerId);
  const [pair, setPair] = useState(false);
  const [removing, setRemoving] = useState<HomeServer>();
  const needsHelperUpdate = error.startsWith('Update the Haus helper');
  const rawServer = status?.servers.find((item) => item.id === selected);
  const server = rawServer ? namedServer(rawServer, serverDevices) : undefined;
  const groups = groupServersByRoom(status?.servers ?? [], rooms, serverDevices);
  const opener = useRef<string | undefined>(undefined);
  const detail = useRef<HTMLDivElement>(null);
  const onServerChangeRef = useRef(onServerChange);
  onServerChangeRef.current = onServerChange;
  const onServerStatusChangeRef = useRef(onServerStatusChange);
  onServerStatusChangeRef.current = onServerStatusChange;
  const connectionStatus =
    !server || !fresh
      ? 'unknown'
      : server.enabled === false
        ? 'paused'
        : server.online
          ? 'online'
          : 'offline';
  useEffect(() => {
    onServerStatusChangeRef.current?.(connectionStatus);
  }, [connectionStatus]);
  useEffect(() => setSelected(initialServerId), [initialServerId]);
  useEffect(() => {
    onServerChangeRef.current?.(server);
    if (server) detail.current?.focus();
  }, [
    server?.id,
    server?.name,
    server?.kind,
    server?.host?.platform,
    server?.host?.release,
    server?.host?.distribution,
    server?.host?.osName,
  ]);
  const back = () => {
    setSelected(undefined);
    onOpenServer?.(undefined);
    onBack?.();
    requestAnimationFrame(() => {
      if (opener.current) document.getElementById(`server-card-${opener.current}`)?.focus();
    });
  };
  return (
    <div className="servers-page">
      {(!contextualNavigation || !server) && (
        <div className="servers-toolbar">
          <div>
            <span className="servers-count">
              {status && !fresh
                ? 'Last known server status'
                : status
                  ? `${status.servers.filter((item) => item.online).length} connected`
                  : error
                    ? needsHelperUpdate
                      ? 'Helper update required'
                      : 'Servers are unavailable'
                    : demo
                      ? 'Connect your home to begin'
                      : 'Connecting to your servers…'}
            </span>
            <p>Storage, media and the services behind your home.</p>
          </div>
          {!demo && (
            <div>
              {admin && (
                <Button variant="secondary" onPress={() => setPair(true)} isDisabled={!fresh}>
                  <Plus size={17} />
                  Add server
                </Button>
              )}
              <Button
                variant="ghost"
                isIconOnly
                aria-label="Refresh servers"
                isDisabled={busy}
                onPress={() => void refresh().catch(() => {})}
              >
                <RefreshCw size={17} />
              </Button>
            </div>
          )}
        </div>
      )}
      {(error || (status && !fresh)) && (
        <div className="server-notice" role={error ? 'alert' : 'status'}>
          <AlertCircle size={20} />
          <div>
            <strong>
              {needsHelperUpdate
                ? 'Update the Haus helper'
                : status && !fresh
                  ? 'Server information is out of date'
                  : 'Servers need attention'}
            </strong>
            {error && <p>{error}</p>}
            {status && !fresh && (
              <p>
                Showing last known information
                {receivedAt ? ` from ${new Date(receivedAt).toLocaleTimeString()}` : ''}. Reconnect
                or refresh before making changes.
              </p>
            )}
            {!status && !needsHelperUpdate && (
              <p>Make sure the Haus helper is installed and running.</p>
            )}
          </div>
        </div>
      )}
      {demo && (
        <div className="server-panel server-welcome">
          <Server size={36} />
          <h2>A home for your home servers.</h2>
          <p>
            Connect Home Assistant to see its resources, manage optional servers and keep recovery
            copies together.
          </p>
        </div>
      )}
      {!demo && !status && !error && (
        <div className="server-loading" aria-label="Loading servers" role="status">
          <span />
          <span />
          <span />
        </div>
      )}
      {status && !server && (
        <div className="device-groups servers-overview">
          {groups.map((group) => (
            <section className="device-group" key={group.id}>
              <div className="device-group-heading">
                <span className="device-group-icon">
                  <LayoutGrid size={19} />
                </span>
                <h2>{group.name}</h2>
                <span className="device-group-count">
                  {group.servers.length} {group.servers.length === 1 ? 'server' : 'servers'}
                </span>
                <span className="device-group-rule" />
              </div>
              <div className="accessory-grid server-card-grid">
                {group.servers.map((item) => (
                  <ServerCard
                    key={item.id}
                    server={item}
                    icon={serverDevices[item.id]?.icon}
                    room={group.name}
                    fresh={fresh}
                    now={now}
                    rooms={rooms}
                    preference={serverDevices[item.id]}
                    onSavePreference={
                      onServerDeviceChange
                        ? (value) => onServerDeviceChange(item.id, value)
                        : undefined
                    }
                    onOpen={() => {
                      opener.current = item.id;
                      setSelected(item.id);
                      onOpenServer?.(item.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {status && server && (
        <div className="servers-detail-workspace" ref={detail} tabIndex={-1}>
          {!contextualNavigation && (
            <Button variant="ghost" className="server-back" onPress={back}>
              <ArrowLeft size={17} />
              All servers
            </Button>
          )}
          <ServerDetail
            key={server.id}
            server={server}
            history={history[server.id] ?? []}
            admin={admin}
            fresh={fresh}
            now={now}
            activeTab={activeTab}
            onTabChange={onTabChange}
            contextualNavigation={contextualNavigation}
            busy={busy}
            onSaveLimit={(storageLimitBytes) =>
              act(
                () =>
                  serverRequest(
                    'PATCH',
                    server.kind === 'home-assistant'
                      ? '/api/servers/home-assistant'
                      : `/api/cluster/nodes/${server.id}`,
                    { storageLimitBytes },
                  ),
                (next) => confirmStorageLimit(next, server.id, storageLimitBytes),
              )
            }
            onToggle={() =>
              void act(() =>
                serverRequest('PATCH', `/api/cluster/nodes/${server.id}`, {
                  enabled: !server.enabled,
                }),
              ).catch(() => {})
            }
            onRemove={() => setRemoving(server)}
            rooms={rooms}
            preference={serverDevices[server.id]}
            onSaveIdentity={
              onServerDeviceChange ? (value) => onServerDeviceChange(server.id, value) : undefined
            }
            backups={
              cluster ? (
                <ServerBackups cluster={cluster} admin={admin} busy={busy || !fresh} act={act} />
              ) : undefined
            }
          />
        </div>
      )}
      {pair && (
        <PairServerDialog
          canSubmit={fresh}
          onClose={() => setPair(false)}
          onPaired={() => void refresh().catch(() => {})}
        />
      )}
      {removing && (
        <Dialog
          title={`Disconnect ${removing.name}?`}
          onClose={() => {
            if (!busy) setRemoving(undefined);
          }}
        >
          <p>
            Files already on this server stay on disk. Haus stops assigning work and tracking its
            copies; recordings available only here may become unavailable in Haus. Pause the
            connection instead if you plan to reconnect it.
          </p>
          <div className="registry-dialog-actions">
            <Button variant="ghost" isDisabled={busy} onPress={() => setRemoving(undefined)}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              isPending={busy}
              isDisabled={!fresh}
              onPress={() =>
                void act(async () => {
                  await serverRequest('POST', `/api/cluster/nodes/${removing.id}/remove`, {});
                  setRemoving(undefined);
                }).catch(() => {})
              }
            >
              Disconnect server
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
