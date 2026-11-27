/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  buildServiceConsoleRequest,
  mergeRoomIcons,
  resolveServerConnectionState,
  type ActiveServiceConsole,
  type ServerIdentityPatch,
  type ServerRoomOption,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import type { Preferences } from '@haus/core/preferences';
import { ServersManagementWorkspace, type SidebarContextualNav } from '@haus/ui/components';
import { buildServerSidebarNav } from '../home/navigation.js';
import type { HomeRoute } from '../shell.js';
import { GpuiLiveTerminal } from './live-terminal.js';
import type { GpuiSystemPorts } from './servers-port.js';
import { GpuiServiceConsoleModal } from './service-console.js';

export function GpuiServersView({
  snapshot,
  preferences,
  columns = 3,
  demo,
  system,
  onCopyText,
  onSaved,
  onPreferencesPatch,
  onGo,
  onContextualSidebarChange,
}: {
  readonly snapshot: Snapshot;
  readonly preferences?: Preferences;
  readonly columns?: number;
  readonly demo?: boolean;
  readonly system?: GpuiSystemPorts;
  readonly onCopyText?: (text: string) => void;
  readonly onSaved?: () => void;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onGo?: (route: HomeRoute) => void;
  readonly onContextualSidebarChange?: (context: SidebarContextualNav | undefined) => void;
}) {
  const [activeConsole, setActiveConsole] = useState<{
    readonly serverId: string;
    readonly serverName: string;
    readonly state: ActiveServiceConsole;
  }>();

  const rooms = useMemo<readonly ServerRoomOption[]>(
    () =>
      snapshot.areas
        .map((area) => ({ id: area.area_id, name: area.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.areas],
  );

  const roomIcons = useMemo(
    () => mergeRoomIcons(snapshot.areas, preferences?.roomIcons),
    [preferences?.roomIcons, snapshot.areas],
  );

  const canManage = Boolean(demo || snapshot.user.is_admin);

  const saveServerPreference = (serverId: string, patch: ServerIdentityPatch) => {
    if (!onPreferencesPatch) return;
    const currentMap = preferences?.serverDevices ?? {};
    const prev = currentMap[serverId] ?? {};
    onPreferencesPatch({
      serverDevices: {
        ...currentMap,
        [serverId]: {
          ...prev,
          name: patch.name,
          areaId: patch.areaId ?? '',
          icon: patch.icon,
          ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
          ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
        },
      },
    });
  };

  return (
    <>
      <ServersManagementWorkspace
        columns={columns}
        demo={demo}
        canManage={canManage}
        contextualNavigation={Boolean(onContextualSidebarChange)}
        rooms={rooms}
        roomIcons={roomIcons}
        serverPreferences={preferences?.serverDevices}
        port={system?.servers}
        onSaveServerPreference={onPreferencesPatch ? saveServerPreference : undefined}
        onOpenRoom={onGo ? (roomId) => onGo(`room:${roomId}`) : undefined}
        onSaved={onSaved}
        onInspectService={(server: ServerSummaryRecord, service, mode) => {
          const targetId = server.managedId ?? server.id;
          setActiveConsole({
            serverId: targetId,
            serverName: server.name,
            state: buildServiceConsoleRequest(
              service.rawId ? { ...service, id: service.rawId } : service,
              mode,
            ),
          });
        }}
        renderLogs={(server, demoLogs) => (
          <GpuiLiveTerminal
            serverId={server.managedId ?? server.id}
            serverName={server.name}
            target={{ kind: 'hub-logs' }}
            demo={demo}
            demoLogs={demoLogs}
            terminal={system?.terminal}
            onCopyText={onCopyText}
          />
        )}
        renderTerminal={(server) => (
          <GpuiLiveTerminal
            serverId={server.managedId ?? server.id}
            serverName={server.name}
            target={{ kind: 'shell' }}
            demo={demo}
            terminal={system?.terminal}
            onCopyText={onCopyText}
          />
        )}
        onActiveServerChange={(selection) => {
          if (!onContextualSidebarChange) return;
          if (!selection) {
            onContextualSidebarChange(undefined);
            return;
          }
          const { server } = selection;
          onContextualSidebarChange(
            buildServerSidebarNav({
              name: server.name,
              kind: server.kind,
              managed: Boolean(server.managedId),
              hasNvr: Boolean(server.nvr?.hasNvr),
              canManage,
              status: resolveServerConnectionState(server),
              activeTab: selection.activeTab,
              onSelectTab: selection.onSelectTab,
              onBack: selection.onBack,
            }),
          );
        }}
      />
      {activeConsole && (
        <GpuiServiceConsoleModal
          serverId={activeConsole.serverId}
          serverName={activeConsole.serverName}
          consoleState={activeConsole.state}
          demo={demo}
          terminal={system?.terminal}
          onCopyText={onCopyText}
          onChangeMode={(nextState) =>
            setActiveConsole((prev) => (prev ? { ...prev, state: nextState } : undefined))
          }
          onClose={() => setActiveConsole(undefined)}
        />
      )}
    </>
  );
}
