/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import {
  buildServiceGroupSummary,
  computeServiceUsageScore,
  formatBytes,
  formatServiceCpuPercent,
  formatUptime,
  type ServerServiceManager,
  type ServerServiceRow,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { ServerServicesTableHeader, type ServicesSortKey } from './parts/service-table-header.js';
import { ServiceManagerBadgeIcon } from './server-icons.js';
import { ServerGlassPanel } from './server-surfaces.js';
import { ServerServiceUsage, ServerUsageGauge } from './server-visuals.js';

type ManagerFilter = 'all' | ServerServiceManager;

function managerDisplayName(manager: ServerServiceManager): string {
  if (manager === 'docker') return 'Docker';
  if (manager === 'pm2') return 'PM2';
  return 'System Services';
}

function rowTrailingText(service: ServerServiceRow, filter: ManagerFilter): string {
  if (filter === 'all') return managerDisplayName(service.manager);
  if (service.trailing) return service.trailing;
  return service.uptimeSeconds !== null ? formatUptime(service.uptimeSeconds) : '—';
}

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
  const [sortKey, setSortKey] = useState<ServicesSortKey>('usage');
  const [sortDesc, setSortDesc] = useState(true);

  const allServices = server.services.filter((s) => !s.groupedWithPm2);
  const dockerRows = server.services.filter((s) => s.manager === 'docker');
  const pm2Rows = server.services.filter((s) => s.manager === 'pm2');
  const sysRows = server.services.filter((s) => s.manager === 'systemServices');

  const allFilters: readonly {
    readonly id: ManagerFilter;
    readonly label: string;
    readonly count: number;
  }[] = [
    { id: 'all', label: 'All', count: allServices.length },
    { id: 'docker', label: 'Docker', count: dockerRows.length },
    { id: 'pm2', label: 'PM2', count: pm2Rows.length },
    { id: 'systemServices', label: 'System', count: sysRows.length },
  ];
  const filters = allFilters.filter((item) => item.id === 'all' || item.count > 0);
  const activeFilter = filters.some((f) => f.id === filter) ? filter : 'all';

  const baseRows =
    activeFilter === 'all'
      ? allServices
      : server.services.filter((s) => s.manager === activeFilter);

  const visible = baseRows.slice().sort((a, b) => {
    const dir = sortDesc ? -1 : 1;
    if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
    if (sortKey === 'status') return a.status.localeCompare(b.status) * dir;
    if (sortKey === 'extra') {
      return rowTrailingText(a, activeFilter).localeCompare(rowTrailingText(b, activeFilter)) * dir;
    }
    if (sortKey === 'cpu') return ((a.cpuPercent ?? -1) - (b.cpuPercent ?? -1)) * dir;
    if (sortKey === 'memory') return ((a.memoryBytes ?? -1) - (b.memoryBytes ?? -1)) * dir;
    const sa = computeServiceUsageScore(a.cpuPercent, a.memoryBytes, server.memoryTotalBytes) ?? -1;
    const sb = computeServiceUsageScore(b.cpuPercent, b.memoryBytes, server.memoryTotalBytes) ?? -1;
    return (sa - sb) * dir || a.name.localeCompare(b.name);
  });

  const toggleSort = (key: ServicesSortKey) => {
    if (sortKey === key) setSortDesc((prev) => !prev);
    else {
      setSortKey(key);
      setSortDesc(key === 'usage' || key === 'cpu' || key === 'memory');
    }
  };

  const selectedManagerGroup =
    activeFilter === 'all'
      ? undefined
      : (server.serviceGroups?.find((g) => g.id === activeFilter) ??
        buildServiceGroupSummary({
          id: activeFilter,
          name: managerDisplayName(activeFilter),
          source: activeFilter,
          measured: true,
          rows: baseRows,
        }));

  const headerCpu =
    activeFilter === 'all'
      ? server.cpuUsage !== null
        ? server.cpuUsage * 100
        : null
      : (selectedManagerGroup?.cpuPercent ?? null);
  const headerMem =
    activeFilter === 'all' ? server.memoryUsedBytes : (selectedManagerGroup?.memoryBytes ?? null);
  const headerCpuIncomplete =
    activeFilter === 'all' ? false : Boolean(selectedManagerGroup?.cpuIncomplete);
  const headerMemIncomplete =
    activeFilter === 'all' ? false : Boolean(selectedManagerGroup?.memoryIncomplete);
  const activeCount = baseRows.filter((s) => s.running).length;
  const trailingHeader =
    activeFilter === 'all' ? 'Source' : activeFilter === 'docker' ? 'Image' : 'Uptime';
  const rowLayoutSignature = `${activeFilter}:${sortKey}:${sortDesc}:${visible.map((s) => s.id).join('|')}`;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Row align="end" justify="between" gapPx={16} wrap style={{ layout: { width: pct(100) } }}>
        <Stack gapPx={10}>
          <Heading
            level={3}
            size={24}
            weight={600}
            style={{ typography: { size: 24, letterSpacing: -0.025, lineHeight: 1.15 } }}
          >
            Services
          </Heading>
          {filters.length > 1 && (
            <Row
              gapPx={4}
              wrap
              ariaLabel="Service type"
              style={{
                layout: { padding: insets(4) },
                material: new SolidMaterial(colorToken('soft')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              {filters.map((item) => {
                const active = activeFilter === item.id;
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
                        gap: px(7),
                        padding: insets(7, 13),
                        position: 'relative',
                        overflow: 'hidden',
                      },
                      material: new SolidMaterial(active ? colorToken('card') : transparentColor),
                      border: { width: 0, style: 'none', color: transparentColor },
                      corners: corners(12),
                    }}
                  >
                    {item.id === 'all' ? (
                      <UiIcon name="boxes" size={14} />
                    ) : (
                      <ServiceManagerBadgeIcon kind={item.id} server={server} size={14} />
                    )}
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
          )}
        </Stack>

        <ServerServiceUsage
          cpuPercent={baseRows.length > 0 || activeFilter === 'all' ? headerCpu : null}
          memoryBytes={baseRows.length > 0 || activeFilter === 'all' ? headerMem : null}
          totalMemoryBytes={server.memoryTotalBytes}
          system={activeFilter === 'all'}
          cpuIncomplete={headerCpuIncomplete}
          memoryIncomplete={headerMemIncomplete}
          inactive={activeFilter !== 'all' && activeCount === 0}
          gaugeSize={46}
        />
      </Row>

      <ServerGlassPanel padding={insets(12, 20)} radius={24}>
        <ServerServicesTableHeader
          sortKey={sortKey}
          sortDesc={sortDesc}
          trailingHeader={trailingHeader}
          showActionsColumn={Boolean(canManage && onInspectService)}
          onToggleSort={toggleSort}
        />

        <Box
          ariaHidden
          style={{
            layout: { width: pct(100), height: px(1), position: 'relative', zIndex: 2 },
            material: new SolidMaterial(colorToken('border')),
          }}
        />

        {visible.length === 0 ? (
          <Stack
            align="center"
            gapPx={8}
            style={{
              layout: { width: pct(100), padding: insets(28, 0), position: 'relative', zIndex: 2 },
            }}
          >
            <UiIcon name="settings-2" size={24} />
            <Text size={12.5} tone="muted">
              {server.services.length > 0
                ? `No ${activeFilter === 'docker' ? 'containers' : 'services'} are listed.`
                : 'No service managers have been reported by this server.'}
            </Text>
          </Stack>
        ) : (
          <Stack gapPx={0} style={{ layout: { width: pct(100), position: 'relative', zIndex: 2 } }}>
            {visible.map((service, index) => (
              <Box
                key={service.id}
                layoutTransition={rowLayoutSignature}
                style={{ layout: { width: pct(100) } }}
              >
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
                  <Row
                    align="center"
                    gapPx={12}
                    style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                  >
                    <Box style={{ layout: { width: px(48), flexShrink: 0 } }}>
                      <ServerUsageGauge
                        cpuPercent={service.cpuPercent}
                        memoryBytes={service.memoryBytes}
                        totalMemoryBytes={server.memoryTotalBytes}
                        inactive={service.manager === 'docker' && !service.running}
                        size={40}
                      />
                    </Box>

                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text
                        size={13}
                        weight={600}
                        style={{ typography: { size: 13, maxLines: 1 } }}
                      >
                        {service.name}
                      </Text>
                      <Text
                        size={11}
                        tone="muted"
                        style={{ typography: { size: 11, maxLines: 1 } }}
                      >
                        {service.subtitle || managerDisplayName(service.manager)}
                      </Text>
                    </Stack>
                  </Row>

                  <Row align="center" gapPx={12} style={{ layout: { flexShrink: 0 } }}>
                    <Stack gapPx={1} style={{ layout: { width: px(96) } }}>
                      <Text
                        size={11.5}
                        weight={500}
                        tone={
                          service.attention ? 'critical' : service.running ? 'primary' : 'muted'
                        }
                        style={{ typography: { size: 11.5, maxLines: 1 } }}
                      >
                        {service.status}
                      </Text>
                      {service.statusDetail && service.statusDetail !== service.status ? (
                        <Text
                          size={10}
                          tone="muted"
                          style={{ typography: { size: 10, maxLines: 1 } }}
                        >
                          {service.statusDetail}
                        </Text>
                      ) : null}
                    </Stack>

                    <Text
                      size={11.5}
                      tone="muted"
                      style={{
                        layout: { width: px(58) },
                        typography: { size: 11.5, tabularNums: true, align: 'right' },
                      }}
                    >
                      {formatServiceCpuPercent(service.cpuPercent)}
                    </Text>

                    <Text
                      size={11.5}
                      tone="muted"
                      style={{
                        layout: { width: px(70) },
                        typography: { size: 11.5, tabularNums: true, align: 'right' },
                      }}
                    >
                      {formatBytes(service.memoryBytes)}
                    </Text>

                    <Text
                      size={11}
                      tone="muted"
                      style={{
                        layout: { width: px(124) },
                        typography: { size: 11, maxLines: 1 },
                      }}
                    >
                      {rowTrailingText(service, activeFilter)}
                    </Text>

                    {canManage && onInspectService && (
                      <Row
                        align="center"
                        justify="end"
                        gapPx={4}
                        style={{ layout: { width: px(158), flexShrink: 0 } }}
                      >
                        <HausButton
                          id={`service-logs-${service.rawId ?? service.id}`}
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
                            id={`service-terminal-${service.rawId ?? service.id}`}
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

        <Row
          align="center"
          justify="between"
          style={{
            layout: {
              width: pct(100),
              padding: insets(10, 0, 4, 0),
              margin: insets(4, 0, 0, 0),
              position: 'relative',
              zIndex: 2,
            },
          }}
        >
          <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
            {`${activeCount} running · ${baseRows.length} total`}
          </Text>
        </Row>
      </ServerGlassPanel>
    </Stack>
  );
}
