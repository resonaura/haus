/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { humanizeIdentifier } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  rgba,
  transparentColor,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausButton,
  Pressable,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../../primitives/index.js';
import { DeviceBrandIcon, ManagementGlassCard, ManagementStatusPill } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';
import type { PortableIntegrationEntryItem } from '../integrations-view.js';

export interface PortableIntegrationDeviceItem {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly manufacturer?: string;
  readonly areaName?: string;
  readonly entityCount?: number;
  readonly primaryEntityId?: string;
}

export interface IntegrationEntryDetailItem extends PortableIntegrationEntryItem {
  readonly supportsOptions?: boolean;
  readonly supportsReconfigure?: boolean;
  readonly needsAttention?: boolean;
  readonly attentionSource?: 'reauth' | 'reconfigure';
  readonly attentionFlowId?: string;
  readonly devices: readonly PortableIntegrationDeviceItem[];
}

const FAILED_STATES = new Set(['setup_error', 'migration_error', 'setup_retry', 'failed_unload']);

/**
 * Electron-matched glass integration entry card with full lifecycle actions
 * (`Options`, `Reauthenticate`, `Reconfigure`, `Reload`, `Enable/Disable`, `Delete`)
 * and collapsible linked device list.
 */
export function IntegrationEntryCardView({
  entry,
  searchQuery,
  canManage,
  busy,
  onOptions,
  onReconfigure,
  onReauth,
  onReload,
  onToggleDisabled,
  onDelete,
  onOpenDevice,
}: {
  readonly entry: IntegrationEntryDetailItem;
  readonly searchQuery: string;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onOptions?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReconfigure?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReauth?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReload: (entryId: string) => void;
  readonly onToggleDisabled: (entryId: string, disabled: boolean) => void;
  readonly onDelete?: (entry: IntegrationEntryDetailItem) => void;
  readonly onOpenDevice?: (deviceId: string) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryFg = dark ? '#101010' : '#ffffff';
  const [expanded, setExpanded] = useState(true);

  const failed = !entry.disabledBy && (FAILED_STATES.has(entry.state) || Boolean(entry.reason));
  const isReauth = entry.attentionSource === 'reauth';
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleDevices = normalizedQuery
    ? entry.devices.filter((dev) =>
        `${dev.name} ${dev.model ?? ''} ${dev.manufacturer ?? ''} ${dev.areaName ?? ''} ${dev.id}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : entry.devices;

  if (
    normalizedQuery &&
    !entry.title.toLowerCase().includes(normalizedQuery) &&
    visibleDevices.length === 0
  ) {
    return null;
  }

  const rowHoverBg = mixColor(transparentColor, colorToken('ink'), dark ? 0.055 : 0.035);
  const statusPill = entry.disabledBy
    ? { label: 'Disabled', tone: 'neutral' as const }
    : failed
      ? { label: humanizeIdentifier(entry.state), tone: 'danger' as const }
      : entry.needsAttention
        ? { label: isReauth ? 'Auth required' : 'Attention', tone: 'warning' as const }
        : { label: 'Connected', tone: 'success' as const };

  return (
    <ManagementGlassCard
      id={`integration-entry-${entry.entryId}`}
      radius={22}
      padding={insets(16, 18)}
      attention={failed || Boolean(entry.needsAttention)}
      style={{ layout: { width: pct(100), gap: px(12) } }}
    >
      <Row align="center" justify="between" gapPx={12} wrap style={{ layout: { width: pct(100) } }}>
        <Pressable
          id={`integration-entry-toggle-${entry.entryId}`}
          ariaExpanded={expanded}
          onActivate={() => setExpanded((prev) => !prev)}
          style={{
            layout: {
              direction: 'row',
              alignItems: 'center',
              gap: px(8),
              flexGrow: 1,
              minWidth: px(180),
            },
          }}
        >
          {entry.devices.length > 0 && (
            <UiIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={15} />
          )}
          <Text size={14.5} weight={600}>
            {entry.title}
          </Text>
          <ManagementStatusPill label={statusPill.label} tone={statusPill.tone} showDot />
          {entry.devices.length > 0 && (
            <ManagementStatusPill
              label={`${entry.devices.length} ${entry.devices.length === 1 ? 'device' : 'devices'}`}
              tone="neutral"
            />
          )}
        </Pressable>

        {canManage && (
          <Row align="center" gapPx={6} wrap style={{ layout: { flexShrink: 0 } }}>
            {isReauth && onReauth && (
              <HausButton
                id={`entry-reauth-${entry.entryId}`}
                variant="primary"
                size="sm"
                disabled={busy}
                onPress={() => onReauth(entry)}
              >
                <UiIcon name="key-round" size={13} color={primaryFg} />
                <Text
                  size={12}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  Reauthenticate
                </Text>
              </HausButton>
            )}
            {entry.supportsOptions !== false && onOptions && !entry.disabledBy && (
              <HausButton
                id={`entry-options-${entry.entryId}`}
                variant="secondary"
                size="sm"
                disabled={busy}
                onPress={() => onOptions(entry)}
              >
                <UiIcon name="sliders-horizontal" size={13} />
                <Text size={12}>Options</Text>
              </HausButton>
            )}
            {onReconfigure && !entry.disabledBy && (
              <HausButton
                id={`entry-reconfigure-${entry.entryId}`}
                variant="outline"
                size="sm"
                disabled={busy}
                onPress={() => onReconfigure(entry)}
              >
                <UiIcon name="settings-2" size={13} />
                <Text size={12}>Reconfigure</Text>
              </HausButton>
            )}
            {!entry.disabledBy && (
              <HausButton
                id={`entry-reload-${entry.entryId}`}
                variant="outline"
                size="sm"
                disabled={busy}
                onPress={() => onReload(entry.entryId)}
              >
                <UiIcon name="rotate-cw" size={13} />
                <Text size={12}>Reload</Text>
              </HausButton>
            )}
            <HausButton
              id={`entry-toggle-disable-${entry.entryId}`}
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={() => onToggleDisabled(entry.entryId, !entry.disabledBy)}
            >
              <UiIcon name="power" size={13} />
              <Text size={12}>{entry.disabledBy ? 'Enable' : 'Disable'}</Text>
            </HausButton>
            {onDelete && (
              <HausButton
                id={`entry-delete-${entry.entryId}`}
                variant="ghost"
                size="sm"
                disabled={busy}
                onPress={() => onDelete(entry)}
              >
                <UiIcon name="trash-2" size={13} color={dark ? '#f87171' : '#dc2626'} />
                <Text
                  size={12}
                  style={{
                    typography: {
                      size: 12,
                      color: dark ? rgba(252, 165, 165, 1) : rgba(185, 28, 28, 1),
                    },
                  }}
                >
                  Delete
                </Text>
              </HausButton>
            )}
          </Row>
        )}
      </Row>

      {failed && (
        <Row
          align="center"
          gapPx={10}
          style={{
            layout: { width: pct(100), padding: insets(10, 12) },
            material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
            border: { width: 1, color: rgba(239, 68, 68, 0.34) },
            corners: corners(14),
          }}
        >
          <UiIcon name="alert-circle" size={16} color={dark ? '#fca5a5' : '#b91c1c'} />
          <Text
            size={12.5}
            style={{
              layout: { flexGrow: 1, minWidth: px(0) },
              typography: {
                size: 12.5,
                color: dark ? rgba(254, 202, 202, 1) : rgba(153, 27, 27, 1),
                lineHeight: 1.4,
              },
            }}
          >
            {entry.reason || `Entry state: ${humanizeIdentifier(entry.state)}.`}
          </Text>
        </Row>
      )}

      {expanded && visibleDevices.length > 0 && (
        <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
          {visibleDevices.map((device) => {
            const metaText = [
              device.manufacturer && device.model
                ? `${device.manufacturer} · ${device.model}`
                : device.model || device.manufacturer,
              device.areaName,
              device.entityCount !== undefined
                ? `${device.entityCount} ${device.entityCount === 1 ? 'entity' : 'entities'}`
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Pressable
                key={device.id}
                id={`entry-device-${device.id}`}
                onActivate={() => onOpenDevice?.(device.id)}
                style={{
                  layout: {
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'between',
                    gap: px(10),
                    width: pct(100),
                    padding: insets(9, 12),
                  },
                  material: new SolidMaterial(colorToken('surface')),
                  border: { width: 1, color: colorToken('borderSubtle') },
                  corners: corners(14),
                  states: { hover: { material: new SolidMaterial(rowHoverBg) } },
                }}
              >
                <Row align="center" gapPx={10} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Box
                    style={{
                      layout: {
                        width: px(30),
                        height: px(30),
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      },
                      material: new SolidMaterial(colorToken('card')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(9),
                    }}
                  >
                    <DeviceBrandIcon
                      device={{
                        name: device.name,
                        primaryEntityId: device.primaryEntityId,
                        manufacturer: device.manufacturer,
                        model: device.model,
                      }}
                      fallbackIconName="cpu"
                      size={16}
                    />
                  </Box>
                  <Stack gapPx={1} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                    <Text
                      size={13}
                      weight={600}
                      style={{ typography: { size: 13, weight: 600, maxLines: 1, truncate: true } }}
                    >
                      {device.name}
                    </Text>
                    {metaText && (
                      <Text
                        size={11.5}
                        tone="muted"
                        style={{ typography: { size: 11.5, maxLines: 1, truncate: true } }}
                      >
                        {metaText}
                      </Text>
                    )}
                  </Stack>
                </Row>
                {onOpenDevice && <UiIcon name="chevron-right" size={14} />}
              </Pressable>
            );
          })}
        </Stack>
      )}
    </ManagementGlassCard>
  );
}
