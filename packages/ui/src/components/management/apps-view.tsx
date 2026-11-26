/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { ReactNode } from 'react';
import type { AppsFilterId, AppsTabId } from '@haus/core/transport';
import { colorToken, corners, insets, pct, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausButton, Pressable, Row, Stack, Text, useHausUi } from '../../primitives/index.js';
import {
  ManagementEmptyCard,
  ManagementFilterBar,
  ManagementHeroBanner,
  ManagementSearchBar,
  type ManagementFilterTabItem,
} from '../brand/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import {
  CatalogAppGlassCard,
  InstalledAppGlassCard,
  type PortableCatalogAppItem,
  type PortableInstalledAppItem,
} from './apps/cards.js';

export type { PortableCatalogAppItem, PortableInstalledAppItem };

export interface PortableAppFilterTab {
  readonly id: AppsFilterId;
  readonly label: string;
  readonly count: number;
}

/**
 * Shared Electron & GPUIX Apps / Add-ons workspace with refined monochrome glass
 * cards (`<GlassRim />`), `<BrandIcon />`, and full Installed + Catalog/Store views.
 */
export function AppsWorkspaceView({
  columns = 3,
  tab,
  query,
  filter,
  filters,
  installedApps,
  totalInstalledCount,
  catalogApps,
  catalogTabLabel = 'Catalog',
  installedHeroTitle = 'The services behind your home.',
  catalogHeroTitle = 'More possibilities for your home.',
  heroSubtitle = 'Install, configure and maintain local home services.',
  catalogFilters,
  catalogFilter,
  onCatalogFilterChange,
  extraHeroActions,
  loading,
  busyAppId,
  error,
  notice,
  canManage,
  onTabChange,
  onQueryChange,
  onFilterChange,
  onRefresh,
  onOpenRepositories,
  onManageApp,
  onQuickToggleApp,
  onInstallCatalogApp,
}: {
  readonly columns?: number;
  readonly tab: AppsTabId;
  readonly query: string;
  readonly filter: AppsFilterId;
  readonly filters: readonly PortableAppFilterTab[];
  readonly installedApps: readonly PortableInstalledAppItem[];
  readonly totalInstalledCount: number;
  readonly catalogApps: readonly PortableCatalogAppItem[];
  readonly catalogTabLabel?: string;
  readonly installedHeroTitle?: string;
  readonly catalogHeroTitle?: string;
  readonly heroSubtitle?: string;
  readonly catalogFilters?: readonly ManagementFilterTabItem[];
  readonly catalogFilter?: string;
  readonly onCatalogFilterChange?: (id: string) => void;
  readonly extraHeroActions?: ReactNode;
  readonly loading?: boolean;
  readonly busyAppId?: string | null;
  readonly error?: string;
  readonly notice?: string;
  readonly canManage: boolean;
  readonly onTabChange: (tab: AppsTabId) => void;
  readonly onQueryChange: (value: string) => void;
  readonly onFilterChange: (filter: AppsFilterId) => void;
  readonly onRefresh: () => void;
  readonly onOpenRepositories?: () => void;
  readonly onManageApp: (app: PortableInstalledAppItem) => void;
  readonly onQuickToggleApp?: (app: PortableInstalledAppItem, action: 'start' | 'stop') => void;
  readonly onInstallCatalogApp: (app: PortableCatalogAppItem) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const activeTabBg = dark ? rgba(255, 255, 255, 0.14) : rgba(16, 16, 20, 0.09);
  const activeTabBorder = dark ? rgba(255, 255, 255, 0.24) : rgba(16, 16, 20, 0.18);
  const gridColumns = Math.max(1, Math.min(columns, 3));

  return (
    <Stack gapPx={18} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <ManagementHeroBanner
        icon="box"
        title={tab === 'catalog' ? catalogHeroTitle : installedHeroTitle}
        subtitle={heroSubtitle}
        actions={
          <>
            <Row
              align="center"
              gapPx={4}
              style={{
                layout: { padding: insets(3) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999),
              }}
            >
              <Pressable
                id="apps-tab-installed"
                ariaPressed={tab === 'installed'}
                onActivate={() => onTabChange('installed')}
                style={{
                  layout: { direction: 'row', alignItems: 'center', padding: insets(6, 13) },
                  material: new SolidMaterial(tab === 'installed' ? activeTabBg : rgba(0, 0, 0, 0)),
                  border: {
                    width: 1,
                    color: tab === 'installed' ? activeTabBorder : rgba(0, 0, 0, 0),
                  },
                  corners: corners(999),
                  transitionMs: 160,
                }}
              >
                <Text
                  size={12}
                  weight={tab === 'installed' ? 600 : 500}
                  tone={tab === 'installed' ? 'primary' : 'muted'}
                >
                  {`Installed (${totalInstalledCount})`}
                </Text>
              </Pressable>
              <Pressable
                id="apps-tab-catalog"
                ariaPressed={tab === 'catalog'}
                onActivate={() => onTabChange('catalog')}
                style={{
                  layout: { direction: 'row', alignItems: 'center', padding: insets(6, 13) },
                  material: new SolidMaterial(tab === 'catalog' ? activeTabBg : rgba(0, 0, 0, 0)),
                  border: {
                    width: 1,
                    color: tab === 'catalog' ? activeTabBorder : rgba(0, 0, 0, 0),
                  },
                  corners: corners(999),
                  transitionMs: 160,
                }}
              >
                <Text
                  size={12}
                  weight={tab === 'catalog' ? 600 : 500}
                  tone={tab === 'catalog' ? 'primary' : 'muted'}
                >
                  {`${catalogTabLabel} (${catalogApps.length})`}
                </Text>
              </Pressable>
            </Row>
            {extraHeroActions}
          </>
        }
      />

      <ManagementSearchBar
        id="apps-search"
        ariaLabel="Search Apps"
        placeholder={
          tab === 'catalog' ? `Search ${catalogTabLabel.toLowerCase()}…` : 'Search installed Apps…'
        }
        value={query}
        onChange={onQueryChange}
        trailing={
          <Row align="center" gapPx={8}>
            <HausButton variant="outline" size="sm" disabled={loading} onPress={onRefresh}>
              <UiIcon name="refresh-cw" size={14} />
              <Text size={12.5}>Refresh</Text>
            </HausButton>
            {canManage && onOpenRepositories && (
              <HausButton
                id="apps-open-repositories"
                variant="outline"
                size="sm"
                disabled={loading}
                onPress={onOpenRepositories}
              >
                <UiIcon name="folder-git-2" size={14} />
                <Text size={12.5}>Repositories</Text>
              </HausButton>
            )}
          </Row>
        }
      />

      {tab === 'installed' && filters.length > 0 && (
        <ManagementFilterBar
          idPrefix="apps-filter"
          tabs={filters}
          activeId={filter}
          onChange={onFilterChange}
        />
      )}

      {tab === 'catalog' &&
        catalogFilters &&
        catalogFilters.length > 0 &&
        onCatalogFilterChange && (
          <ManagementFilterBar
            idPrefix="apps-catalog-filter"
            tabs={catalogFilters}
            activeId={catalogFilter ?? catalogFilters[0]!.id}
            onChange={onCatalogFilterChange}
          />
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

      {tab === 'installed' ? (
        installedApps.length === 0 ? (
          <ManagementEmptyCard
            icon="box"
            title="No matching Apps"
            subtitle="Try another search term, clear filters, or browse the Catalog."
            action={
              <HausButton variant="secondary" size="sm" onPress={() => onTabChange('catalog')}>
                <Text size={12.5}>{`Browse ${catalogTabLabel}`}</Text>
                <UiIcon name="chevron-right" size={14} />
              </HausButton>
            }
          />
        ) : (
          <DashboardGrid columns={gridColumns}>
            {installedApps.map((app) => (
              <InstalledAppGlassCard
                key={app.id}
                app={app}
                canManage={canManage}
                busy={busyAppId === app.id}
                onManage={onManageApp}
                onQuickToggle={onQuickToggleApp}
              />
            ))}
          </DashboardGrid>
        )
      ) : catalogApps.length === 0 ? (
        <ManagementEmptyCard
          icon="search"
          title="No matching catalog items"
          subtitle="Try another keyword or refresh your repositories."
        />
      ) : (
        <DashboardGrid columns={gridColumns}>
          {catalogApps.map((entry) => (
            <CatalogAppGlassCard
              key={entry.id}
              entry={entry}
              canManage={canManage}
              busy={busyAppId === entry.id}
              onSelect={onInstallCatalogApp}
            />
          ))}
        </DashboardGrid>
      )}
    </Stack>
  );
}
