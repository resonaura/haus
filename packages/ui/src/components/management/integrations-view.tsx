/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  IntegrationFilterId,
  RepairIssueRecord,
  UnifiedUpdateRecord,
  UnifiedUpdatesSummary,
} from '@haus/core/transport';
import { colorToken, insets, pct, px } from '../../ir/geometry.js';
import { HausButton, Pressable, Row, Stack, Text, useHausUi } from '../../primitives/index.js';
import {
  BrandIcon,
  ManagementEmptyCard,
  ManagementFilterBar,
  ManagementGlassCard,
  ManagementHeroBanner,
  ManagementSearchBar,
  ManagementStatusPill,
  type BrandIconKind,
} from '../brand/index.js';
import {
  DiscoveredIntegrationsPanel,
  type PortableDiscoveredFlow,
} from '../connections/discovered-panel.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import { SystemSummaryCardsView } from './integrations/system-summary.js';

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
  readonly iconKind?: BrandIconKind;
  readonly iconName?: string;
  readonly iconCategory?: string;
  readonly updateItem?: UnifiedUpdateRecord;
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

/**
 * Shared Electron & GPUIX Integrations overview featuring `<ManagementHeroBanner />`,
 * `<SystemSummaryCardsView />` (Repairs & Updates), inline `<DiscoveredIntegrationsPanel />`,
 * and refined monochrome glass cards (`<GlassRim />`) with `<BrandIcon />`.
 */
export function IntegrationsOverviewView({
  columns = 3,
  query,
  filter,
  filters,
  cards,
  discoveredItems = [],
  discoveredCount,
  issues = [],
  updates = null,
  repairCount,
  updateCount,
  canManage = true,
  loading,
  busy = false,
  installingUpdateId,
  error,
  notice,
  formatDomain,
  onQueryChange,
  onFilterChange,
  onRefresh,
  onOpenRepairs,
  onFixRepair,
  onOpenUpdates,
  onInstallUpdate,
  onOpenHacs,
  onImportHa,
  onSelectDomain,
  onConfigureDiscoveredItem,
  onIgnoreDiscoveredItem,
  onConfigureDiscovered,
  onAddDevice,
}: {
  readonly columns?: number;
  readonly query: string;
  readonly filter: IntegrationFilterId;
  readonly filters: readonly PortableIntegrationFilterTab[];
  readonly cards: readonly PortableIntegrationCardItem[];
  readonly discoveredItems?: readonly PortableDiscoveredFlow[];
  readonly discoveredCount: number;
  readonly issues?: readonly RepairIssueRecord[];
  readonly updates?: UnifiedUpdatesSummary | null;
  readonly repairCount: number;
  readonly updateCount: number;
  readonly canManage?: boolean;
  readonly loading?: boolean;
  readonly busy?: boolean;
  readonly installingUpdateId?: string | null;
  readonly error?: string;
  readonly notice?: string;
  readonly formatDomain?: (domain: string) => string;
  readonly onQueryChange: (value: string) => void;
  readonly onFilterChange: (id: IntegrationFilterId) => void;
  readonly onRefresh: () => void;
  readonly onOpenRepairs: () => void;
  readonly onFixRepair?: (issue: RepairIssueRecord) => void;
  readonly onOpenUpdates: () => void;
  readonly onInstallUpdate?: (item: UnifiedUpdateRecord) => void;
  readonly onOpenHacs?: () => void;
  readonly onImportHa?: () => void;
  readonly onSelectDomain: (domain: string) => void;
  readonly onConfigureDiscoveredItem?: (item: PortableDiscoveredFlow) => void;
  readonly onIgnoreDiscoveredItem?: (item: PortableDiscoveredFlow) => void;
  readonly onConfigureDiscovered?: () => void;
  readonly onAddDevice?: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const showDiscoveredSection =
    (filter === 'all' || filter === 'discovered') &&
    (discoveredItems.length > 0 || filter === 'discovered');
  const showLegacyDiscoveredBanner =
    discoveredItems.length === 0 && discoveredCount > 0 && Boolean(onConfigureDiscovered);

  const gridColumns = Math.max(1, Math.min(columns, 3));

  return (
    <Stack gapPx={18} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <ManagementHeroBanner
        icon="cable"
        title="Everything speaks the same language."
        subtitle="Connect, configure and manage your integrations here."
        actions={
          <>
            {onAddDevice && (
              <HausButton
                id="integrations-add-device"
                variant="primary"
                size="sm"
                onPress={onAddDevice}
              >
                <UiIcon name="plus" size={14} color={primaryFg} />
                <Text
                  size={12.5}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  Add integration
                </Text>
              </HausButton>
            )}
            <HausButton
              id="integrations-open-updates"
              variant="secondary"
              size="sm"
              onPress={onOpenUpdates}
            >
              <UiIcon name="arrow-up-circle" size={14} />
              <Text size={12.5}>{updateCount > 0 ? `Updates (${updateCount})` : 'Updates'}</Text>
            </HausButton>
            <HausButton
              id="integrations-open-repairs"
              variant="secondary"
              size="sm"
              onPress={onOpenRepairs}
            >
              <UiIcon name="wrench" size={14} />
              <Text size={12.5}>{repairCount > 0 ? `Repairs (${repairCount})` : 'Repairs'}</Text>
            </HausButton>
            {onOpenHacs && (
              <HausButton
                id="integrations-open-hacs"
                variant="secondary"
                size="sm"
                onPress={onOpenHacs}
              >
                <UiIcon name="sparkles" size={14} />
                <Text size={12.5}>Community · HACS</Text>
              </HausButton>
            )}
            {onImportHa && (
              <HausButton
                id="integrations-import-ha"
                variant="secondary"
                size="sm"
                onPress={onImportHa}
              >
                <UiIcon name="file-up" size={14} />
                <Text size={12.5}>Import HA data</Text>
              </HausButton>
            )}
          </>
        }
      />

      <SystemSummaryCardsView
        issues={issues}
        updates={updates}
        formatDomain={formatDomain}
        onOpenRepairs={onOpenRepairs}
        onFixRepair={onFixRepair}
        onOpenUpdates={onOpenUpdates}
      />

      <ManagementSearchBar
        id="integrations-search"
        ariaLabel="Search integrations"
        placeholder="Search integrations…"
        value={query}
        onChange={onQueryChange}
        trailing={
          <HausButton variant="outline" size="sm" disabled={loading} onPress={onRefresh}>
            <UiIcon name="refresh-cw" size={14} />
            <Text size={12.5}>Refresh</Text>
          </HausButton>
        }
      />

      <ManagementFilterBar
        idPrefix="integrations-filter"
        tabs={filters}
        activeId={filter}
        onChange={onFilterChange}
      />

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

      {showDiscoveredSection && (
        <DiscoveredIntegrationsPanel
          items={discoveredItems}
          columns={gridColumns}
          busy={busy}
          emptyWhenShown={filter === 'discovered'}
          onConfigure={(item) =>
            onConfigureDiscoveredItem ? onConfigureDiscoveredItem(item) : onConfigureDiscovered?.()
          }
          onIgnore={onIgnoreDiscoveredItem}
        />
      )}

      {showLegacyDiscoveredBanner && (
        <ManagementGlassCard
          radius={20}
          padding={insets(14, 18)}
          style={{ layout: { width: pct(100) } }}
        >
          <Row
            align="center"
            justify="between"
            gapPx={12}
            wrap
            style={{ layout: { width: pct(100) } }}
          >
            <Row align="center" gapPx={10}>
              <UiIcon name="radar" size={16} />
              <Text size={13} weight={500}>
                {`${discoveredCount} newly discovered ${discoveredCount === 1 ? 'device' : 'devices'} ready for setup.`}
              </Text>
            </Row>
            <HausButton variant="primary" size="sm" onPress={onConfigureDiscovered}>
              <Text
                size={12}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                View discovered
              </Text>
            </HausButton>
          </Row>
        </ManagementGlassCard>
      )}

      {filter !== 'discovered' &&
        (cards.length === 0 ? (
          <ManagementEmptyCard
            icon={query.trim() ? 'search' : 'cable'}
            title={query.trim() ? 'No integrations match' : 'No integrations configured'}
            subtitle={
              query.trim()
                ? 'Try another search query or filter.'
                : 'Add your first integration or configure a discovered device above.'
            }
            action={
              onAddDevice && !query.trim() ? (
                <HausButton variant="primary" size="sm" onPress={onAddDevice}>
                  <UiIcon name="plus" size={14} color={primaryFg} />
                  <Text
                    size={12.5}
                    style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                  >
                    Add integration
                  </Text>
                </HausButton>
              ) : undefined
            }
          />
        ) : (
          <DashboardGrid columns={gridColumns}>
            {cards.map((card) => {
              const updatingThis = Boolean(
                card.updateItem && installingUpdateId === card.updateItem.id,
              );
              return (
                <ManagementGlassCard
                  key={card.domain}
                  id={`integration-card-${card.domain}`}
                  radius={22}
                  padding={insets(18)}
                  interactive
                  attention={card.hasAttention}
                  style={{
                    layout: {
                      width: pct(100),
                      minHeight: px(164),
                      justifyContent: 'between',
                      gap: px(14),
                    },
                  }}
                >
                  <Pressable
                    id={`integration-open-${card.domain}`}
                    ariaLabel={`Open ${card.displayName}`}
                    onActivate={() => onSelectDomain(card.domain)}
                    style={{
                      layout: {
                        display: 'flex',
                        direction: 'column',
                        gap: px(12),
                        width: pct(100),
                      },
                    }}
                  >
                    <Row
                      align="start"
                      justify="between"
                      gapPx={10}
                      style={{ layout: { width: pct(100) } }}
                    >
                      <Row
                        align="center"
                        gapPx={12}
                        style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                      >
                        <BrandIcon
                          kind={card.iconKind ?? 'integration'}
                          id={card.domain}
                          size={46}
                          hint={{
                            name: card.iconName ?? card.displayName,
                            ...(card.iconCategory ? { category: card.iconCategory } : {}),
                          }}
                        />
                        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                          <Text
                            size={14.5}
                            weight={600}
                            style={{
                              typography: { size: 14.5, weight: 600, maxLines: 1, truncate: true },
                            }}
                          >
                            {card.displayName}
                          </Text>
                          <Text
                            size={12}
                            tone="muted"
                            style={{ typography: { size: 12, maxLines: 1, truncate: true } }}
                          >
                            {card.summary}
                          </Text>
                        </Stack>
                      </Row>
                      {card.hasAttention ? (
                        <ManagementStatusPill label={card.attentionLabel} tone="warning" />
                      ) : card.hasUpdate ? (
                        <ManagementStatusPill label="Update" tone="accent" />
                      ) : card.allDisabled ? (
                        <ManagementStatusPill label="Disabled" tone="neutral" />
                      ) : null}
                    </Row>

                    <Stack gapPx={3} style={{ layout: { width: pct(100) } }}>
                      {card.firstEntryTitle && (
                        <Text
                          size={12.5}
                          tone="muted"
                          style={{ typography: { size: 12.5, maxLines: 1, truncate: true } }}
                        >
                          {card.firstEntryTitle}
                        </Text>
                      )}
                      {card.secondEntryTitle && (
                        <Text
                          size={12}
                          tone="muted"
                          style={{ typography: { size: 12, maxLines: 1, truncate: true } }}
                        >
                          {card.secondEntryTitle}
                        </Text>
                      )}
                      {card.extraEntries > 0 && (
                        <Text size={11} tone="muted">{`+${card.extraEntries} more`}</Text>
                      )}
                    </Stack>
                  </Pressable>

                  <Row
                    align="center"
                    justify="between"
                    gapPx={8}
                    style={{ layout: { width: pct(100) } }}
                  >
                    <Text size={11.5} tone="muted">
                      {card.entityCount > 0
                        ? `${card.entityCount} ${card.entityCount === 1 ? 'entity' : 'entities'}`
                        : card.domain}
                    </Text>
                    <Row align="center" gapPx={8}>
                      {card.updateItem && canManage && onInstallUpdate && (
                        <HausButton
                          id={`integration-update-${card.domain}`}
                          variant="primary"
                          size="sm"
                          disabled={
                            Boolean(installingUpdateId) ||
                            card.updateItem.compatibility === 'incompatible'
                          }
                          onPress={() => onInstallUpdate(card.updateItem!)}
                        >
                          <UiIcon name="arrow-up-circle" size={13} color={primaryFg} />
                          <Text
                            size={11.5}
                            style={{
                              typography: {
                                size: 11.5,
                                weight: 600,
                                color: colorToken('accentForeground'),
                              },
                            }}
                          >
                            {updatingThis ? 'Updating…' : 'Update'}
                          </Text>
                        </HausButton>
                      )}
                      <HausButton
                        id={`integration-manage-${card.domain}`}
                        variant="secondary"
                        size="sm"
                        onPress={() => onSelectDomain(card.domain)}
                      >
                        <Text size={12}>Manage</Text>
                        <UiIcon name="chevron-right" size={14} />
                      </HausButton>
                    </Row>
                  </Row>
                </ManagementGlassCard>
              );
            })}
          </DashboardGrid>
        ))}
    </Stack>
  );
}
