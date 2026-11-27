/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import {
  resolveServerConnectionState,
  type ServerDetailTabId,
  type ServerIdentityPatch,
  type ServerResourceSample,
  type ServerRoomOption,
  type ServerServiceRow,
  type ServerSummaryRecord,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba, transparentColor } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Pressable, Row, Stack, Text } from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { UiIcon } from '../icon.js';
import { resolveServerKindLabel } from './server-card.js';
import { ServerDisksTab } from './server-disks-tab.js';
import { ServerDistroIcon } from './server-icons.js';
import { ServerNvrTab } from './server-nvr-tab.js';
import { ServerOverviewTab } from './server-overview-tab.js';
import { ServerServicesTab } from './server-services-tab.js';
import { ServerSettingsTab } from './server-settings-tab.js';
import { ServerGlassPanel } from './server-surfaces.js';

export function ServerDetailView({
  server,
  history = [],
  rooms = [],
  activeTab,
  canManage,
  contextualNavigation = false,
  busy,
  error,
  logsSlot,
  terminalSlot,
  backupsSlot,
  onSelectTab,
  onBack,
  onToggleEnabled,
  onRemoveServer,
  onSaveIdentity,
  onSaveStorageLimit,
  onInspectService,
}: {
  readonly server: ServerSummaryRecord;
  readonly history?: readonly ServerResourceSample[];
  readonly rooms?: readonly ServerRoomOption[];
  readonly activeTab: ServerDetailTabId;
  readonly canManage: boolean;
  readonly contextualNavigation?: boolean;
  readonly busy?: boolean;
  readonly error?: string;
  readonly logsSlot?: ReactNode;
  readonly terminalSlot?: ReactNode;
  readonly backupsSlot?: ReactNode;
  readonly onSelectTab: (tab: ServerDetailTabId) => void;
  readonly onBack: () => void;
  readonly onToggleEnabled?: () => void;
  readonly onRemoveServer?: () => void | Promise<void>;
  readonly onSaveIdentity?: (patch: ServerIdentityPatch) => void | Promise<void>;
  readonly onSaveStorageLimit?: (limitBytes: number | null) => Promise<void>;
  readonly onInspectService?: (service: ServerServiceRow, mode: 'logs' | 'terminal') => void;
}) {
  const state = resolveServerConnectionState(server);
  const isHubServer = server.kind === 'hub' || server.kind === 'nvr' || Boolean(server.managedId);
  const tabs: readonly { readonly id: ServerDetailTabId; readonly label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'storage', label: 'Disks' },
    { id: 'services', label: 'Services' },
    { id: 'terminal', label: 'Terminal' },
    ...(isHubServer ? ([{ id: 'logs', label: 'Logs' }] as const) : []),
    ...(server.nvr?.hasNvr ? ([{ id: 'nvr', label: 'NVR' }] as const) : []),
    ...(canManage ? ([{ id: 'settings', label: 'Settings' }] as const) : []),
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

  const lastSeenText = server.lastSeen ? new Date(server.lastSeen).toLocaleString() : undefined;
  const footerText = server.sampledAt
    ? `${state === 'online' ? 'Updated' : 'Last sampled'} ${new Date(server.sampledAt).toLocaleTimeString()}${state === 'online' ? ' · refreshes every second' : ''}`
    : server.kind === 'ssh'
      ? 'Resource reporting is not configured'
      : 'Waiting for resource information';

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
                {canManage && onToggleEnabled && server.kind !== 'ssh' && !server.local && (
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
                <ServerDistroIcon server={server} size={28} />
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
                    : `This server is offline.${lastSeenText ? ` Last seen ${lastSeenText}.` : ''} Its saved configuration stays available.`)}
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
            <ServerDisksTab
              disks={server.disks}
              reportingScope={server.reportingScope}
              lastKnown={state !== 'online'}
            />
          )}

          {activeTab === 'services' && (
            <ServerServicesTab
              server={server}
              canManage={canManage}
              onInspectService={onInspectService}
            />
          )}

          {activeTab === 'nvr' && server.nvr && (
            <ServerNvrTab
              server={server}
              canManage={canManage}
              busy={busy}
              backupsSlot={backupsSlot}
              onSaveStorageLimit={onSaveStorageLimit}
            />
          )}

          {activeTab === 'settings' && canManage && (
            <ServerSettingsTab
              key={`${server.id}:${server.name}:${server.roomId ?? ''}:${server.icon ?? ''}`}
              server={server}
              rooms={rooms}
              busy={busy}
              onSaveIdentity={onSaveIdentity}
              onToggleEnabled={server.local ? undefined : onToggleEnabled}
              onRemoveServer={server.local ? undefined : onRemoveServer}
            />
          )}

          {activeTab === 'logs' && logsSlot}
          {activeTab === 'terminal' && terminalSlot}
        </Box>

        {activeTab !== 'terminal' && activeTab !== 'logs' && (
          <Text size={11} tone="muted">
            {footerText}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
