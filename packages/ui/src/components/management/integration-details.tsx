/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausButton, HausDialog, Row, Stack, Text } from '../../primitives/index.js';
import { BrandIcon, ManagementGlassCard, type BrandIconKind } from '../brand/index.js';
import { UiIcon } from '../icon.js';
import type { PortableIntegrationEntryItem } from './integrations-view.js';

export function IntegrationDetailsModal({
  domain,
  iconKind = 'integration',
  title,
  runtimeLabel,
  iotClassLabel,
  version,
  deviceNames,
  entries,
  canManage,
  busy,
  error,
  notice,
  onReloadEntry,
  onToggleDisabled,
  onOpenDevice,
  onClose,
}: {
  readonly domain?: string;
  readonly iconKind?: BrandIconKind;
  readonly title: string;
  readonly runtimeLabel: string;
  readonly iotClassLabel?: string;
  readonly version?: string;
  readonly deviceNames: readonly { readonly id: string; readonly name: string }[];
  readonly entries: readonly PortableIntegrationEntryItem[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onReloadEntry: (entryId: string) => void;
  readonly onToggleDisabled: (entryId: string, disabled: boolean) => void;
  readonly onOpenDevice?: (deviceId: string) => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="md"
      title={title}
      subtitle={[runtimeLabel, iotClassLabel, version ? `v${version}` : undefined]
        .filter(Boolean)
        .join(' · ')}
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" style={{ layout: { width: pct(100) } }}>
          <HausButton variant="secondary" disabled={busy} onPress={onClose}>
            Done
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        {domain && (
          <ManagementGlassCard
            radius={18}
            padding={insets(12, 14)}
            style={{ layout: { width: pct(100) } }}
          >
            <Row align="center" gapPx={12}>
              <BrandIcon kind={iconKind} id={domain} size={48} hint={{ name: title }} />
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={14.5} weight={600}>
                  {title}
                </Text>
                <Text size={12} tone="muted">
                  {[runtimeLabel, iotClassLabel, version ? `v${version}` : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Stack>
            </Row>
          </ManagementGlassCard>
        )}
        {notice && (
          <Text size={12} tone="muted">
            {notice}
          </Text>
        )}
        {error && (
          <Text size={12} tone="critical">
            {error}
          </Text>
        )}

        <Stack gapPx={8}>
          <Text size={11} weight={600} tone="muted">
            CONFIGURED INSTANCES
          </Text>
          {entries.map((entry) => (
            <Row
              key={entry.entryId}
              align="center"
              justify="between"
              gapPx={12}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(12, 14) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(160) } }}>
                <Text size={13.5} weight={600}>
                  {entry.title}
                </Text>
                <Text size={11.5} tone="muted">
                  {entry.disabledBy
                    ? 'Disabled'
                    : entry.reason
                      ? `${entry.state} · ${entry.reason}`
                      : entry.state}
                </Text>
              </Stack>
              {canManage && (
                <Row align="center" gapPx={6}>
                  <HausButton
                    variant="outline"
                    size="sm"
                    disabled={busy || Boolean(entry.disabledBy)}
                    onPress={() => onReloadEntry(entry.entryId)}
                  >
                    <UiIcon name="rotate-cw" size={13} />
                    <Text size={12}>Reload</Text>
                  </HausButton>
                  <HausButton
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onPress={() => onToggleDisabled(entry.entryId, !entry.disabledBy)}
                  >
                    <Text size={12}>{entry.disabledBy ? 'Enable' : 'Disable'}</Text>
                  </HausButton>
                </Row>
              )}
            </Row>
          ))}
        </Stack>

        {deviceNames.length > 0 && (
          <Stack gapPx={8}>
            <Text size={11} weight={600} tone="muted">
              {`LINKED DEVICES (${deviceNames.length})`}
            </Text>
            <Row gapPx={8} wrap>
              {deviceNames.slice(0, 12).map((device) => (
                <HausButton
                  key={device.id}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    onClose();
                    onOpenDevice?.(device.id);
                  }}
                >
                  <Text size={12}>{device.name}</Text>
                </HausButton>
              ))}
            </Row>
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
}
