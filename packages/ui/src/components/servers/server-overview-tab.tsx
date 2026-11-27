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
  resolveServerIcon,
  summarizeServerDisks,
  type ServerDetailTabId,
  type ServerResourceSample,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, Grid, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { BatteryLevelIcon } from '../devices/battery.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';
import { fallbackServiceGroups, ServerSystemGraphicsRow } from './parts/system-graphics-row.js';
import { ServerDistroIcon, ServiceManagerBadgeIcon, toServerIconSource } from './server-icons.js';
import { ServerFactRow, ServerGlassPanel } from './server-surfaces.js';
import { ServerServiceUsage, ServerSparkline } from './server-visuals.js';

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
  const serviceGroups =
    server.serviceGroups && server.serviceGroups.length > 0
      ? server.serviceGroups
      : fallbackServiceGroups(server.services, server.memoryTotalBytes);
  const usagePct = Math.round(Math.max(0, Math.min(1, disks.usageRatio ?? 0)) * 100);
  const scopeLabel =
    server.metricsScopeLabel ??
    (server.reportingScope === 'container' ? 'Container' : 'Host system');
  const osBrandIcon = resolveServerIcon(toServerIconSource(server));
  const filesystem = disks.largestMounted;
  const hausUsage = server.nvr?.usage;

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
      detail: scopeLabel,
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
              value={
                <Row align="center" gapPx={7}>
                  {osBrandIcon !== 'server' && (
                    <ServerDistroIcon server={{ ...server, icon: undefined }} size={15} />
                  )}
                  <Text size={12.5} weight={500}>
                    {server.osLabel}
                  </Text>
                </Row>
              }
            />
            <ServerSystemGraphicsRow graphics={server.graphics} />
            <ServerFactRow
              label="Memory"
              icon={<UiIcon name="memory-stick" size={13} />}
              value={formatBytes(server.memoryInstalledBytes ?? server.memoryTotalBytes)}
            />
            <ServerFactRow
              label="Reporting scope"
              icon={<UiIcon name="layers" size={13} />}
              value={scopeLabel}
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
                      {`${Math.round(server.batteryLevel)}%${
                        server.batteryStatusLabel
                          ? ` · ${server.batteryStatusLabel}`
                          : server.batteryCharging
                            ? ' · Charging'
                            : ''
                      }`}
                    </Text>
                  </Row>
                }
              />
            )}
          </Stack>
          {server.reportingScope === 'container' && (
            <Text size={11} tone="muted" style={{ layout: { margin: insets(10, 0, 0, 0) } }}>
              This service reports container resources. Host information appears when the server
              shares it.
            </Text>
          )}
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
            {disks.separateVolumes
              ? 'Not combined'
              : disks.totalBytes > 0
                ? formatBytes(disks.totalBytes)
                : '—'}
          </Text>
          <Text size={12} tone="muted" style={{ layout: { margin: insets(4, 0, 0, 0) } }}>
            {disks.deviceCount > 0
              ? `${disks.deviceCount} ${disks.deviceCount === 1 ? 'storage device' : 'storage devices'}`
              : disks.reportedItems > 0
                ? `${disks.reportedItems} reported storage ${disks.reportedItems === 1 ? 'item' : 'items'}`
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
            <ServerFactRow
              label={filesystem?.mountpoint ? `Used on ${filesystem.mountpoint}` : 'Used'}
              value={formatBytes(filesystem?.usedBytes ?? disks.usedBytes)}
            />
            <ServerFactRow
              label={filesystem?.mountpoint ? `Available on ${filesystem.mountpoint}` : 'Available'}
              value={formatBytes(filesystem?.availableBytes ?? disks.availableBytes)}
            />
            {server.nvr?.hasNvr &&
              (hausUsage?.logicalBytes != null || server.nvr.usedBytes != null) && (
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
                        {`${hausUsage && !hausUsage.complete ? '≥ ' : ''}${formatBytes(hausUsage?.logicalBytes ?? server.nvr.usedBytes)}`}
                      </Text>
                    </Pressable>
                  }
                />
              )}
          </Stack>

          <Text
            size={11}
            tone="muted"
            style={{ layout: { margin: insets(10, 0, 0, 0) }, typography: { lineHeight: 1.45 } }}
          >
            {filesystem
              ? 'Usage shown for the largest reported mounted filesystem. Capacity excludes duplicate partitions and mounts.'
              : disks.separateVolumes
                ? 'Volumes may share the same backing storage. Open Disks to see each one separately.'
                : 'Partitions and mounted volumes are counted under their storage device.'}
          </Text>
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
                          width: px(36),
                          height: px(36),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        },
                        material: new SolidMaterial(colorToken('soft')),
                        border: { width: 1, color: colorToken('border') },
                        corners: corners(11),
                      }}
                    >
                      <ServiceManagerBadgeIcon kind={group.id} server={server} size={18} />
                    </Box>
                    <Stack gapPx={2} style={{ layout: { minWidth: px(0) } }}>
                      <Row align="center" gapPx={6}>
                        <Text size={13.5} weight={500}>
                          {group.name}
                        </Text>
                        {group.attention > 0 && (
                          <Text size={10.5} tone="critical" weight={600}>
                            {`${group.attention} need attention`}
                          </Text>
                        )}
                      </Row>
                      <Text size={11} tone="muted" style={{ typography: { tabularNums: true } }}>
                        {`${group.active} running · ${group.total} total`}
                      </Text>
                    </Stack>
                  </Row>
                  <ServerServiceUsage
                    cpuPercent={group.cpuPercent}
                    memoryBytes={group.memoryBytes}
                    totalMemoryBytes={server.memoryTotalBytes}
                    cpuIncomplete={group.cpuIncomplete}
                    memoryIncomplete={group.memoryIncomplete}
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
