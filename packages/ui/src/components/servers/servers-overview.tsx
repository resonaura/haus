/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  formatBytes,
  formatPercent,
  formatRatio,
  resolveServerConnectionState,
  summarizeServerDisks,
  type ServerConnectionState,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';

function statusBadgeColors(state: ServerConnectionState) {
  if (state === 'online') {
    return {
      bg: rgba(52, 211, 153, 0.14),
      border: rgba(52, 211, 153, 0.35),
      label: 'Online',
    };
  }
  if (state === 'paused') {
    return {
      bg: colorToken('surface'),
      border: colorToken('border'),
      label: 'Paused',
    };
  }
  if (state === 'offline') {
    return {
      bg: rgba(239, 68, 68, 0.14),
      border: rgba(239, 68, 68, 0.35),
      label: 'Offline',
    };
  }
  return {
    bg: colorToken('surface'),
    border: colorToken('border'),
    label: 'Unknown',
  };
}

function MeterBar({ label, ratio, caption }: { readonly label: string; readonly ratio: number | null; readonly caption: string }) {
  const fillPct = Math.round(Math.max(0, Math.min(1, ratio ?? 0)) * 100);
  return (
    <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
        <Text size={11.5} tone="muted">
          {label}
        </Text>
        <Text size={11.5} weight={500}>
          {caption}
        </Text>
      </Row>
      <Box
        style={{
          layout: { width: pct(100), height: px(5) },
          material: new SolidMaterial(colorToken('surface')),
          corners: corners(3),
        }}
      >
        <Box
          style={{
            layout: { width: pct(fillPct), height: pct(100) },
            material: new SolidMaterial(colorToken('accent')),
            corners: corners(3),
          }}
        />
      </Box>
    </Stack>
  );
}

export function ServersOverviewView({
  columns = 3,
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
  return (
    <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
      <Row
        align="center"
        justify="between"
        gapPx={16}
        wrap
        style={{
          layout: { width: pct(100), padding: insets(20) },
          material: new SolidMaterial(colorToken('surfaceSecondary')),
          border: { width: 1, color: colorToken('border') },
          corners: corners(16),
        }}
      >
        <Row align="center" gapPx={14} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
          <Box
            style={{
              layout: { width: px(42), height: px(42), alignItems: 'center', justifyContent: 'center' },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(12),
            }}
          >
            <UiIcon name="server" size={20} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={15} weight={600}>
              Your home infrastructure.
            </Text>
            <Text size={12.5} tone="muted">
              Monitor hosts, disks, NVR storage, system services, logs and direct shells.
            </Text>
          </Stack>
        </Row>
        <HausButton variant="outline" size="sm" disabled={loading} onPress={onRefresh}>
          <UiIcon name="refresh-cw" size={14} />
          <Text size={12.5}>{loading ? 'Refreshing…' : 'Refresh'}</Text>
        </HausButton>
      </Row>

      {notice && <Text size={12} tone="muted">{notice}</Text>}
      {error && <Text size={12} tone="critical">{error}</Text>}

      {servers.length === 0 ? (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(38, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="server" size={28} />
          <Heading level={3} size={16} weight={600}>
            No servers connected
          </Heading>
          <Text size={12} tone="muted">
            Connect to a Haus Hub or node peer to inspect system metrics and terminals.
          </Text>
        </Stack>
      ) : (
        <DashboardGrid columns={columns}>
          {servers.map((server) => {
            const state = resolveServerConnectionState(server);
            const badge = statusBadgeColors(state);
            const memRatio = formatRatio(server.memoryUsedBytes, server.memoryTotalBytes);
            const disks = summarizeServerDisks(server.disks);
            return (
              <Pressable
                key={server.id}
                id={`server-card-${server.id}`}
                onActivate={() => onSelectServer(server.id)}
                style={{
                  layout: {
                    direction: 'column',
                    justifyContent: 'between',
                    gap: px(14),
                    padding: insets(16),
                    width: pct(100),
                  },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(16),
                  states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
                }}
              >
                <Row align="start" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
                  <Row align="center" gapPx={10} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                    <Box
                      style={{
                        layout: {
                          width: px(36),
                          height: px(36),
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        },
                        material: new SolidMaterial(colorToken('surface')),
                        border: { width: 1, color: colorToken('border') },
                        corners: corners(10),
                      }}
                    >
                      <UiIcon name={server.nvr?.hasNvr ? 'video' : 'server'} size={18} />
                    </Box>
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text size={14.5} weight={600}>
                        {server.name}
                      </Text>
                      <Text size={11.5} tone="muted">
                        {server.kind === 'hub' ? 'Haus Hub' : server.kind === 'nvr' ? 'NVR Node' : 'Host'}
                      </Text>
                    </Stack>
                  </Row>
                  <Box
                    style={{
                      layout: { padding: insets(3, 9), flexShrink: 0 },
                      material: new SolidMaterial(badge.bg),
                      border: { width: 1, color: badge.border },
                      corners: corners(999),
                    }}
                  >
                    <Text size={11}>{badge.label}</Text>
                  </Box>
                </Row>

                <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
                  <MeterBar label="CPU" ratio={server.cpuUsage} caption={formatPercent(server.cpuUsage)} />
                  <MeterBar
                    label="Memory"
                    ratio={memRatio}
                    caption={
                      server.memoryTotalBytes
                        ? `${formatBytes(server.memoryUsedBytes)} / ${formatBytes(server.memoryTotalBytes)}`
                        : '—'
                    }
                  />
                </Stack>

                <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
                  <Text size={11.5} tone="muted">
                    {disks.volumeCount > 0
                      ? `${formatBytes(disks.usedBytes)} / ${formatBytes(disks.totalBytes)}`
                      : server.osLabel}
                  </Text>
                  <Row align="center" gapPx={4}>
                    <Text size={12} weight={500}>
                      Open
                    </Text>
                    <UiIcon name="chevron-right" size={14} />
                  </Row>
                </Row>
              </Pressable>
            );
          })}
        </DashboardGrid>
      )}
    </Stack>
  );
}
