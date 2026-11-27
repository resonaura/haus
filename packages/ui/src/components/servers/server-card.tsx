/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import {
  formatPercent,
  formatRatio,
  resolveServerConnectionState,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { insets, pct } from '../../ir/geometry.js';
import { Text } from '../../primitives/elements.js';
import { DeviceTile, type DeviceTileBatteryData } from '../devices/device.js';
import type { UiIconName } from '../icons.js';
import { ServerDistroIcon } from './server-icons.js';

export function resolveServerGlyphName(server: {
  readonly kind: ServerSummaryRecord['kind'];
  readonly nvr?: { readonly hasNvr?: boolean };
}): UiIconName {
  if (server.kind === 'nvr' || server.nvr?.hasNvr) return 'hard-drive';
  if (server.kind === 'ssh') return 'terminal';
  if (server.kind === 'home-assistant') return 'house';
  return 'server';
}

export function resolveServerKindLabel(kind: ServerSummaryRecord['kind']): string {
  if (kind === 'home-assistant') return 'Home Assistant';
  if (kind === 'hub') return 'Haus Hub';
  if (kind === 'ssh') return 'SSH server';
  if (kind === 'nvr') return 'Home NVR';
  return 'Home server';
}

export interface ServerCardTileProps {
  readonly server: ServerSummaryRecord;
  readonly room?: string;
  readonly fresh?: boolean;
  readonly hidden?: boolean;
  readonly iconSlot?: ReactNode;
  readonly errorText?: string;
  readonly onOpen: () => void;
  readonly onOptions?: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
  readonly onSecondaryPress?: () => void;
  readonly onRestore?: () => void;
}

/**
 * Shared 1:1 Electron-matched server card built directly on `DeviceTile` so servers
 * share the exact tile surface, corner shape, icon orb, rim lighting, hover lift,
 * battery/favorite indicators, and options chrome of every other Haus device card,
 * while accepting custom server/OS icons via `iconSlot`.
 */
export function ServerCardTile({
  server,
  room,
  fresh = true,
  hidden = false,
  iconSlot,
  errorText,
  onOpen,
  onOptions,
  onContextMenu,
  onSecondaryPress,
  onRestore,
}: ServerCardTileProps) {
  const connState = !fresh ? 'unknown' : resolveServerConnectionState(server);
  const unavailable = fresh && server.online === false;
  const stateLabel = !fresh
    ? 'Last known status'
    : connState === 'paused'
      ? 'Paused'
      : connState === 'online'
        ? 'Connected'
        : connState === 'offline'
          ? 'Offline'
          : 'Not checked';

  const memRatio = formatRatio(server.memoryUsedBytes, server.memoryTotalBytes);
  const summary =
    !hidden && server.enabled && fresh && server.cpuUsage !== null && memRatio !== null
      ? `CPU ${formatPercent(server.cpuUsage)} · RAM ${formatPercent(memRatio)}`
      : stateLabel;

  const hasBattery =
    typeof server.batteryLevel === 'number' || typeof server.batteryCharging === 'boolean';
  const battery: DeviceTileBatteryData | undefined = hasBattery
    ? {
        level: server.batteryLevel ?? undefined,
        charging: server.batteryCharging,
      }
    : undefined;

  return (
    <DeviceTile
      desktop
      name={server.name}
      subtitle={room ?? resolveServerKindLabel(server.kind)}
      state={summary}
      available={!unavailable}
      active={false}
      favorite={server.favorite}
      battery={battery}
      showStatusDot={false}
      icon={iconSlot ?? <ServerDistroIcon server={server} size={22} />}
      iconName={resolveServerGlyphName(server)}
      quickLabel={`Open ${server.name}`}
      quickDisabled={false}
      onQuick={onOpen}
      onOpen={onOpen}
      onMore={onOptions ? () => onOptions() : undefined}
      onMorePress={onOptions}
      moreLabel={`Options for ${server.name}`}
      onRestore={hidden ? onRestore : undefined}
      restoreLabel="Restore to Haus"
      actions={
        errorText ? (
          <Text
            className="server-card-error"
            role="alert"
            size={11}
            tone="critical"
            style={{ layout: { margin: insets(10, 0, 0, 0), position: 'relative', zIndex: 2 } }}
          >
            {errorText}
          </Text>
        ) : undefined
      }
      frame={{
        id: `server-card-${server.id}`,
        tabIndex: -1,
        className: `accessory-tile server-tile ${unavailable ? 'is-unavailable' : ''}`,
        onContextMenu,
        onSecondaryPress,
        style: {
          layout: { width: pct(100) },
          cursor: 'pointer',
        },
      }}
    />
  );
}
