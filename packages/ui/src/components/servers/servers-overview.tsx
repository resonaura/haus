/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ServerSummaryRecord } from '@haus/core/transport';
import { colorToken, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Row, Stack, Text } from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import { ServerCardTile } from './server-card.js';
import { ServerGlassPanel } from './server-surfaces.js';

interface ServerGroup {
  readonly id: string;
  readonly name: string;
  readonly servers: readonly ServerSummaryRecord[];
}

function groupServers(servers: readonly ServerSummaryRecord[]): readonly ServerGroup[] {
  const byRoom = new Map<string, ServerSummaryRecord[]>();
  for (const server of servers) {
    const key = server.roomName?.trim() || 'Servers';
    const list = byRoom.get(key);
    if (list) list.push(server);
    else byRoom.set(key, [server]);
  }
  return Array.from(byRoom.entries()).map(([name, items]) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    servers: items,
  }));
}

export function ServersOverviewView({
  columns = 4,
  servers,
  loading,
  error,
  notice,
  onRefresh,
  onSelectServer,
}: {
  readonly columns?: number;
  readonly servers: readonly ServerSummaryRecord[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onRefresh: () => void;
  readonly onSelectServer: (serverId: string) => void;
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
      </Row>

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
                <UiIcon name={group.name === 'Servers' ? 'layout-grid' : 'server'} size={16} />
                <Heading level={2} size={18} weight={600}>
                  {group.name}
                </Heading>
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
