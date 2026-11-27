/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Box, HausButton, Heading, Pressable, Text } from '@haus/ui';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Server,
  AlertCircle,
  LayoutGrid,
  ChevronRight,
} from 'lucide-react';
import { FeatureLoading, EmptyState } from '@haus/ui/components';
import { PresenceGrid, VirtualSections } from '@haus/ui/web';
import { roomIconFor } from '../../components/icons/Icon';
import { PairServerDialog } from './PairServerDialog';
import { ServerSshAddDialog } from './ServerSshAddDialog';
import { confirmStorageLimit, serverRequest } from './server-api';
import { ServerDetail } from './ServerDetail';
import { ServerBackups } from './ServerBackups';
import { ClusterCoordinationPanel } from './cluster/ClusterCoordinationPanel';
import { AddHubDialog, AddServerMenuDialog } from './cluster/AddHubDialog';
import { RemoveServerDialog } from './cluster/RemoveServerDialog';
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
import { serverIsLocalHub, serverManagementId } from './server-connections';

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
  const [addHub, setAddHub] = useState(false);
  const [pair, setPair] = useState(false);
  const [sshAdd, setSshAdd] = useState(false);
  const [enrolling, setEnrolling] = useState<HomeServer>();
  const [removing, setRemoving] = useState<HomeServer>();
  const pageError = error;
  const needsHubUpdate = error.startsWith('Update Haus Hub');
  const rawServer = status?.servers.find((item) => item.id === selected);
  const server = rawServer ? namedServer(rawServer, serverDevices) : undefined;
  const visibleServers = serversForView(status?.servers ?? [], serverDevices, 'all');
  const isHausHubSession = Boolean(
    status?.servers.some((item) => item.kind === 'hub') ||
    cluster?.coordinatorId ||
    cluster?.selfHubId,
  );
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
    server?.managedId,
    server?.roles?.join(','),
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
      <Pressable
        className="icon-button"
        ariaLabel="Refresh servers"
        title="Refresh servers"
        disabled={busy}
        onPress={() => void refresh().catch(() => {})}
      >
        <RefreshCw size={17} />
      </Pressable>
      {admin && (
        <HausButton
          aria-label="Add server"
          className="add-button"
          variant="outline"
          onPress={() => setAddMenu(true)}
        >
          <Plus size={17} />
          <Text>Add server</Text>
        </HausButton>
      )}
    </>
  );
  return (
    <Box
      className={server ? 'servers-page' : 'home-filter-content'}
      dataAttrs={{ 'server-surface': '' }}
    >
      {actions &&
        (actionsContainer ? (
          createPortal(actions, actionsContainer)
        ) : (
          <Box className="heading-actions">{actions}</Box>
        ))}
      {(pageError || (status && !fresh)) && (
        <Box className="server-notice" role={pageError ? 'alert' : 'status'}>
          <AlertCircle size={20} />
          <Box>
            <Text semantic="strong">
              {needsHubUpdate
                ? 'Update Haus Hub'
                : status && !fresh
                  ? 'Server information is out of date'
                  : 'Servers need attention'}
            </Text>
            {pageError && <Text semantic="p">{pageError}</Text>}
            {status && !fresh && (
              <Text semantic="p">
                Showing last known information
                {receivedAt ? ` from ${new Date(receivedAt).toLocaleTimeString()}` : ''}. Reconnect
                or refresh before making changes.
              </Text>
            )}
            {!status && !needsHubUpdate && (
              <Text semantic="p">Make sure Haus Hub is connected and running.</Text>
            )}
          </Box>
        </Box>
      )}
      {demo && (
        <Box className="server-panel server-welcome">
          <Server size={36} />
          <Heading level={2}>A home for your home servers.</Heading>
          <Text semantic="p">
            Connect your Haus Hub to see its resources, manage optional servers and keep recovery
            copies together.
          </Text>
        </Box>
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
              <Box semantic="section" className="device-group" key={group.id}>
                <Box className="device-group-heading">
                  <Text className="device-group-icon">
                    <Icon size={16} strokeWidth={1.7} />
                  </Text>
                  <Heading level={2}>
                    {group.id && onOpenRoom ? (
                      <Pressable className="group-room-link" onPress={() => onOpenRoom(group.id)}>
                        {group.name}
                        <ChevronRight size={14} />
                      </Pressable>
                    ) : (
                      group.name
                    )}
                  </Heading>
                  <Text className="device-group-count">
                    {group.servers.length} {group.servers.length === 1 ? 'server' : 'servers'}
                  </Text>
                  <Text className="device-group-rule" />
                </Box>
                <PresenceGrid className="accessory-grid">
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
                </PresenceGrid>
              </Box>
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
      {status && !server && cluster && isHausHubSession && (
        <ClusterCoordinationPanel cluster={cluster} admin={admin} busy={busy || !fresh} act={act} />
      )}
      {status && server && (
        <Box
          className="servers-detail-workspace"
          boxRef={(node) => {
            detail.current = node instanceof HTMLDivElement ? node : null;
          }}
          tabIndex={-1}
        >
          {!contextualNavigation && (
            <HausButton variant="ghost" className="server-back" onPress={back}>
              <ArrowLeft size={17} />
              All servers
            </HausButton>
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
            monitoringSupported={status.features?.monitoringOnlyServers === true}
            onConnectMonitoring={() => setEnrolling(server)}
            onMonitoringChanged={async () => {
              await act(
                async () => {},
                (next) => {
                  if (next.servers.some((item) => item.id === server.id && item.managedId))
                    throw new Error(
                      'The updated server state could not be confirmed. Refresh your servers.',
                    );
                },
              );
            }}
            onSaveLimit={(storageLimitBytes) =>
              act(
                () =>
                  serverRequest(
                    'PATCH',
                    serverIsLocalHub(server)
                      ? '/api/servers/home-assistant'
                      : `/api/cluster/nodes/${serverManagementId(server)}`,
                    { storageLimitBytes },
                  ),
                (next) => confirmStorageLimit(next, server.id, storageLimitBytes),
              )
            }
            onToggle={() =>
              void act(() =>
                serverRequest('PATCH', `/api/cluster/nodes/${serverManagementId(server)}`, {
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
                <>
                  <ClusterCoordinationPanel
                    cluster={cluster}
                    admin={admin}
                    busy={busy || !fresh}
                    act={act}
                  />
                  <ServerBackups cluster={cluster} admin={admin} busy={busy || !fresh} act={act} />
                </>
              ) : undefined
            }
          />
        </Box>
      )}
      {pair && (
        <PairServerDialog
          canSubmit={fresh}
          allowMonitoringOnly={status?.features?.monitoringOnlyServers === true}
          onClose={() => setPair(false)}
          onPaired={async (id) => {
            await act(
              async () => {},
              (next) => {
                if (!next.servers.some((item) => serverManagementId(item) === id))
                  throw new Error(
                    'The updated server state could not be confirmed. Refresh your servers.',
                  );
              },
            );
          }}
        />
      )}
      {enrolling && (
        <PairServerDialog
          monitoringOnly
          allowMonitoringOnly
          canSubmit={fresh}
          initialName={enrolling.name}
          initialUrl={(() => {
            try {
              return `http://${new URL(enrolling.url ?? '').hostname}:8098`;
            } catch {
              return 'https://';
            }
          })()}
          sshServerId={enrolling.id}
          existingServers={(status?.servers ?? []).filter(
            (item) =>
              (item.kind === 'nvr' || (item.kind === 'hub' && !item.local)) &&
              (!item.sshServerId || item.sshServerId === enrolling.id),
          )}
          onClose={() => setEnrolling(undefined)}
          onPaired={async (id) => {
            await act(
              async () => {},
              (next) => {
                if (!next.servers.some((item) => item.id === enrolling.id && item.managedId === id))
                  throw new Error(
                    'The updated server state could not be confirmed. Refresh your servers.',
                  );
              },
            );
          }}
        />
      )}
      {addMenu && (
        <AddServerMenuDialog
          onClose={() => setAddMenu(false)}
          onSelectHub={isHausHubSession ? () => setAddHub(true) : undefined}
          onSelectNvr={() => setPair(true)}
          onSelectSsh={() => setSshAdd(true)}
        />
      )}
      {isHausHubSession && (
        <AddHubDialog
          open={addHub}
          onClose={() => setAddHub(false)}
          onJoined={() => refresh().catch(() => {})}
        />
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
        <RemoveServerDialog
          removing={removing}
          busy={busy}
          fresh={fresh}
          act={act}
          onClose={() => setRemoving(undefined)}
          onRemoved={(clearSelection) => {
            setRemoving(undefined);
            if (clearSelection) {
              setSelected(undefined);
              onOpenServer?.(undefined);
            }
          }}
          onServerDeviceChange={onServerDeviceChange}
          onRefresh={refresh}
        />
      )}
    </Box>
  );
}
