/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatBytes,
  formatPercent,
  formatRatio,
  formatUptime,
  summarizeServerDisks,
  type ServerDetailTabId,
  type ServerResourceSample,
  type ServerServiceRow,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Grid, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { BatteryLevelIcon } from '../devices/battery.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';
import { ServerFactRow, ServerGlassPanel } from './server-surfaces.js';
import { ServerServiceUsage, ServerSparkline } from './server-visuals.js';

interface ServiceGroupSummary {
  readonly id: ServerServiceRow['manager'];
  readonly name: string;
  readonly icon: UiIconName;
  readonly active: number;
  readonly total: number;
  readonly cpuPercent: number | null;
  readonly memoryBytes: number | null;
}

function summarizeServiceGroups(
  services: readonly ServerServiceRow[],
): readonly ServiceGroupSummary[] {
  const specs: readonly { id: ServerServiceRow['manager']; name: string; icon: UiIconName }[] = [
    { id: 'docker', name: 'Docker', icon: 'boxes' },
    { id: 'pm2', name: 'PM2', icon: 'activity' },
    { id: 'systemServices', name: 'System services', icon: 'settings-2' },
  ];
  const groups: ServiceGroupSummary[] = [];
  for (const spec of specs) {
    const matching = services.filter((item) => item.manager === spec.id);
    if (matching.length === 0) continue;
    let cpuSum = 0;
    let hasCpu = false;
    let memSum = 0;
    let hasMem = false;
    for (const row of matching) {
      if (row.cpuPercent !== null) {
        cpuSum += row.cpuPercent;
        hasCpu = true;
      }
      if (row.memoryBytes !== null) {
        memSum += row.memoryBytes;
        hasMem = true;
      }
    }
    groups.push({
      ...spec,
      active: matching.filter((item) => item.running).length,
      total: matching.length,
      cpuPercent: hasCpu ? cpuSum : null,
      memoryBytes: hasMem ? memSum : null,
    });
  }
  return groups;
}

export function ServerOverviewTab({
  server,
  history = [],
  onSelectTab,
}: {
  readonly server: ServerSummaryRecord;
  readonly history?: readonly ServerResourceSample[];
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
}) {
  const memRatio = formatRatio(server.memoryUsedBytes, server.memoryTotalBytes);
  const swapRatio = server.swapSupported
    ? formatRatio(server.swapUsedBytes, server.swapTotalBytes)
    : null;
  const disks = summarizeServerDisks(server.disks);
  const serviceGroups = summarizeServiceGroups(server.services);
  const usagePct = Math.round(Math.max(0, Math.min(1, disks.usageRatio ?? 0)) * 100);
  const scopeLabel = server.reportingScope === 'container' ? 'Container' : 'Host';

  const resourceCards: readonly {
    readonly label: string;
    readonly icon: UiIconName;
    readonly value: string;
    readonly detail: string;
    readonly field?: 'cpu' | 'memory' | 'swap';
  }[] = [
    {
      label: 'Processor',
      icon: 'cpu',
      value: formatPercent(server.cpuUsage),
      detail: server.cpuCores ? `${server.cpuCores} logical cores` : 'Core count unavailable',
      field: 'cpu',
    },
    {
      label: 'Memory',
      icon: 'memory-stick',
      value: formatPercent(memRatio),
      detail:
        server.memoryUsedBytes !== null && server.memoryTotalBytes !== null
          ? `${formatBytes(server.memoryUsedBytes)} of ${formatBytes(server.memoryTotalBytes)}`
          : 'Memory information unavailable',
      field: 'memory',
    },
    {
      label: 'Swap',
      icon: 'arrow-left-right',
      value:
        server.swapSupported && server.swapUsedBytes !== null
          ? formatBytes(server.swapUsedBytes)
          : '—',
      detail: server.swapSupported
        ? server.swapTotalBytes === 0
          ? 'Swap is not configured'
          : `${formatBytes(server.swapTotalBytes)} total · ${formatPercent(swapRatio)} used`
        : 'Not reported by this server',
      field: server.swapSupported ? 'swap' : undefined,
    },
    {
      label: 'Uptime',
      icon: 'clock-3',
      value: formatUptime(server.uptimeSeconds),
      detail: `${scopeLabel} metrics`,
    },
  ];

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <Grid
        columns={4}
        minColumnWidthPx={170}
        gapPx={12}
        style={{ layout: { width: pct(100), flexShrink: 0 } }}
      >
        {resourceCards.map((card) => (
          <ServerGlassPanel
            key={card.label}
            interactive
            padding={insets(18, 18, 48, 18)}
            radius={24}
            style={{ layout: { minWidth: px(0), minHeight: px(142) } }}
          >
            <Row align="center" gapPx={7}>
              <UiIcon name={card.icon} size={15} />
              <Text size={11} tone="muted">
                {card.label}
              </Text>
            </Row>
            <Text
              size={30}
              weight={500}
              style={{
                layout: { margin: insets(12, 0, 0, 0) },
                typography: {
                  size: 30,
                  weight: 500,
                  letterSpacing: -0.03,
                  lineHeight: 1.2,
                  tabularNums: true,
                },
              }}
            >
              {card.value}
            </Text>
            <Text
              size={10.5}
              tone="muted"
              style={{
                layout: { margin: insets(4, 0, 0, 0) },
                typography: { size: 10.5, lineHeight: 1.45 },
              }}
            >
              {card.detail}
            </Text>
            {card.field && <ServerSparkline history={history} field={card.field} />}
          </ServerGlassPanel>
        ))}
      </Grid>

      <Grid
        columns={2}
        minColumnWidthPx={300}
        gapPx={12}
        style={{ layout: { width: pct(100), flexShrink: 0 } }}
      >
        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Row align="center" gapPx={9} style={{ layout: { margin: insets(0, 0, 14, 0) } }}>
            <UiIcon name="monitor" size={17} />
            <Heading level={3} size={15} weight={600}>
              System
            </Heading>
          </Row>
          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            <ServerFactRow
              label="Processor"
              icon={<UiIcon name="cpu" size={13} />}
              value={
                <Text size={13} weight={500}>
                  {server.cpuModel}
                </Text>
              }
              subContent={
                <Stack gapPx={3}>
                  <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
                    {`Logical cores: ${server.cpuCores ?? 'Not reported'}`}
                  </Text>
                  <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
                    {`Load average: ${server.loadAverageLabel}`}
                  </Text>
                </Stack>
              }
            />
            <ServerFactRow
              label="Operating system"
              icon={<UiIcon name="monitor" size={13} />}
              value={server.osLabel}
            />
            <ServerFactRow
              label="Memory"
              icon={<UiIcon name="memory-stick" size={13} />}
              value={formatBytes(server.memoryInstalledBytes ?? server.memoryTotalBytes)}
            />
            <ServerFactRow
              label="Reporting scope"
              icon={<UiIcon name="layers" size={13} />}
              value={`${scopeLabel} telemetry`}
            />
            {typeof server.batteryLevel === 'number' && (
              <ServerFactRow
                label="Battery"
                icon={<UiIcon name="battery" size={13} />}
                value={
                  <Row align="center" gapPx={7}>
                    <BatteryLevelIcon
                      level={server.batteryLevel}
                      charging={server.batteryCharging}
                      size={14}
                    />
                    <Text size={12.5} style={{ typography: { tabularNums: true } }}>
                      {`${Math.round(server.batteryLevel)}%${server.batteryCharging ? ' · Charging' : ''}`}
                    </Text>
                  </Row>
                }
              />
            )}
          </Stack>
        </ServerGlassPanel>

        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Row
            align="center"
            justify="between"
            style={{ layout: { width: pct(100), margin: insets(0, 0, 14, 0) } }}
          >
            <Row align="center" gapPx={9}>
              <UiIcon name="hard-drive" size={17} />
              <Heading level={3} size={15} weight={600}>
                Storage
              </Heading>
            </Row>
            <Pressable
              onActivate={() => onSelectTab('storage')}
              style={{
                layout: { padding: insets(4, 6) },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11.5} tone="muted" weight={500}>
                View Disks
              </Text>
            </Pressable>
          </Row>

          <Text
            size={32}
            weight={500}
            style={{
              typography: {
                size: 32,
                weight: 500,
                letterSpacing: -0.03,
                lineHeight: 1.15,
                tabularNums: true,
              },
            }}
          >
            {disks.totalBytes > 0 ? formatBytes(disks.totalBytes) : '—'}
          </Text>
          <Text size={12} tone="muted" style={{ layout: { margin: insets(4, 0, 0, 0) } }}>
            {disks.volumeCount > 0
              ? `${disks.volumeCount} ${disks.volumeCount === 1 ? 'storage volume' : 'storage volumes'}`
              : 'Disk information is not available yet'}
          </Text>

          {disks.usageRatio !== null && (
            <Box
              ariaLabel={`${usagePct}% used`}
              style={{
                layout: {
                  width: pct(100),
                  height: px(7),
                  margin: insets(18, 0, 14, 0),
                  overflow: 'hidden',
                },
                material: new SolidMaterial(colorToken('soft')),
                corners: corners(999, 'round'),
              }}
            >
              <Box
                style={{
                  layout: { width: pct(usagePct), height: pct(100) },
                  material: new SolidMaterial(colorToken('textPrimary')),
                  corners: corners(999, 'round'),
                }}
              />
            </Box>
          )}

          <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
            <ServerFactRow label="Used" value={formatBytes(disks.usedBytes)} />
            <ServerFactRow label="Available" value={formatBytes(disks.availableBytes)} />
            {server.nvr?.hasNvr &&
              server.nvr.usedBytes !== null &&
              server.nvr.usedBytes !== undefined && (
                <ServerFactRow
                  label="Haus Files"
                  value={
                    <Pressable
                      onActivate={() => onSelectTab('nvr')}
                      style={{
                        material: new SolidMaterial(transparentColor),
                        border: { width: 0, style: 'none', color: transparentColor },
                      }}
                    >
                      <Text size={12.5} weight={500} style={{ typography: { tabularNums: true } }}>
                        {formatBytes(server.nvr.usedBytes)}
                      </Text>
                    </Pressable>
                  }
                />
              )}
          </Stack>
        </ServerGlassPanel>
      </Grid>

      {serviceGroups.length > 0 && (
        <ServerGlassPanel padding={insets(24)} radius={24}>
          <Row
            align="center"
            justify="between"
            style={{ layout: { width: pct(100), margin: insets(0, 0, 8, 0) } }}
          >
            <Row align="center" gapPx={9}>
              <UiIcon name="box" size={17} />
              <Heading level={3} size={15} weight={600}>
                Service Activity
              </Heading>
            </Row>
            <Pressable
              onActivate={() => onSelectTab('services')}
              style={{
                layout: { padding: insets(4, 6) },
                material: new SolidMaterial(transparentColor),
                border: { width: 0, style: 'none', color: transparentColor },
              }}
            >
              <Text size={11.5} tone="muted" weight={500}>
                View services
              </Text>
            </Pressable>
          </Row>

          <Stack gapPx={0} style={{ layout: { width: pct(100) } }}>
            {serviceGroups.map((group, idx) => (
              <Box key={group.id} style={{ layout: { width: pct(100) } }}>
                {idx > 0 && (
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
                  gapPx={14}
                  style={{ layout: { width: pct(100), minHeight: px(64), padding: insets(10, 0) } }}
                >
                  <Row
                    align="center"
                    gapPx={13}
                    style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                  >
                    <Box
                      style={{
                        layout: {
                          width: px(34),
                          height: px(34),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        },
                        material: new SolidMaterial(colorToken('soft')),
                        corners: corners(10),
                      }}
                    >
                      <UiIcon name={group.icon} size={17} />
                    </Box>
                    <Stack gapPx={2} style={{ layout: { minWidth: px(0) } }}>
                      <Text size={13.5} weight={500}>
                        {group.name}
                      </Text>
                      <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
                        {`${group.active} running · ${group.total} total`}
                      </Text>
                    </Stack>
                  </Row>
                  <ServerServiceUsage
                    cpuPercent={group.cpuPercent}
                    memoryBytes={group.memoryBytes}
                    totalMemoryBytes={server.memoryTotalBytes}
                    inactive={group.active === 0}
                  />
                </Row>
              </Box>
            ))}
          </Stack>
        </ServerGlassPanel>
      )}
    </Stack>
  );
}
