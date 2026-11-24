/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState, type ReactNode } from 'react';
import {
  formatBytes,
  formatPercent,
  formatRatio,
  formatUptime,
  resolveServerConnectionState,
  summarizeServerDisks,
  type ServerDetailTabId,
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
import { UiIcon } from '../icon.js';

function FactRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Row align="center" justify="between" gapPx={12} style={{ layout: { width: pct(100), padding: insets(8, 0) } }}>
      <Text size={12.5} tone="muted">
        {label}
      </Text>
      <Text size={12.5} weight={500}>
        {value}
      </Text>
    </Row>
  );
}

export function ServerDetailView({
  server,
  activeTab,
  canManage,
  busy,
  error,
  logsSlot,
  terminalSlot,
  onSelectTab,
  onBack,
  onToggleEnabled,
}: {
  readonly server: ServerSummaryRecord;
  readonly activeTab: ServerDetailTabId;
  readonly canManage: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly logsSlot?: ReactNode;
  readonly terminalSlot?: ReactNode;
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
  readonly onBack: () => void;
  readonly onToggleEnabled?: () => void;
}) {
  const [serviceFilter, setServiceFilter] = useState<'all' | 'docker' | 'pm2' | 'systemServices'>('all');
  const state = resolveServerConnectionState(server);
  const disks = summarizeServerDisks(server.disks);
  const memRatio = formatRatio(server.memoryUsedBytes, server.memoryTotalBytes);
  const tabs: readonly { readonly id: ServerDetailTabId; readonly label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'storage', label: 'Disks' },
    { id: 'services', label: 'Services' },
    ...(server.nvr?.hasNvr ? ([{ id: 'nvr', label: 'NVR' }] as const) : []),
    { id: 'logs', label: 'Logs' },
    { id: 'terminal', label: 'Terminal' },
  ];

  const visibleServices = server.services.filter(
    (item) => serviceFilter === 'all' || item.manager === serviceFilter,
  );

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={12} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12}>
          <HausButton id="server-detail-back" variant="ghost" size="sm" onPress={onBack}>
            <UiIcon name="arrow-left" size={16} />
            <Text size={13}>All servers</Text>
          </HausButton>
          <Stack gapPx={2}>
            <Heading level={2} size={20} weight={600}>
              {server.name}
            </Heading>
            <Text size={12} tone="muted">
              {`${server.osLabel} · ${state}`}
            </Text>
          </Stack>
        </Row>
        {canManage && onToggleEnabled && server.kind !== 'ssh' && (
          <HausButton variant="outline" size="sm" disabled={busy} onPress={onToggleEnabled}>
            <UiIcon name={server.enabled ? 'pause' : 'play'} size={14} />
            <Text size={12.5}>{server.enabled ? 'Pause monitoring' : 'Resume monitoring'}</Text>
          </HausButton>
        )}
      </Row>

      <Row gapPx={8} wrap>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              id={`server-tab-${tab.id}`}
              ariaPressed={active}
              onActivate={() => onSelectTab(tab.id)}
              style={{
                layout: { direction: 'row', alignItems: 'center', padding: insets(7, 13) },
                material: new SolidMaterial(
                  active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                corners: corners(999),
              }}
            >
              <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {error && <Text size={12} tone="critical">{error}</Text>}

      {activeTab === 'overview' && (
        <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
          <Row gapPx={12} wrap style={{ layout: { width: pct(100) } }}>
            {[
              { icon: 'cpu' as const, label: 'CPU', value: formatPercent(server.cpuUsage), sub: `${server.cpuCores ?? '—'} cores` },
              {
                icon: 'memory-stick' as const,
                label: 'Memory',
                value: formatPercent(memRatio),
                sub: `${formatBytes(server.memoryUsedBytes)} / ${formatBytes(server.memoryTotalBytes)}`,
              },
              {
                icon: 'hard-drive' as const,
                label: 'Storage',
                value: formatPercent(disks.usageRatio),
                sub: `${formatBytes(disks.usedBytes)} / ${formatBytes(disks.totalBytes)}`,
              },
            ].map((card) => (
              <Stack
                key={card.label}
                gapPx={6}
                style={{
                  layout: { flexGrow: 1, minWidth: px(180), padding: insets(16) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(16),
                }}
              >
                <Row align="center" gapPx={8}>
                  <UiIcon name={card.icon} size={16} />
                  <Text size={12} tone="muted">
                    {card.label}
                  </Text>
                </Row>
                <Text size={22} weight={600}>
                  {card.value}
                </Text>
                <Text size={11.5} tone="muted">
                  {card.sub}
                </Text>
              </Stack>
            ))}
          </Row>

          <Stack
            gapPx={4}
            style={{
              layout: { width: pct(100), padding: insets(16, 18) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(16),
            }}
          >
            <Row align="center" gapPx={8} style={{ layout: { margin: insets(0, 0, 6, 0) } }}>
              <UiIcon name="monitor" size={16} />
              <Heading level={3} size={15} weight={600}>
                System
              </Heading>
            </Row>
            <FactRow label="Processor" value={server.cpuModel} />
            <FactRow label="Operating system" value={server.osLabel} />
            <FactRow label="Load average" value={server.loadAverageLabel} />
            <FactRow label="Uptime" value={formatUptime(server.uptimeSeconds)} />
          </Stack>
        </Stack>
      )}

      {activeTab === 'storage' && (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          {server.disks.length === 0 ? (
            <Text size={12.5} tone="muted">
              Disk information is not available on this server yet.
            </Text>
          ) : (
            server.disks.map((disk) => {
              const ratio = formatRatio(disk.usedBytes, disk.totalBytes);
              return (
                <Stack
                  key={disk.id}
                  gapPx={8}
                  style={{
                    layout: { width: pct(100), padding: insets(14, 16) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(14),
                  }}
                >
                  <Row align="center" justify="between" gapPx={10}>
                    <Row align="center" gapPx={8}>
                      <UiIcon name="hard-drive" size={16} />
                      <Text size={14} weight={600}>
                        {disk.name}
                      </Text>
                    </Row>
                    <Text size={13} weight={600}>
                      {formatBytes(disk.totalBytes)}
                    </Text>
                  </Row>
                  <Text size={11.5} tone="muted">
                    {[disk.filesystem, disk.mountpoint].filter(Boolean).join(' · ') || 'Volume'}
                  </Text>
                  <Box
                    style={{
                      layout: { width: pct(100), height: px(6) },
                      material: new SolidMaterial(colorToken('surface')),
                      corners: corners(3),
                    }}
                  >
                    <Box
                      style={{
                        layout: { width: pct(Math.round((ratio ?? 0) * 100)), height: pct(100) },
                        material: new SolidMaterial(colorToken('accent')),
                        corners: corners(3),
                      }}
                    />
                  </Box>
                  <Text size={11.5} tone="muted">
                    {`${formatBytes(disk.usedBytes)} used · ${formatBytes(disk.availableBytes)} free`}
                  </Text>
                </Stack>
              );
            })
          )}
        </Stack>
      )}

      {activeTab === 'services' && (
        <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
          <Row gapPx={8} wrap>
            {(
              [
                ['all', 'All'],
                ['docker', 'Docker'],
                ['pm2', 'PM2'],
                ['systemServices', 'System'],
              ] as const
            ).map(([id, label]) => {
              const active = serviceFilter === id;
              return (
                <Pressable
                  key={id}
                  ariaPressed={active}
                  onActivate={() => setServiceFilter(id)}
                  style={{
                    layout: { direction: 'row', alignItems: 'center', padding: insets(6, 12) },
                    material: new SolidMaterial(
                      active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                    ),
                    border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                    corners: corners(999),
                  }}
                >
                  <Text size={12} weight={active ? 600 : 500}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          {visibleServices.length === 0 ? (
            <Text size={12.5} tone="muted">
              No services match this filter.
            </Text>
          ) : (
            visibleServices.map((service) => (
              <Row
                key={service.id}
                align="center"
                justify="between"
                gapPx={12}
                style={{
                  layout: { width: pct(100), padding: insets(12, 16) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(14),
                }}
              >
                <Stack gapPx={2}>
                  <Text size={13.5} weight={600}>
                    {service.name}
                  </Text>
                  <Text size={11.5} tone="muted">
                    {`${service.manager} · ${service.status}`}
                  </Text>
                </Stack>
                <Row align="center" gapPx={12}>
                  <Text size={12} tone="muted">
                    {service.cpuPercent !== null ? `${service.cpuPercent.toFixed(1)}% CPU` : '—'}
                  </Text>
                  <Text size={12} tone="muted">
                    {formatBytes(service.memoryBytes)}
                  </Text>
                  <Box
                    style={{
                      layout: { padding: insets(2, 8) },
                      material: new SolidMaterial(
                        service.running ? rgba(52, 211, 153, 0.14) : colorToken('surface'),
                      ),
                      corners: corners(999),
                    }}
                  >
                    <Text size={11}>{service.running ? 'Running' : 'Stopped'}</Text>
                  </Box>
                </Row>
              </Row>
            ))
          )}
        </Stack>
      )}

      {activeTab === 'nvr' && server.nvr && (
        <Stack
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(16, 18) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <Row align="center" gapPx={8} style={{ layout: { margin: insets(0, 0, 6, 0) } }}>
            <UiIcon name="video" size={16} />
            <Heading level={3} size={15} weight={600}>
              Haus NVR
            </Heading>
          </Row>
          <FactRow label="Recording storage" value={server.nvr.storageAssigned ? 'Assigned' : 'Not assigned'} />
          <FactRow label="Video streaming" value={server.nvr.streamingAssigned ? 'Assigned' : 'Not assigned'} />
          {server.nvr.activeStreams && <FactRow label="Active streams" value={server.nvr.activeStreams} />}
          {server.nvr.playbackPrep && <FactRow label="Playback preparation" value={server.nvr.playbackPrep} />}
          {server.nvr.activityAssist && <FactRow label="Activity assist" value={server.nvr.activityAssist} />}
          {server.nvr.backupCopies !== undefined && (
            <FactRow label="Recovery copies" value={String(server.nvr.backupCopies)} />
          )}
        </Stack>
      )}

      {activeTab === 'logs' && logsSlot}
      {activeTab === 'terminal' && terminalSlot}
    </Stack>
  );
}
