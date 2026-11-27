/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { resolveRoomIconName, type ServerSummaryRecord } from '@haus/core/transport';
import { colorToken, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import { UI_ICONS, type UiIconName } from '../icons.js';
import { ServerCardTile } from './server-card.js';
import { ServerGlassPanel } from './server-surfaces.js';

interface ServerGroup {
  readonly id: string;
  readonly roomId?: string;
  readonly name: string;
  readonly servers: readonly ServerSummaryRecord[];
}

function groupServers(servers: readonly ServerSummaryRecord[]): readonly ServerGroup[] {
  const byRoom = new Map<string, { roomId?: string; name: string; items: ServerSummaryRecord[] }>();
  for (const server of servers) {
    const name = server.roomName?.trim() || 'Servers';
    const key = server.roomId ? `room:${server.roomId}` : `name:${name}`;
    const existing = byRoom.get(key);
    if (existing) existing.items.push(server);
    else byRoom.set(key, { roomId: server.roomId, name, items: [server] });
  }
  return Array.from(byRoom.entries()).map(([key, entry]) => ({
    id: key.toLowerCase().replace(/\s+/g, '-'),
    roomId: entry.roomId,
    name: entry.name,
    servers: entry.items,
  }));
}

function resolveGroupIcon(
  group: ServerGroup,
  roomIcons?: Readonly<Record<string, string>>,
): UiIconName {
  if (!group.roomId && group.name === 'Servers') return 'layout-grid';
  const candidate = resolveRoomIconName(
    group.name,
    group.roomId ? roomIcons?.[group.roomId] : undefined,
  );
  return Object.hasOwn(UI_ICONS, candidate) ? (candidate as UiIconName) : 'server';
}

export function ServersOverviewView({
  columns = 4,
  servers,
  roomIcons,
  loading,
  error,
  notice,
  canManage,
  clusterSlot,
  onAddHub,
  onRefresh,
  onSelectServer,
  onOpenRoom,
  onServerContextMenu,
}: {
  readonly columns?: number;
  readonly servers: readonly ServerSummaryRecord[];
  readonly roomIcons?: Readonly<Record<string, string>>;
  readonly loading?: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly canManage?: boolean;
  readonly clusterSlot?: React.ReactNode;
  readonly onAddHub?: () => void;
  readonly onRefresh: () => void;
  readonly onSelectServer: (serverId: string) => void;
  readonly onOpenRoom?: (roomId: string) => void;
  readonly onServerContextMenu?: (server: ServerSummaryRecord) => void;
}) {
  const groups = groupServers(servers);

  return (
    <Stack gapPx={22} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
        <HausButton
          id="servers-refresh"
          variant="outline"
          size="sm"
          disabled={loading}
          onPress={onRefresh}
        >
          <Row align="center" gapPx={6}>
            <UiIcon name="refresh-cw" size={14} />
            <Text size={12.5}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
          </Row>
        </HausButton>
        {canManage && onAddHub && (
          <HausButton id="servers-add-hub" variant="secondary" size="sm" onPress={onAddHub}>
            <Row align="center" gapPx={6}>
              <UiIcon name="plus" size={14} />
              <Text size={12.5}>Add server</Text>
            </Row>
          </HausButton>
        )}
      </Row>

      {clusterSlot}

      {(error || notice) && (
        <ServerGlassPanel padding={insets(14, 18)} radius={20}>
          <Row align="center" gapPx={12}>
            <UiIcon name="alert-circle" size={18} />
            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              {error && (
                <Text size={12.5} weight={500} tone="critical">
                  {error}
                </Text>
              )}
              {notice && (
                <Text size={12} tone="muted">
                  {notice}
                </Text>
              )}
            </Stack>
          </Row>
        </ServerGlassPanel>
      )}

      {servers.length === 0 ? (
        <ServerGlassPanel padding={insets(40, 24)} radius={24}>
          <Stack align="center" gapPx={10} style={{ layout: { width: pct(100) } }}>
            <UiIcon name="server" size={32} />
            <Heading level={3} size={17} weight={600}>
              A home for your home servers.
            </Heading>
            <Text
              size={12.5}
              tone="muted"
              style={{ typography: { align: 'center', lineHeight: 1.5 } }}
            >
              Connect your Haus Hub to see its resources, manage optional servers and keep recovery
              copies together.
            </Text>
          </Stack>
        </ServerGlassPanel>
      ) : (
        <Stack gapPx={24} style={{ layout: { width: pct(100) } }}>
          {groups.map((group) => (
            <Stack key={group.id} gapPx={12} style={{ layout: { width: pct(100) } }}>
              <Row align="center" gapPx={10} style={{ layout: { width: pct(100) } }}>
                <UiIcon name={resolveGroupIcon(group, roomIcons)} size={16} />
                {group.roomId && onOpenRoom ? (
                  <Pressable
                    onActivate={() => onOpenRoom(group.roomId!)}
                    style={{
                      layout: {
                        display: 'flex',
                        direction: 'row',
                        alignItems: 'center',
                        gap: px(5),
                      },
                      material: new SolidMaterial(transparentColor),
                      border: { width: 0, style: 'none', color: transparentColor },
                    }}
                  >
                    <Heading level={2} size={18} weight={600}>
                      {group.name}
                    </Heading>
                    <UiIcon name="chevron-right" size={14} />
                  </Pressable>
                ) : (
                  <Heading level={2} size={18} weight={600}>
                    {group.name}
                  </Heading>
                )}
                <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
                  {`${group.servers.length} ${group.servers.length === 1 ? 'server' : 'servers'}`}
                </Text>
                <Box
                  ariaHidden
                  style={{
                    layout: { flexGrow: 1, height: px(1) },
                    material: new SolidMaterial(colorToken('border')),
                  }}
                />
              </Row>

              <DashboardGrid columns={columns}>
                {group.servers.map((server) => (
                  <ServerCardTile
                    key={server.id}
                    server={server}
                    room={server.roomName}
                    onOpen={() => onSelectServer(server.id)}
                    onOptions={onServerContextMenu ? () => onServerContextMenu(server) : undefined}
                    onSecondaryPress={
                      onServerContextMenu ? () => onServerContextMenu(server) : undefined
                    }
                  />
                ))}
              </DashboardGrid>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
