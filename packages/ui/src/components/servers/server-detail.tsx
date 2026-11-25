/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import {
  formatBytes,
  formatRatio,
  resolveServerConnectionState,
  type ServerDetailTabId,
  type ServerResourceSample,
  type ServerServiceRow,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { resolveServerGlyphName, resolveServerKindLabel } from './server-card.js';
import { ServerDisksTab } from './server-disks-tab.js';
import { ServerOverviewTab } from './server-overview-tab.js';
import { ServerServicesTab } from './server-services-tab.js';
import { ServerFactRow, ServerGlassPanel } from './server-surfaces.js';

export function ServerDetailView({
  server,
  history = [],
  activeTab,
  canManage,
  contextualNavigation = false,
  busy,
  error,
  logsSlot,
  terminalSlot,
  onSelectTab,
  onBack,
  onToggleEnabled,
  onInspectService,
}: {
  readonly server: ServerSummaryRecord;
  readonly history?: readonly ServerResourceSample[];
  readonly activeTab: ServerDetailTabId;
  readonly canManage: boolean;
  readonly contextualNavigation?: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly logsSlot?: ReactNode;
  readonly terminalSlot?: ReactNode;
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
  readonly onBack: () => void;
  readonly onToggleEnabled?: () => void;
  readonly onInspectService?: (service: ServerServiceRow, mode: 'logs' | 'terminal') => void;
}) {
  const state = resolveServerConnectionState(server);
  const tabs: readonly { readonly id: ServerDetailTabId; readonly label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'storage', label: 'Disks' },
    { id: 'services', label: 'Services' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'logs', label: 'Logs' },
    ...(server.nvr?.hasNvr ? ([{ id: 'nvr', label: 'NVR' }] as const) : []),
  ];

  const archSuffix =
    server.architecture && !server.osLabel.includes(server.architecture)
      ? server.architecture
      : undefined;
  const subtitle =
    [server.hostname, server.osLabel, archSuffix].filter(Boolean).join(' · ') ||
    server.url ||
    'Your home, connected';

  const statusText =
    state === 'online'
      ? 'Connected'
      : state === 'paused'
        ? 'Paused'
        : state === 'offline'
          ? 'Offline'
          : 'Not checked';

  const statusDot =
    state === 'online'
      ? colorToken('textPrimary')
      : state === 'offline'
        ? rgba(237, 130, 123, 1)
        : colorToken('textMuted');

  const nvrRatio = formatRatio(server.nvr?.usedBytes, server.nvr?.limitBytes);
  const nvrPct = Math.round(Math.max(0, Math.min(1, nvrRatio ?? 0)) * 100);

  return (
    <Box
      motion={{
        initial: { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        durationMs: 240,
        ease: [0.2, 0.7, 0.2, 1],
      }}
      style={{ layout: { width: pct(100), flexShrink: 0 } }}
    >
      <Stack gapPx={20} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
        {!contextualNavigation && (
          <>
            <Row
              align="center"
              justify="between"
              gapPx={12}
              wrap
              style={{ layout: { width: pct(100) } }}
            >
              <HausButton id="server-detail-back" variant="ghost" size="sm" onPress={onBack}>
                <Row align="center" gapPx={6}>
                  <UiIcon name="arrow-left" size={15} />
                  <Text size={12.5}>All servers</Text>
                </Row>
              </HausButton>

              <Row align="center" gapPx={12}>
                <Row align="center" gapPx={6}>
                  <Box
                    ariaHidden
                    style={{
                      layout: { width: px(6), height: px(6) },
                      material: new SolidMaterial(statusDot),
                      corners: corners(999, 'round'),
                    }}
                  />
                  <Text size={11} tone="muted">
                    {statusText}
                  </Text>
                </Row>
                {canManage && onToggleEnabled && server.kind !== 'ssh' && (
                  <HausButton variant="outline" size="sm" disabled={busy} onPress={onToggleEnabled}>
                    <Row align="center" gapPx={6}>
                      <UiIcon name={server.enabled ? 'pause' : 'play'} size={13} />
                      <Text size={12}>{server.enabled ? 'Pause' : 'Resume'}</Text>
                    </Row>
                  </HausButton>
                )}
              </Row>
            </Row>

            <Row align="center" gapPx={16} style={{ layout: { width: pct(100) } }}>
              <Box
                style={{
                  layout: {
                    width: px(60),
                    height: px(60),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    position: 'relative',
                    overflow: 'hidden',
                  },
                  material: new SolidMaterial(colorToken('soft')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(18),
                }}
              >
                <UiIcon name={resolveServerGlyphName(server)} size={28} />
                <GlassRim preset="medium" radiusPx={17} opacity={0.62} />
              </Box>
              <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={10.5} tone="muted" weight={500}>
                  {resolveServerKindLabel(server.kind)}
                </Text>
                <Heading
                  level={2}
                  size={24}
                  weight={600}
                  style={{ typography: { size: 24, letterSpacing: -0.025, lineHeight: 1.2 } }}
                >
                  {server.name}
                </Heading>
                <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, maxLines: 1 } }}>
                  {subtitle}
                </Text>
              </Stack>
            </Row>
          </>
        )}

        {(error || server.online === false) && (
          <ServerGlassPanel padding={insets(14, 18)} radius={20}>
            <Row align="center" gapPx={12}>
              <UiIcon name="alert-circle" size={18} />
              <Text size={12} tone={error ? 'critical' : 'muted'}>
                {error ||
                  (!server.enabled
                    ? 'This server is paused. Resume it to receive new work and refresh its information.'
                    : 'This server is offline. Its saved configuration stays available.')}
              </Text>
            </Row>
          </ServerGlassPanel>
        )}

        {!contextualNavigation && (
          <Row
            role="tablist"
            ariaLabel="Server details"
            gapPx={4}
            wrap
            style={{
              layout: {
                padding: insets(5),
                alignSelf: 'start',
                position: 'relative',
                overflow: 'hidden',
              },
              material: new SolidMaterial(colorToken('soft')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(20),
            }}
          >
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  id={`server-tab-${tab.id}`}
                  role="tab"
                  ariaSelected={active}
                  onActivate={() => onSelectTab(tab.id)}
                  style={{
                    layout: {
                      display: 'flex',
                      direction: 'row',
                      alignItems: 'center',
                      padding: insets(8, 16),
                      position: 'relative',
                      overflow: 'hidden',
                    },
                    material: new SolidMaterial(active ? colorToken('card') : transparentColor),
                    border: { width: 0, style: 'none', color: transparentColor },
                    shadows: active
                      ? [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: rgba(0, 0, 0, 0.08) }]
                      : undefined,
                    corners: corners(14),
                  }}
                >
                  <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
                    {tab.label}
                  </Text>
                  {active && <GlassRim preset="control" radiusPx={13} opacity={0.68} />}
                </Pressable>
              );
            })}
          </Row>
        )}

        <Box
          key={activeTab}
          motion={{
            initial: { opacity: 0, y: 4 },
            animate: { opacity: 1, y: 0 },
            durationMs: 160,
            ease: 'easeOut',
          }}
          style={{ layout: { width: pct(100), flexShrink: 0 } }}
        >
          {activeTab === 'overview' && (
            <ServerOverviewTab server={server} history={history} onSelectTab={onSelectTab} />
          )}

          {activeTab === 'storage' && (
            <ServerDisksTab disks={server.disks} reportingScope={server.reportingScope} />
          )}

          {activeTab === 'services' && (
            <ServerServicesTab
              server={server}
              canManage={canManage}
              onInspectService={onInspectService}
            />
          )}

          {activeTab === 'nvr' && server.nvr && (
            <ServerGlassPanel padding={insets(24)} radius={24}>
              <Row align="center" gapPx={9} style={{ layout: { margin: insets(0, 0, 14, 0) } }}>
                <UiIcon name="video" size={17} />
                <Heading level={3} size={15} weight={600}>
                  Haus NVR
                </Heading>
              </Row>
              {nvrRatio !== null && (
                <Stack
                  gapPx={8}
                  style={{ layout: { width: pct(100), margin: insets(0, 0, 14, 0) } }}
                >
                  <Row align="center" justify="between">
                    <Text size={11.5} tone="muted">
                      Archive storage
                    </Text>
                    <Text size={12} weight={500} style={{ typography: { tabularNums: true } }}>
                      {`${formatBytes(server.nvr.usedBytes)} of ${formatBytes(server.nvr.limitBytes)} (${nvrPct}%)`}
                    </Text>
                  </Row>
                  <Box
                    style={{
                      layout: { width: pct(100), height: px(7), overflow: 'hidden' },
                      material: new SolidMaterial(colorToken('soft')),
                      corners: corners(999, 'round'),
                    }}
                  >
                    <Box
                      style={{
                        layout: { width: pct(nvrPct), height: pct(100) },
                        material: new SolidMaterial(colorToken('textPrimary')),
                        corners: corners(999, 'round'),
                      }}
                    />
                  </Box>
                </Stack>
              )}
              <Stack gapPx={4} style={{ layout: { width: pct(100) } }}>
                <ServerFactRow
                  label="Recording storage"
                  value={server.nvr.storageAssigned ? 'Assigned' : 'Not assigned'}
                />
                <ServerFactRow
                  label="Video streaming"
                  value={server.nvr.streamingAssigned ? 'Assigned' : 'Not assigned'}
                />
                {server.nvr.activeStreams && (
                  <ServerFactRow label="Active streams" value={server.nvr.activeStreams} />
                )}
                {server.nvr.playbackPrep && (
                  <ServerFactRow label="Playback prep" value={server.nvr.playbackPrep} />
                )}
                {server.nvr.activityAssist && (
                  <ServerFactRow label="Activity assist" value={server.nvr.activityAssist} />
                )}
                {server.nvr.backupCopies !== undefined && (
                  <ServerFactRow label="Recovery copies" value={String(server.nvr.backupCopies)} />
                )}
              </Stack>
            </ServerGlassPanel>
          )}

          {activeTab === 'logs' && logsSlot}
          {activeTab === 'terminal' && terminalSlot}
        </Box>
      </Stack>
    </Box>
  );
}
