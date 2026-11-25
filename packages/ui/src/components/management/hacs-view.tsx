/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  DEFAULT_HACS_CATEGORIES,
  type CommunityRepository,
  type CriticalRepository,
  type HacsInfo,
  type HacsScope,
  type RemovedRepository,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  SelectInput,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

const SCOPE_TABS: readonly { readonly id: HacsScope; readonly label: string }[] = [
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
  { id: 'browse', label: 'Explore' },
  { id: 'hidden', label: 'Hidden' },
  { id: 'removed', label: 'Removed' },
];

function repoMetaLine(repo: CommunityRepository): string {
  if (repo.installed) {
    if (repo.pending_upgrade && repo.available_version) {
      return `${repo.category} · ${repo.installed_version ?? 'Installed'} → ${repo.available_version}`;
    }
    return `${repo.category} · ${repo.installed_version ?? 'Installed'}`;
  }
  return repo.stars ? `${repo.category} · ${repo.stars.toLocaleString()} stars` : repo.category;
}

export function HacsCommunityView({
  info,
  repositories,
  filtered,
  critical,
  removed,
  query,
  scope,
  category,
  loading,
  busy,
  error,
  notice,
  onBack,
  onQueryChange,
  onScopeChange,
  onCategoryChange,
  onRefresh,
  onOpenAdd,
  onOpenSettings,
  onUpdateAll,
  onUpdateRepo,
  onSelectRepo,
  onAcknowledgeCritical,
}: {
  readonly info?: HacsInfo;
  readonly repositories: readonly CommunityRepository[];
  readonly filtered: readonly CommunityRepository[];
  readonly critical: readonly CriticalRepository[];
  readonly removed: readonly RemovedRepository[];
  readonly query: string;
  readonly scope: HacsScope;
  readonly category: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onBack: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onScopeChange: (value: HacsScope) => void;
  readonly onCategoryChange: (value: string) => void;
  readonly onRefresh: () => void;
  readonly onOpenAdd: () => void;
  readonly onOpenSettings?: () => void;
  readonly onUpdateAll: () => void;
  readonly onUpdateRepo: (repo: CommunityRepository) => void;
  readonly onSelectRepo: (repo: CommunityRepository) => void;
  readonly onAcknowledgeCritical: (item: CriticalRepository) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const pendingUpgradeCount = repositories.filter((repo) => repo.pending_upgrade).length;
  const activeCritical = critical.filter((item) => !item.acknowledged);

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={10} wrap>
        <HausButton id="hacs-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={16} />
          <Text size={13}>Back</Text>
        </HausButton>
        <Row align="center" gapPx={8} wrap>
          {pendingUpgradeCount > 0 && (
            <HausButton
              id="hacs-update-all"
              variant="primary"
              size="sm"
              disabled={busy || loading}
              onPress={onUpdateAll}
            >
              <UiIcon name="arrow-up-circle" size={14} color={primaryFg} />
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {`Update all (${pendingUpgradeCount})`}
              </Text>
            </HausButton>
          )}
          <HausButton
            id="hacs-add-source"
            variant="secondary"
            size="sm"
            disabled={busy || loading}
            onPress={onOpenAdd}
          >
            <UiIcon name="plus" size={14} />
            <Text size={12.5}>Add source</Text>
          </HausButton>
          {onOpenSettings && (
            <HausButton id="hacs-settings" variant="ghost" size="sm" onPress={onOpenSettings}>
              Settings
            </HausButton>
          )}
        </Row>
      </Row>

      <Stack gapPx={3}>
        <Heading level={2} size={20} weight={600}>
          Community
        </Heading>
        <Text size={13} tone="muted">
          {`HACS ${info?.version ?? ''} · Integrations and ideas from the community`}
        </Text>
      </Stack>

      {notice && (
        <Text size={12.5} tone="muted">
          {notice}
        </Text>
      )}
      {error && (
        <Text size={12.5} tone="critical">
          {error}
        </Text>
      )}
      {loading && (
        <Text size={12.5} tone="muted">
          Reading community catalog…
        </Text>
      )}
      {info?.disabled_reason && (
        <Text size={12.5} tone="critical">
          {`HACS needs attention: ${info.disabled_reason}`}
        </Text>
      )}

      {activeCritical.map((item, index) => (
        <Row
          key={item.repository}
          align="center"
          justify="between"
          gapPx={12}
          wrap
          style={{
            layout: { width: pct(100), padding: insets(12, 14) },
            material: new SolidMaterial(rgba(239, 68, 68, 0.1)),
            border: { width: 1, color: rgba(239, 68, 68, 0.32) },
            corners: corners(14),
          }}
        >
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
            <Text size={13.5} weight={600}>
              {item.repository}
            </Text>
            <Text size={12} tone="muted">
              {item.reason || 'HACS has reported an important issue with this repository.'}
            </Text>
          </Stack>
          <HausButton
            id={`hacs-critical-ack-${index}`}
            variant="secondary"
            size="sm"
            disabled={busy}
            onPress={() => onAcknowledgeCritical(item)}
          >
            Reviewed
          </HausButton>
        </Row>
      ))}

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
            id="hacs-search"
            ariaLabel="Search community"
            placeholder="Find a community integration or resource"
            value={query}
            onChange={onQueryChange}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
              typography: { size: 13, color: colorToken('textPrimary') },
            }}
          />
        </Row>
        <SelectInput
          id="hacs-category"
          ariaLabel="Community category"
          value={category}
          options={[
            { value: 'all', label: 'Every type' },
            ...(info?.categories ?? DEFAULT_HACS_CATEGORIES).map((value) => ({
              value,
              label: value,
            })),
          ]}
          onChange={onCategoryChange}
        />
        <HausButton
          id="hacs-refresh"
          variant="outline"
          size="sm"
          disabled={busy || loading}
          onPress={onRefresh}
        >
          <UiIcon name="refresh-cw" size={15} />
          <Text size={12.5}>Refresh</Text>
        </HausButton>
      </Row>

      <Row gapPx={8} wrap>
        {SCOPE_TABS.map((tab) => {
          const active = scope === tab.id;
          const label =
            tab.id === 'updates' && pendingUpgradeCount > 0
              ? `${tab.label} · ${pendingUpgradeCount}`
              : tab.label;
          return (
            <Pressable
              key={tab.id}
              id={`hacs-scope-${tab.id}`}
              ariaPressed={active}
              onActivate={() => onScopeChange(tab.id)}
              style={{
                layout: { direction: 'row', alignItems: 'center', padding: insets(6, 12) },
                material: new SolidMaterial(
                  active ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: active ? colorToken('accent') : colorToken('border') },
                corners: corners(999),
              }}
            >
              <Text size={12} weight={active ? 600 : 500} tone={active ? 'primary' : 'muted'}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {scope === 'removed' ? (
        removed.length > 0 ? (
          <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
            {removed.map((item) => (
              <Stack
                key={item.repository}
                gapPx={3}
                style={{
                  layout: { width: pct(100), padding: insets(14, 16) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(14),
                }}
              >
                <Text size={14} weight={600}>
                  {item.repository}
                </Text>
                <Text size={12} tone="muted">
                  {item.reason || 'This repository is no longer offered by HACS.'}
                </Text>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Text size={12.5} tone="muted">
            No removed repositories.
          </Text>
        )
      ) : filtered.length === 0 && !loading ? (
        <Text size={12.5} tone="muted">
          No community repositories match this filter.
        </Text>
      ) : (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          {filtered.map((repo) => (
            <Row
              key={String(repo.id)}
              align="center"
              justify="between"
              gapPx={12}
              style={{
                layout: { width: pct(100), padding: insets(12, 14) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(14),
              }}
            >
              <Pressable
                id={`hacs-repo-${repo.id}`}
                onActivate={() => onSelectRepo(repo)}
                style={{
                  layout: {
                    direction: 'row',
                    alignItems: 'center',
                    justifyContent: 'between',
                    flexGrow: 1,
                    minWidth: px(0),
                    gap: px(12),
                  },
                }}
              >
                <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Text size={14} weight={600}>
                    {repo.name}
                  </Text>
                  <Text size={12} tone="muted">
                    {repo.description || repo.full_name}
                  </Text>
                  <Text size={11} tone="secondary">
                    {repoMetaLine(repo)}
                  </Text>
                </Stack>
                <UiIcon name="chevron-right" size={16} />
              </Pressable>
              {repo.pending_upgrade ? (
                <HausButton
                  id={`hacs-update-${repo.id}`}
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onPress={() => onUpdateRepo(repo)}
                >
                  <UiIcon name="arrow-up-circle" size={14} color={primaryFg} />
                  <Text
                    size={12}
                    style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                  >
                    Update
                  </Text>
                </HausButton>
              ) : repo.installed ? (
                <Box
                  style={{
                    layout: { padding: insets(4, 9) },
                    material: new SolidMaterial(rgba(34, 197, 94, 0.14)),
                    border: { width: 1, color: rgba(34, 197, 94, 0.3) },
                    corners: corners(999),
                  }}
                >
                  <Text size={11} weight={600}>
                    Installed
                  </Text>
                </Box>
              ) : null}
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
