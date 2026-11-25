/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { formatBytes, type ServerServiceRow, type ServerSummaryRecord } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { ServerGlassPanel } from './server-surfaces.js';
import {
  computeServiceUsageScore,
  ServerServiceUsage,
  ServerUsageGauge,
} from './server-visuals.js';

type ManagerFilter = 'all' | 'docker' | 'pm2' | 'systemServices';
type SortKey = 'name' | 'usage' | 'cpu' | 'memory';

function managerDisplayName(manager: ServerServiceRow['manager']): string {
  if (manager === 'docker') return 'Docker';
  if (manager === 'pm2') return 'PM2';
  return 'System';
}

/** Electron-matched Services workspace with segmented manager tabs, DuoBar gauges, and sorting. */
export function ServerServicesTab({
  server,
  canManage,
  onInspectService,
}: {
  readonly server: ServerSummaryRecord;
  readonly canManage: boolean;
  readonly onInspectService?: (service: ServerServiceRow, mode: 'logs' | 'terminal') => void;
}) {
  const [filter, setFilter] = useState<ManagerFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('usage');
  const [sortDesc, setSortDesc] = useState(true);

  const allFilters: readonly {
    readonly id: ManagerFilter;
    readonly label: string;
    readonly count: number;
  }[] = [
    { id: 'all', label: 'All', count: server.services.length },
    {
      id: 'docker',
      label: 'Docker',
      count: server.services.filter((s) => s.manager === 'docker').length,
    },
    {
      id: 'pm2',
      label: 'PM2',
      count: server.services.filter((s) => s.manager === 'pm2').length,
    },
    {
      id: 'systemServices',
      label: 'System',
      count: server.services.filter((s) => s.manager === 'systemServices').length,
    },
  ];
  const filters = allFilters.filter((item) => item.id === 'all' || item.count > 0);

  const visible = server.services
    .filter((item) => filter === 'all' || item.manager === filter)
    .slice()
    .sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'cpu') return ((a.cpuPercent ?? -1) - (b.cpuPercent ?? -1)) * dir;
      if (sortKey === 'memory') return ((a.memoryBytes ?? -1) - (b.memoryBytes ?? -1)) * dir;
      const sa =
        computeServiceUsageScore(a.cpuPercent, a.memoryBytes, server.memoryTotalBytes) ?? -1;
      const sb =
        computeServiceUsageScore(b.cpuPercent, b.memoryBytes, server.memoryTotalBytes) ?? -1;
      return (sa - sb) * dir;
    });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((prev) => !prev);
    else {
      setSortKey(key);
      setSortDesc(key !== 'name');
    }
  };

  const totalCpu =
    filter === 'all' && server.cpuUsage !== null
      ? server.cpuUsage * 100
      : visible.reduce((sum, s) => sum + (s.cpuPercent ?? 0), 0);
  const totalMem =
    filter === 'all' && server.memoryUsedBytes !== null
      ? server.memoryUsedBytes
      : visible.reduce((sum, s) => sum + (s.memoryBytes ?? 0), 0);
  const activeCount = visible.filter((s) => s.running).length;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Row align="end" justify="between" gapPx={16} wrap style={{ layout: { width: pct(100) } }}>
        <Stack gapPx={10}>
          <Heading
            level={3}
            size={28}
            weight={600}
            style={{ typography: { size: 28, letterSpacing: -0.03, lineHeight: 1.15 } }}
          >
            Services
          </Heading>
          <Row
            gapPx={4}
            wrap
            style={{
              layout: { padding: insets(4) },
              material: new SolidMaterial(colorToken('soft')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(16),
            }}
          >
            {filters.map((item) => {
              const active = filter === item.id;
              return (
                <Pressable
                  key={item.id}
                  ariaPressed={active}
                  onActivate={() => setFilter(item.id)}
                  style={{
                    layout: {
                      display: 'flex',
                      direction: 'row',
                      alignItems: 'center',
                      gap: px(6),
                      padding: insets(7, 13),
                      position: 'relative',
                      overflow: 'hidden',
                    },
                    material: new SolidMaterial(active ? colorToken('card') : transparentColor),
                    border: { width: 0, style: 'none', color: transparentColor },
                    corners: corners(12),
                  }}
                >
                  <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
                    {item.label}
                  </Text>
                  <Text
                    size={10.5}
                    tone="muted"
                    style={{ typography: { size: 10.5, tabularNums: true } }}
                  >
                    {String(item.count)}
                  </Text>
                  {active && <GlassRim preset="control" radiusPx={11} opacity={0.62} />}
                </Pressable>
              );
            })}
          </Row>
        </Stack>

        <ServerServiceUsage
          cpuPercent={visible.length > 0 ? totalCpu : null}
          memoryBytes={visible.length > 0 ? totalMem : null}
          totalMemoryBytes={server.memoryTotalBytes}
          inactive={activeCount === 0}
          gaugeSize={46}
        />
      </Row>

      <ServerGlassPanel padding={insets(12, 20)} radius={24}>
        <Row
          align="center"
          justify="between"
          gapPx={12}
          style={{
            layout: {
              width: pct(100),
              padding: insets(6, 0, 10, 0),
              position: 'relative',
              zIndex: 2,
            },
          }}
        >
          <Pressable
            onActivate={() => toggleSort('name')}
            style={{
              layout: {
                display: 'flex',
                direction: 'row',
                alignItems: 'center',
                gap: px(4),
                flexGrow: 1,
              },
              material: new SolidMaterial(transparentColor),
              border: { width: 0, style: 'none', color: transparentColor },
            }}
          >
            <Text size={11} weight={600} tone={sortKey === 'name' ? 'primary' : 'muted'}>
              Service
            </Text>
            {sortKey === 'name' && <UiIcon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={12} />}
          </Pressable>
          <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
            <Pressable
              onActivate={() => toggleSort('usage')}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: px(3),
                  width: px(42),
                },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11} weight={600} tone={sortKey === 'usage' ? 'primary' : 'muted'}>
                Usage
              </Text>
              {sortKey === 'usage' && (
                <UiIcon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={12} />
              )}
            </Pressable>
            <Pressable
              onActivate={() => toggleSort('cpu')}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'end',
                  gap: px(3),
                  width: px(54),
                },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11} weight={600} tone={sortKey === 'cpu' ? 'primary' : 'muted'}>
                CPU
              </Text>
              {sortKey === 'cpu' && (
                <UiIcon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={12} />
              )}
            </Pressable>
            <Pressable
              onActivate={() => toggleSort('memory')}
              style={{
                layout: {
                  display: 'flex',
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'end',
                  gap: px(3),
                  width: px(64),
                },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11} weight={600} tone={sortKey === 'memory' ? 'primary' : 'muted'}>
                Memory
              </Text>
              {sortKey === 'memory' && (
                <UiIcon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={12} />
              )}
            </Pressable>
            {canManage && onInspectService && <Box style={{ layout: { width: px(164) } }} />}
          </Row>
        </Row>

        <Box
          ariaHidden
          style={{
            layout: { width: pct(100), height: px(1), position: 'relative', zIndex: 2 },
            material: new SolidMaterial(colorToken('border')),
          }}
        />

        {visible.length === 0 ? (
          <Box style={{ layout: { padding: insets(24, 0), position: 'relative', zIndex: 2 } }}>
            <Text size={12.5} tone="muted">
              No services match this filter.
            </Text>
          </Box>
        ) : (
          <Stack gapPx={0} style={{ layout: { width: pct(100), position: 'relative', zIndex: 2 } }}>
            {visible.map((service, index) => (
              <Box key={service.id} style={{ layout: { width: pct(100) } }}>
                {index > 0 && (
                  <Box
                    ariaHidden
                    style={{
                      layout: { width: pct(100), height: px(1) },
                      material: new SolidMaterial(colorToken('border')),
                    }}
                  />
                )}
                <Row
                  align="center"
                  justify="between"
                  gapPx={12}
                  style={{ layout: { width: pct(100), minHeight: px(58), padding: insets(9, 0) } }}
                >
                  <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                    <Row align="center" gapPx={8}>
                      <Text
                        size={13}
                        weight={600}
                        style={{ typography: { size: 13, maxLines: 1 } }}
                      >
                        {service.name}
                      </Text>
                      <Box
                        style={{
                          layout: { padding: insets(2, 7) },
                          material: new SolidMaterial(colorToken('soft')),
                          border: { width: 1, color: colorToken('border') },
                          corners: corners(999, 'round'),
                        }}
                      >
                        <Text size={10} weight={500} tone={service.running ? 'primary' : 'muted'}>
                          {service.running ? 'Running' : 'Stopped'}
                        </Text>
                      </Box>
                    </Row>
                    <Text size={11} tone="muted">
                      {`${managerDisplayName(service.manager)} · ${service.status}`}
                    </Text>
                  </Stack>

                  <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
                    <ServerUsageGauge
                      cpuPercent={service.cpuPercent}
                      memoryBytes={service.memoryBytes}
                      totalMemoryBytes={server.memoryTotalBytes}
                      inactive={!service.running}
                      size={38}
                    />
                    <Text
                      size={11.5}
                      tone="muted"
                      style={{
                        layout: { width: px(54) },
                        typography: { size: 11.5, tabularNums: true, align: 'right' },
                      }}
                    >
                      {service.cpuPercent !== null ? `${service.cpuPercent.toFixed(1)}%` : '—'}
                    </Text>
                    <Text
                      size={11.5}
                      tone="muted"
                      style={{
                        layout: { width: px(64) },
                        typography: { size: 11.5, tabularNums: true, align: 'right' },
                      }}
                    >
                      {formatBytes(service.memoryBytes)}
                    </Text>
                    {canManage && onInspectService && (
                      <Row
                        align="center"
                        justify="end"
                        gapPx={4}
                        style={{ layout: { width: px(164), flexShrink: 0 } }}
                      >
                        <HausButton
                          id={`service-logs-${service.id}`}
                          variant="ghost"
                          size="sm"
                          aria-label={`Live logs for ${service.name}`}
                          onPress={() => onInspectService(service, 'logs')}
                        >
                          <Row align="center" gapPx={5}>
                            <UiIcon name="file-text" size={13} />
                            <Text size={11.5}>Logs</Text>
                          </Row>
                        </HausButton>
                        {service.manager === 'docker' && (
                          <HausButton
                            id={`service-terminal-${service.id}`}
                            variant="ghost"
                            size="sm"
                            disabled={!service.running}
                            aria-label={`Open terminal in ${service.name}`}
                            onPress={() => onInspectService(service, 'terminal')}
                          >
                            <Row align="center" gapPx={5}>
                              <UiIcon name="terminal" size={13} />
                              <Text size={11.5}>Terminal</Text>
                            </Row>
                          </HausButton>
                        )}
                      </Row>
                    )}
                  </Row>
                </Row>
              </Box>
            ))}
          </Stack>
        )}
      </ServerGlassPanel>
    </Stack>
  );
}
