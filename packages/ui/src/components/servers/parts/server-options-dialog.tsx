/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  ServerDetailTabId,
  ServerIdentityPatch,
  ServerResourceSample,
  ServerRoomOption,
  ServerSummaryRecord,
} from '@haus/core/transport';
import { px } from '../../../ir/geometry.js';
import { HausButton, Row, Stack, Text } from '../../../primitives/index.js';
import { Dialog } from '../../dialog.js';
import { UiIcon } from '../../icon.js';
import type { ServerDevicePreferenceInput } from '../servers-workspace.js';

export function applyServerPreferences(
  servers: readonly ServerSummaryRecord[],
  rooms: readonly ServerRoomOption[],
  preferences: Readonly<Record<string, ServerDevicePreferenceInput | undefined>>,
): readonly ServerSummaryRecord[] {
  const roomNameById = new Map(rooms.map((r) => [r.id, r.name]));
  return servers
    .filter((item) => preferences[item.id]?.hidden !== true)
    .map((item) => {
      const pref = preferences[item.id];
      if (!pref) return item;
      const roomId = pref.areaId || undefined;
      const roomName = roomId ? (roomNameById.get(roomId) ?? item.roomName) : undefined;
      return {
        ...item,
        name: pref.name?.trim() || item.name,
        roomId,
        roomName,
        icon: pref.icon || item.icon,
        favorite: Boolean(pref.favorite ?? item.favorite),
      };
    });
}

export function appendHistoryTick(
  list: readonly ServerResourceSample[],
  sample: ServerResourceSample,
): readonly ServerResourceSample[] {
  const last = list.at(-1);
  if (last && sample.time <= last.time) return list;
  return [...list.filter((entry) => entry.time > sample.time - 65_000), sample].slice(-66);
}

export function ServerOptionsDialog({
  server,
  canManage,
  onOpenTab,
  onSavePreference,
  onClose,
}: {
  readonly server: ServerSummaryRecord;
  readonly canManage: boolean;
  readonly onOpenTab: (serverId: string, tab: ServerDetailTabId) => void;
  readonly onSavePreference: (serverId: string, next: ServerIdentityPatch) => void | Promise<void>;
  readonly onClose: () => void;
}) {
  return (
    <Dialog title={server.name} onClose={onClose}>
      <Stack gapPx={8} style={{ layout: { minWidth: px(260) } }}>
        <HausButton
          variant="secondary"
          size="sm"
          onPress={() => {
            onClose();
            onOpenTab(server.id, 'overview');
          }}
        >
          <Row align="center" gapPx={8}>
            <UiIcon name="server" size={14} />
            <Text size={12.5}>Open server details</Text>
          </Row>
        </HausButton>
        {canManage && (
          <HausButton
            variant="ghost"
            size="sm"
            onPress={() => {
              onClose();
              onOpenTab(server.id, 'settings');
            }}
          >
            <Row align="center" gapPx={8}>
              <UiIcon name="settings-2" size={14} />
              <Text size={12.5}>Name, room &amp; icon settings</Text>
            </Row>
          </HausButton>
        )}
        <HausButton
          variant="ghost"
          size="sm"
          onPress={() => {
            onClose();
            void onSavePreference(server.id, {
              name: server.name,
              areaId: server.roomId,
              favorite: !server.favorite,
            });
          }}
        >
          <Row align="center" gapPx={8}>
            <UiIcon name="heart" size={14} />
            <Text size={12.5}>
              {server.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
            </Text>
          </Row>
        </HausButton>
        <HausButton
          variant="ghost"
          size="sm"
          onPress={() => {
            onClose();
            void onSavePreference(server.id, {
              name: server.name,
              areaId: server.roomId,
              hidden: true,
            });
          }}
        >
          <Row align="center" gapPx={8}>
            <UiIcon name="eye-off" size={14} />
            <Text size={12.5}>Hide from Haus</Text>
          </Row>
        </HausButton>
      </Stack>
    </Dialog>
  );
}
