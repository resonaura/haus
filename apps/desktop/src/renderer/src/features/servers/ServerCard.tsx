/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServerSummaryRecord } from '@haus/core/transport';
import { ServerCardTile } from '@haus/ui/components';
import { ContextMenu } from '@haus/ui/web';
import { ServerIcon } from '../../components/icons/ServerIcon';
import type { ContextMenuItem } from '../../../../shared/native';
import { telemetryIsFresh } from './presentation';
import type { HomeServer } from './types';
import type { ServerDevicePreference } from '../../model/preferences';
import type { ServerRoom } from './server-rooms';
import { serverContextItems, serverContextPreference } from './server-context-menu';

function toServerSummary(
  server: HomeServer,
  room: string | undefined,
  telemetryFresh: boolean,
  preference: ServerDevicePreference | undefined,
): ServerSummaryRecord {
  const host = server.host;
  const battery = telemetryFresh ? host?.battery : null;
  return {
    id: server.id,
    managedId: server.managedId,
    name: server.name,
    kind: server.kind,
    roomName: room,
    favorite: Boolean(preference?.favorite),
    online: server.online,
    enabled: server.enabled !== false,
    local: server.local,
    url: server.url,
    lastSeen: server.lastSeen,
    osLabel: host?.osName ?? host?.distribution ?? host?.platform ?? '',
    cpuModel: host?.cpu?.model ?? '',
    cpuCores: host?.cpu?.logicalCores ?? null,
    cpuUsage: telemetryFresh ? (host?.cpu?.usage ?? null) : null,
    loadAverageLabel: '',
    memoryUsedBytes: telemetryFresh ? (host?.memory?.usedBytes ?? null) : null,
    memoryTotalBytes: telemetryFresh ? (host?.memory?.totalBytes ?? null) : null,
    uptimeSeconds: host?.uptimeSeconds ?? null,
    ...(battery
      ? {
          batteryLevel: battery.level ?? null,
          batteryCharging: battery.charging === true || battery.powerConnected === true,
        }
      : {}),
    disks: [],
    services: [],
  };
}

export function ServerCard({
  server,
  room,
  fresh,
  now,
  onOpen,
  icon,
  rooms = [],
  preference,
  onSavePreference,
  hidden = false,
}: {
  server: HomeServer;
  room?: string;
  fresh: boolean;
  now: number;
  onOpen: () => void;
  icon?: string;
  rooms?: ServerRoom[];
  preference?: ServerDevicePreference;
  onSavePreference?: (value: ServerDevicePreference) => void | Promise<void>;
  hidden?: boolean;
}) {
  const telemetryFresh = telemetryIsFresh(server, fresh, now);
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number }>();
  const [menuError, setMenuError] = useState('');

  const applyMenuAction = async (selected: string) => {
    setMenu(undefined);
    if (selected === 'details') return onOpen();
    const next = serverContextPreference(selected, rooms, preference);
    if (next && onSavePreference) await onSavePreference(next);
  };

  const showMenu = async (event?: React.MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    event?.nativeEvent?.stopImmediatePropagation();
    setMenuError('');
    const items = serverContextItems(rooms, preference, Boolean(onSavePreference));
    if (window.hausNative?.showContextMenu) {
      try {
        const selected = await window.hausNative.showContextMenu(items);
        if (selected) await applyMenuAction(selected);
      } catch {
        setMenuError('Your server settings could not be saved. Try again.');
      }
    } else {
      const x = event ? event.clientX : 120;
      const y = event ? event.clientY : 120;
      setMenu({
        items,
        x: Math.max(8, Math.min(x, window.innerWidth - 240)),
        y: Math.max(8, Math.min(y, window.innerHeight - 210)),
      });
    }
  };

  return (
    <>
      <ServerCardTile
        server={toServerSummary(server, room, telemetryFresh, preference)}
        room={room ?? 'Unassigned'}
        fresh={fresh}
        hidden={hidden}
        iconSlot={<ServerIcon server={server} icon={icon} />}
        errorText={menuError || undefined}
        onOpen={onOpen}
        onOptions={(event) => void showMenu(event)}
        onContextMenu={(event) => void showMenu(event)}
        onRestore={
          hidden && onSavePreference
            ? () =>
                void applyMenuAction('app-visibility').catch(() =>
                  setMenuError('Your server settings could not be saved. Try again.'),
                )
            : undefined
        }
      />
      {menu &&
        createPortal(
          <ContextMenu
            {...menu}
            onClose={() => setMenu(undefined)}
            onAction={(selected) =>
              void applyMenuAction(selected).catch(() =>
                setMenuError('Your server settings could not be saved. Try again.'),
              )
            }
          />,
          document.body,
        )}
    </>
  );
}
