import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@heroui/react';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Server,
  AlertCircle,
  LayoutGrid,
  ChevronRight,
} from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { FeatureLoading } from '../../components/ui/Deferred';
import { EmptyState } from '../../components/ui/EmptyState';
import { VirtualSections } from '../../components/ui/VirtualSections';
import { roomIconFor } from '../../components/icons/Icon';
import { PairServerDialog } from './PairServerDialog';
import { ServerSshAddDialog } from './ServerSshAddDialog';
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
import { serversForView } from './server-catalog';

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
  scrollRef,
  actionsContainer,
  roomIcons,
  onOpenRoom,
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
  scrollRef: RefObject<HTMLDivElement | null>;
  actionsContainer?: HTMLElement | null;
  roomIcons?: Record<string, string>;
  onOpenRoom?: (id: string) => void;
}) {
  const { status, cluster, history, error, busy, fresh, now, receivedAt, refresh, act } =
    useServers(demo);
  const [selected, setSelected] = useState<string | undefined>(initialServerId);
  const [addMenu, setAddMenu] = useState(false);
  const [pair, setPair] = useState(false);
  const [sshAdd, setSshAdd] = useState(false);
  const [removing, setRemoving] = useState<HomeServer>();
  const [removingBusy, setRemovingBusy] = useState(false);
  const needsHelperUpdate = error.startsWith('Update the Haus helper');
  const rawServer = status?.servers.find((item) => item.id === selected);
  const server = rawServer ? namedServer(rawServer, serverDevices) : undefined;
  const visibleServers = serversForView(status?.servers ?? [], serverDevices, 'all');
  const groups = groupServersByRoom(visibleServers, rooms, serverDevices);
  const opener = useRef<string | undefined>(undefined);
  const detail = useRef<HTMLDivElement>(null);
  const onServerChangeRef = useRef(onServerChange);
  onServerChangeRef.current = onServerChange;
  const onServerStatusChangeRef = useRef(onServerStatusChange);
  onServerStatusChangeRef.current = onServerStatusChange;
  const connectionStatus =
    !server || (!fresh && server.kind !== 'ssh')
      ? 'unknown'
      : server.enabled === false
        ? 'paused'
        : server.online === true
          ? 'online'
          : server.online === false
            ? 'offline'
            : 'unknown';
  useEffect(() => {
    onServerStatusChangeRef.current?.(connectionStatus);
  }, [connectionStatus]);
  useEffect(() => setSelected(initialServerId), [initialServerId]);
  useEffect(() => {
    onServerChangeRef.current?.(server);
  }, [
    server?.id,
    server?.name,
    server?.kind,
    server?.host?.platform,
    server?.host?.release,
    server?.host?.distribution,
    server?.host?.osName,
  ]);
  useLayoutEffect(() => {
    if (!server?.id) return;
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    detail.current?.focus({ preventScroll: true });
  }, [server?.id, scrollRef]);
  const back = () => {
    setSelected(undefined);
    onOpenServer?.(undefined);
    onBack?.();
    requestAnimationFrame(() => {
      if (opener.current) document.getElementById(`server-card-${opener.current}`)?.focus();
    });
  };
  const actions = !demo && (!contextualNavigation || !server) && (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Refresh servers"
        title="Refresh servers"
        disabled={busy}
        onClick={() => void refresh().catch(() => {})}
      >
        <RefreshCw size={17} />
      </button>
      {admin && (
        <Button
          aria-label="Add server"
          className="add-button"
          variant="outline"
          onPress={() => setAddMenu(true)}
        >
          <Plus size={17} />
          <span>Add server</span>
        </Button>
      )}
    </>
  );
  return (
    <div className={server ? 'servers-page' : 'home-filter-content'} data-server-surface>
      {actions &&
        (actionsContainer ? (
          createPortal(actions, actionsContainer)
        ) : (
          <div className="heading-actions">{actions}</div>
        ))}
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
      {!demo && !status && !error && <FeatureLoading />}
      {status && !server && (
        <VirtualSections
          items={groups}
          getKey={(group) => group.id}
          scrollRef={scrollRef}
          estimateHeight={(group, columns) => 74 + Math.ceil(group.servers.length / columns) * 137}
          renderSection={(group) => {
            const Icon = group.id ? roomIconFor(group.name, roomIcons?.[group.id]) : LayoutGrid;
            return (
              <section className="device-group" key={group.id}>
                <div className="device-group-heading">
                  <span className="device-group-icon">
                    <Icon size={16} strokeWidth={1.7} />
                  </span>
                  <h2>
                    {group.id && onOpenRoom ? (
                      <button className="group-room-link" onClick={() => onOpenRoom(group.id)}>
                        {group.name}
                        <ChevronRight size={14} />
                      </button>
                    ) : (
                      group.name
                    )}
                  </h2>
                  <span className="device-group-count">
                    {group.servers.length} {group.servers.length === 1 ? 'server' : 'servers'}
                  </span>
                  <span className="device-group-rule" />
                </div>
                <div className="accessory-grid">
                  {group.servers.map((item) => (
                    <ServerCard
                      key={item.id}
                      server={item}
                      icon={serverDevices[item.id]?.icon}
                      room={group.name}
                      fresh={fresh || item.kind === 'ssh'}
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
            );
          }}
        />
      )}
      {status && !server && !visibleServers.length && (
        <EmptyState
          icon={<Server />}
          title="No servers to show"
          description="Add a server, or restore a hidden one from Hidden devices."
        />
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
      {addMenu && (
        <Dialog title="Add a server" onClose={() => setAddMenu(false)}>
          <p className="registry-help">Choose how you want to connect this machine.</p>
          <div className="server-add-methods">
            <button
              type="button"
              onClick={() => {
                setAddMenu(false);
                setPair(true);
              }}
            >
              <Server size={20} />
              <span>
                <strong>Haus NVR</strong>
                <small>Managed recording, streaming, backups and system telemetry.</small>
              </span>
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              onClick={() => {
                setAddMenu(false);
                setSshAdd(true);
              }}
            >
              <Server size={20} />
              <span>
                <strong>SSH server</strong>
                <small>Secure shell access and a place for this machine in your home.</small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </Dialog>
      )}
      {sshAdd && (
        <ServerSshAddDialog
          rooms={rooms}
          onClose={() => setSshAdd(false)}
          onAdded={async (id, name, areaId) => {
            await onServerDeviceChange?.(id, { name, ...(areaId ? { areaId } : {}) });
            await refresh().catch(() => {});
            setSelected(id);
            onOpenServer?.(id);
          }}
        />
      )}
      {removing && (
        <Dialog
          title={`${removing.kind === 'ssh' ? 'Remove' : 'Disconnect'} ${removing.name}?`}
          onClose={() => {
            if (!busy && !removingBusy) setRemoving(undefined);
          }}
        >
          <p>{removing.kind === 'ssh'
            ? 'This removes the saved SSH connection and its protected credentials from Haus. It does not change the server or any files on it.'
            : 'Files already on this server stay on disk. Haus stops assigning work and tracking its copies; recordings available only here may become unavailable in Haus. Pause the connection instead if you plan to reconnect it.'}</p>
          <div className="registry-dialog-actions">
            <Button variant="ghost" isDisabled={busy || removingBusy} onPress={() => setRemoving(undefined)}>
              Keep connected
            </Button>
            <Button
              variant="danger"
              isPending={busy || removingBusy}
              isDisabled={removing.kind !== 'ssh' && !fresh}
              onPress={() =>
                removing.kind === 'ssh'
                  ? void (async () => {
                      setRemovingBusy(true);
                      try {
                        if (!window.hausNative?.serverSshRemove)
                          throw new Error('Restart Haus to enable SSH server management.');
                        await window.hausNative.serverSshRemove(removing.id);
                        await onServerDeviceChange?.(removing.id, {});
                        setRemoving(undefined);
                        setSelected(undefined);
                        onOpenServer?.(undefined);
                        await refresh();
                      } catch {
                        setError('The SSH connection could not be removed. Try again.');
                      } finally {
                        setRemovingBusy(false);
                      }
                    })()
                  : void act(async () => {
                      await serverRequest('POST', `/api/cluster/nodes/${removing.id}/remove`, {});
                      setRemoving(undefined);
                    }).catch(() => {})
              }
            >
              {removing.kind === 'ssh' ? 'Remove SSH server' : 'Disconnect server'}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
