/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IntegrationFilterId } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';

export interface PortableIntegrationCardItem {
  readonly domain: string;
  readonly displayName: string;
  readonly summary: string;
  readonly firstEntryTitle: string;
  readonly secondEntryTitle: string;
  readonly extraEntries: number;
  readonly entityCount: number;
  readonly hasAttention: boolean;
  readonly attentionLabel: string;
  readonly hasUpdate: boolean;
  readonly allDisabled: boolean;
}

export interface PortableIntegrationFilterTab {
  readonly id: IntegrationFilterId;
  readonly label: string;
  readonly count: number;
}

export interface PortableIntegrationEntryItem {
  readonly entryId: string;
  readonly title: string;
  readonly domain: string;
  readonly state: string;
  readonly disabledBy: string | null;
  readonly reason?: string | null;
  readonly canUnload: boolean;
}

export function IntegrationsOverviewView({
  columns = 3,
  query,
  filter,
  filters,
  cards,
  discoveredCount,
  repairCount,
  updateCount,
  loading,
  error,
  notice,
  onQueryChange,
  onFilterChange,
  onRefresh,
  onOpenRepairs,
  onOpenUpdates,
  onSelectDomain,
  onConfigureDiscovered,
  onAddDevice,
}: {
  readonly columns?: number;
  readonly query: string;
  readonly filter: IntegrationFilterId;
  readonly filters: readonly PortableIntegrationFilterTab[];
  readonly cards: readonly PortableIntegrationCardItem[];
  readonly discoveredCount: number;
  readonly repairCount: number;
  readonly updateCount: number;
  readonly loading?: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onQueryChange: (value: string) => void;
  readonly onFilterChange: (id: IntegrationFilterId) => void;
  readonly onRefresh: () => void;
  readonly onOpenRepairs: () => void;
  readonly onOpenUpdates: () => void;
  readonly onSelectDomain: (domain: string) => void;
  readonly onConfigureDiscovered?: () => void;
  readonly onAddDevice?: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
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
            <UiIcon name="cable" size={20} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={15} weight={600}>
              Everything speaks the same language.
            </Text>
            <Text size={12.5} tone="muted">
              Connect, configure and manage your integrations here.
            </Text>
          </Stack>
        </Row>
        <Row align="center" gapPx={8} wrap>
          <HausButton id="integrations-open-repairs" variant="secondary" size="sm" onPress={onOpenRepairs}>
            <UiIcon name="wrench" size={14} />
            <Text size={12.5}>{repairCount > 0 ? `Repairs (${repairCount})` : 'Repairs'}</Text>
          </HausButton>
          <HausButton id="integrations-open-updates" variant="secondary" size="sm" onPress={onOpenUpdates}>
            <UiIcon name="arrow-up-circle" size={14} />
            <Text size={12.5}>{updateCount > 0 ? `Updates (${updateCount})` : 'Updates'}</Text>
          </HausButton>
          {onAddDevice && (
            <HausButton id="integrations-add-device" variant="primary" size="sm" onPress={onAddDevice}>
              <UiIcon name="plus" size={14} color={primaryFg} />
              <Text size={12.5} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
                Add device
              </Text>
            </HausButton>
          )}
        </Row>
      </Row>

      {discoveredCount > 0 && onConfigureDiscovered && (
        <Row
          align="center"
          justify="between"
          gapPx={12}
          style={{
            layout: { width: pct(100), padding: insets(12, 16) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('accent') },
            corners: corners(12),
          }}
        >
          <Text size={12.5}>
            {`${discoveredCount} newly discovered integration${discoveredCount === 1 ? '' : 's'} ready for setup.`}
          </Text>
          <HausButton variant="outline" size="sm" onPress={onConfigureDiscovered}>
            <Text size={12}>View discovered</Text>
          </HausButton>
        </Row>
      )}

      <Row align="center" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { flexGrow: 1, minWidth: px(200), minHeight: px(38), padding: insets(0, 12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <UiIcon name="search" size={16} />
          <TextInput
            id="integrations-search"
            ariaLabel="Search integrations"
            placeholder="Search integrations…"
            value={query}
            onChange={onQueryChange}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
              typography: { size: 13, color: colorToken('textPrimary') },
            }}
          />
        </Row>
        <HausButton variant="outline" size="sm" disabled={loading} onPress={onRefresh}>
          <UiIcon name="refresh-cw" size={14} />
          <Text size={12.5}>Refresh</Text>
        </HausButton>
      </Row>

      <Row gapPx={8} wrap>
        {filters.map((tab) => {
          const active = filter === tab.id;
          return (
            <Pressable
              key={tab.id}
              id={`integrations-filter-${tab.id}`}
              ariaPressed={active}
              onActivate={() => onFilterChange(tab.id)}
              style={{
                layout: {
                  direction: 'row',
                  alignItems: 'center',
                  gap: px(7),
                  padding: insets(6, 12),
                },
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
              <Text size={11} tone="muted">
                {String(tab.count)}
              </Text>
            </Pressable>
          );
        })}
      </Row>

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

      {cards.length === 0 ? (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(36, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="search" size={26} />
          <Heading level={3} size={16} weight={600}>
            No integrations match
          </Heading>
          <Text size={12} tone="muted">
            Try another search query or filter.
          </Text>
        </Stack>
      ) : (
        <DashboardGrid columns={columns}>
          {cards.map((card) => (
            <Pressable
              key={card.domain}
              id={`integration-card-${card.domain}`}
              onActivate={() => onSelectDomain(card.domain)}
              style={{
                layout: {
                  direction: 'column',
                  justifyContent: 'between',
                  gap: px(12),
                  padding: insets(16),
                  width: pct(100),
                  minHeight: px(152),
                },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: {
                  width: 1,
                  color: card.hasAttention ? rgba(251, 191, 36, 0.5) : colorToken('border'),
                },
                corners: corners(16),
                states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
              }}
            >
              <Row align="start" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
                <Row align="center" gapPx={10} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Box
                    style={{
                      layout: { width: px(36), height: px(36), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(10),
                    }}
                  >
                    <UiIcon name="cable" size={18} />
                  </Box>
                  <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                    <Text size={14.5} weight={600}>
                      {card.displayName}
                    </Text>
                    <Text size={11.5} tone="muted">
                      {card.summary}
                    </Text>
                  </Stack>
                </Row>
                {card.hasAttention ? (
                  <Box style={{ layout: { padding: insets(2, 8), flexShrink: 0 }, material: new SolidMaterial(rgba(251, 191, 36, 0.14)), corners: corners(999) }}>
                    <Text size={10.5}>{card.attentionLabel}</Text>
                  </Box>
                ) : card.hasUpdate ? (
                  <Box style={{ layout: { padding: insets(2, 8), flexShrink: 0 }, material: new SolidMaterial(rgba(52, 211, 153, 0.14)), corners: corners(999) }}>
                    <Text size={10.5}>Update</Text>
                  </Box>
                ) : card.allDisabled ? (
                  <Text size={11} tone="muted">Disabled</Text>
                ) : null}
              </Row>

              <Stack gapPx={3}>
                {card.firstEntryTitle && (
                  <Text size={12} tone="muted">
                    {card.firstEntryTitle}
                  </Text>
                )}
                {card.secondEntryTitle && (
                  <Text size={12} tone="muted">
                    {card.secondEntryTitle}
                  </Text>
                )}
                {card.extraEntries > 0 && (
                  <Text size={11} tone="muted">{`+${card.extraEntries} more`}</Text>
                )}
              </Stack>

              <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
                <Text size={11.5} tone="muted">
                  {card.entityCount > 0
                    ? `${card.entityCount} ${card.entityCount === 1 ? 'entity' : 'entities'}`
                    : card.domain}
                </Text>
                <Row align="center" gapPx={4}>
                  <Text size={12} weight={500}>
                    Manage
                  </Text>
                  <UiIcon name="chevron-right" size={14} />
                </Row>
              </Row>
            </Pressable>
          ))}
        </DashboardGrid>
      )}
    </Stack>
  );
}

export function IntegrationDetailsModal({
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
      subtitle={[runtimeLabel, iotClassLabel, version ? `v${version}` : undefined].filter(Boolean).join(' · ')}
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
        {notice && <Text size={12} tone="muted">{notice}</Text>}
        {error && <Text size={12} tone="critical">{error}</Text>}

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
                  {entry.disabledBy ? 'Disabled' : entry.reason ? `${entry.state} · ${entry.reason}` : entry.state}
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
