/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  formatAppCapabilityLabel,
  type AppsFilterId,
  type AppsTabId,
  type CatalogAppRecord,
  type InstalledAppRecord,
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
  TextInput,
} from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';

export interface PortableAppFilterTab {
  readonly id: AppsFilterId;
  readonly label: string;
  readonly count: number;
}

export function AppsWorkspaceView({
  columns = 3,
  tab,
  query,
  filter,
  filters,
  installedApps,
  totalInstalledCount,
  catalogApps,
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
  onInstallCatalogApp,
}: {
  readonly columns?: number;
  readonly tab: AppsTabId;
  readonly query: string;
  readonly filter: AppsFilterId;
  readonly filters: readonly PortableAppFilterTab[];
  readonly installedApps: readonly InstalledAppRecord[];
  readonly totalInstalledCount: number;
  readonly catalogApps: readonly CatalogAppRecord[];
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
  readonly onManageApp: (app: InstalledAppRecord) => void;
  readonly onInstallCatalogApp: (app: CatalogAppRecord) => void;
}) {
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
              layout: {
                width: px(42),
                height: px(42),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(12),
            }}
          >
            <UiIcon name="box" size={20} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={15} weight={600}>
              {tab === 'catalog'
                ? 'More possibilities for your home.'
                : 'The services behind your home.'}
            </Text>
            <Text size={12.5} tone="muted">
              Install, configure and maintain local home services.
            </Text>
          </Stack>
        </Row>
        <Row align="center" gapPx={8}>
          <Pressable
            id="apps-tab-installed"
            ariaPressed={tab === 'installed'}
            onActivate={() => onTabChange('installed')}
            style={{
              layout: { direction: 'row', alignItems: 'center', padding: insets(7, 13) },
              material: new SolidMaterial(
                tab === 'installed' ? colorToken('surfaceActive') : colorToken('surface'),
              ),
              border: {
                width: 1,
                color: tab === 'installed' ? colorToken('accent') : colorToken('border'),
              },
              corners: corners(999),
            }}
          >
            <Text size={12} weight={tab === 'installed' ? 600 : 500}>
              {`Installed (${totalInstalledCount})`}
            </Text>
          </Pressable>
          <Pressable
            id="apps-tab-catalog"
            ariaPressed={tab === 'catalog'}
            onActivate={() => onTabChange('catalog')}
            style={{
              layout: { direction: 'row', alignItems: 'center', padding: insets(7, 13) },
              material: new SolidMaterial(
                tab === 'catalog' ? colorToken('surfaceActive') : colorToken('surface'),
              ),
              border: {
                width: 1,
                color: tab === 'catalog' ? colorToken('accent') : colorToken('border'),
              },
              corners: corners(999),
            }}
          >
            <Text size={12} weight={tab === 'catalog' ? 600 : 500}>
              {`Catalog (${catalogApps.length})`}
            </Text>
          </Pressable>
        </Row>
      </Row>

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
            id="apps-search"
            ariaLabel="Search Apps"
            placeholder={tab === 'catalog' ? 'Search App catalog…' : 'Search installed Apps…'}
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

      {tab === 'installed' && (
        <Row gapPx={8} wrap>
          {filters.map((item) => {
            const active = filter === item.id;
            return (
              <Pressable
                key={item.id}
                id={`apps-filter-${item.id}`}
                ariaPressed={active}
                onActivate={() => onFilterChange(item.id)}
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
                  {item.label}
                </Text>
                <Text size={11} tone="muted">
                  {String(item.count)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
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
            <UiIcon name="box" size={26} />
            <Heading level={3} size={16} weight={600}>
              No matching Apps
            </Heading>
            <Text size={12} tone="muted">
              Try another search term or browse the Catalog.
            </Text>
          </Stack>
        ) : (
          <DashboardGrid columns={columns}>
            {installedApps.map((app) => {
              const running = app.available && app.state === 'running';
              return (
                <Stack
                  key={app.id}
                  id={`app-card-${app.id}`}
                  justify="between"
                  gapPx={12}
                  style={{
                    layout: { width: pct(100), minHeight: px(148), padding: insets(16) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(16),
                  }}
                >
                  <Row
                    align="start"
                    justify="between"
                    gapPx={10}
                    style={{ layout: { width: pct(100) } }}
                  >
                    <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text size={14.5} weight={600}>
                        {app.name}
                      </Text>
                      <Text size={12} tone="muted">
                        {formatAppCapabilityLabel(app)}
                      </Text>
                    </Stack>
                    <Box
                      style={{
                        layout: { padding: insets(3, 9), flexShrink: 0 },
                        material: new SolidMaterial(
                          running ? rgba(52, 211, 153, 0.14) : colorToken('surface'),
                        ),
                        border: {
                          width: 1,
                          color: running ? rgba(52, 211, 153, 0.35) : colorToken('border'),
                        },
                        corners: corners(999),
                      }}
                    >
                      <Text size={11}>{app.available ? app.state : 'Unavailable'}</Text>
                    </Box>
                  </Row>

                  <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
                    <Text size={11.5} tone="muted">
                      {app.version ? `v${app.version}` : app.externalId}
                    </Text>
                    <HausButton
                      id={`app-manage-${app.id}`}
                      variant="ghost"
                      size="sm"
                      onPress={() => onManageApp(app)}
                    >
                      <Text size={12.5}>Manage</Text>
                      <UiIcon name="chevron-right" size={14} />
                    </HausButton>
                  </Row>
                </Stack>
              );
            })}
          </DashboardGrid>
        )
      ) : (
        <DashboardGrid columns={columns}>
          {catalogApps.map((entry) => (
            <Stack
              key={entry.id}
              id={`catalog-card-${entry.id}`}
              justify="between"
              gapPx={12}
              style={{
                layout: { width: pct(100), minHeight: px(148), padding: insets(16) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Stack gapPx={4}>
                <Row align="center" justify="between" gapPx={8}>
                  <Text size={14.5} weight={600}>
                    {entry.name}
                  </Text>
                  <Text size={11} tone="muted">
                    {`v${entry.latestVersion}`}
                  </Text>
                </Row>
                {entry.description && (
                  <Text size={12} tone="muted">
                    {entry.description}
                  </Text>
                )}
              </Stack>
              <Row align="center" justify="between">
                <Text size={11} tone="muted">
                  {entry.verified ? 'Verified' : entry.category}
                </Text>
                {entry.installed ? (
                  <Text size={12} tone="muted">
                    Installed
                  </Text>
                ) : (
                  <HausButton
                    id={`catalog-install-${entry.id}`}
                    variant="primary"
                    size="sm"
                    disabled={!canManage || busyAppId === entry.id}
                    onPress={() => onInstallCatalogApp(entry)}
                  >
                    <Text
                      size={12}
                      style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                    >
                      {busyAppId === entry.id ? 'Installing…' : 'Install'}
                    </Text>
                  </HausButton>
                )}
              </Row>
            </Stack>
          ))}
        </DashboardGrid>
      )}
    </Stack>
  );
}
