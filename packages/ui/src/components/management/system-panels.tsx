/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  filterUpdates,
  formatRelativeAge,
  humanizeIdentifier,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
  type UpdatesFilterId,
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
  useHausUi,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

const UPDATE_TABS: readonly { readonly id: UpdatesFilterId; readonly label: string }[] = [
  { id: 'available', label: 'Available' },
  { id: 'all', label: 'All' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'core_addon', label: 'Core & Apps' },
  { id: 'hacs', label: 'Integrations & HACS' },
  { id: 'bridges', label: 'Bridges' },
];

export function RepairsPanelView({
  issues,
  busy,
  onBack,
  onToggleIgnore,
}: {
  readonly issues: readonly RepairIssueRecord[];
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onToggleIgnore: (issue: RepairIssueRecord, ignore: boolean) => void;
}) {
  const [showIgnored, setShowIgnored] = useState(false);
  const ignoredCount = issues.filter((item) => item.ignored).length;
  const visible = issues.filter((item) => (showIgnored ? true : !item.ignored));

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={10}>
        <HausButton id="repairs-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={16} />
          <Text size={13}>Back</Text>
        </HausButton>
        {ignoredCount > 0 && (
          <HausButton variant="secondary" size="sm" onPress={() => setShowIgnored((prev) => !prev)}>
            <Text size={12.5}>
              {showIgnored ? 'Hide ignored' : `Show ignored (${ignoredCount})`}
            </Text>
          </HausButton>
        )}
      </Row>

      <Stack gapPx={4}>
        <Heading level={2} size={20} weight={600}>
          Repairs
        </Heading>
        <Text size={13} tone="muted">
          Resolve integration authentication, setup faults, and runtime warnings.
        </Text>
      </Stack>

      {visible.length === 0 ? (
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
          <UiIcon name="check-circle" size={28} />
          <Heading level={3} size={16} weight={600}>
            No active repairs
          </Heading>
          <Text size={12} tone="muted">
            Your integrations, bridges, and services are running without repair issues.
          </Text>
        </Stack>
      ) : (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          {visible.map((issue) => {
            const title =
              issue.title || humanizeIdentifier(issue.translation_key ?? issue.issue_id);
            const age = formatRelativeAge(issue.created);
            const severity = humanizeIdentifier(issue.severity ?? 'warning');
            return (
              <Row
                key={`${issue.domain}:${issue.issue_id}`}
                align="center"
                justify="between"
                gapPx={14}
                wrap
                style={{
                  layout: { width: pct(100), padding: insets(14, 16) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(14),
                }}
              >
                <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
                  <Row align="center" gapPx={8} wrap>
                    <UiIcon name="wrench" size={16} />
                    <Text size={14} weight={600}>
                      {title}
                    </Text>
                    <Box
                      style={{
                        layout: { padding: insets(2, 8) },
                        material: new SolidMaterial(rgba(251, 191, 36, 0.14)),
                        border: { width: 1, color: rgba(251, 191, 36, 0.3) },
                        corners: corners(999),
                      }}
                    >
                      <Text size={11}>{severity}</Text>
                    </Box>
                    {age && (
                      <Text size={11} tone="muted">
                        {age}
                      </Text>
                    )}
                  </Row>
                  {issue.description && (
                    <Text size={12} tone="muted">
                      {issue.description}
                    </Text>
                  )}
                </Stack>
                <HausButton
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onPress={() => onToggleIgnore(issue, !issue.ignored)}
                >
                  <Text size={12}>{issue.ignored ? 'Restore' : 'Ignore'}</Text>
                </HausButton>
              </Row>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

export function UpdatesPanelView({
  updates,
  checking,
  installingId,
  onBack,
  onCheck,
  onInstall,
  onInstallAll,
  onOpenHacs,
}: {
  readonly updates: UnifiedUpdatesSummary | null;
  readonly checking: boolean;
  readonly installingId: string | null;
  readonly onBack: () => void;
  readonly onCheck: () => void;
  readonly onInstall: (item: UnifiedUpdateRecord) => void;
  readonly onInstallAll?: (items: readonly UnifiedUpdateRecord[]) => void;
  readonly onOpenHacs?: () => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const [filter, setFilter] = useState<UpdatesFilterId>(() =>
    (updates?.availableCount ?? 0) > 0 ? 'available' : 'all',
  );
  const items = updates?.items ?? [];
  const availableItems = items.filter((item) => item.updateAvailable);
  const installable = availableItems.filter((item) => item.canInstall);
  const visible = filterUpdates(items, filter);

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between" gapPx={10} wrap>
        <HausButton id="updates-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={16} />
          <Text size={13}>Back</Text>
        </HausButton>
        <Row align="center" gapPx={8} wrap>
          {onOpenHacs && (
            <HausButton id="updates-open-hacs" variant="secondary" size="sm" onPress={onOpenHacs}>
              <UiIcon name="sparkles" size={14} />
              <Text size={12.5}>Community</Text>
            </HausButton>
          )}
          {onInstallAll && installable.length > 1 && (
            <HausButton
              variant="primary"
              size="sm"
              disabled={Boolean(installingId) || checking}
              onPress={() => onInstallAll(installable)}
            >
              <UiIcon name="arrow-up-circle" size={14} color={primaryFg} />
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                {`Update all (${installable.length})`}
              </Text>
            </HausButton>
          )}
          <HausButton variant="outline" size="sm" disabled={checking} onPress={onCheck}>
            <UiIcon name="refresh-cw" size={14} />
            <Text size={12.5}>{checking ? 'Checking…' : 'Check for updates'}</Text>
          </HausButton>
        </Row>
      </Row>

      <Stack gapPx={4}>
        <Heading level={2} size={20} weight={600}>
          Updates
        </Heading>
        <Text size={13} tone="muted">
          Keep core services, device firmware, and bridges up to date.
        </Text>
      </Stack>

      <Row gapPx={8} wrap>
        {UPDATE_TABS.map((tab) => {
          const active = filter === tab.id;
          return (
            <Pressable
              key={tab.id}
              ariaPressed={active}
              onActivate={() => setFilter(tab.id)}
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
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {visible.length === 0 ? (
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
          <UiIcon name="check-circle" size={28} />
          <Heading level={3} size={16} weight={600}>
            Everything is up to date
          </Heading>
          <Text size={12} tone="muted">
            No pending updates match this filter.
          </Text>
        </Stack>
      ) : (
        <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
          {visible.map((item) => (
            <Row
              key={item.id}
              align="center"
              justify="between"
              gapPx={14}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(14, 16) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(14),
              }}
            >
              <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
                <Text size={14} weight={600}>
                  {item.title}
                </Text>
                <Text size={12} tone="muted">
                  {item.updateAvailable
                    ? `${item.installedVersion} -> ${item.latestVersion}`
                    : `Installed v${item.installedVersion}`}
                </Text>
                {item.releaseSummary && (
                  <Text size={11.5} tone="muted">
                    {item.releaseSummary}
                  </Text>
                )}
              </Stack>
              {item.updateAvailable ? (
                <HausButton
                  variant="primary"
                  size="sm"
                  disabled={!item.canInstall || Boolean(installingId)}
                  onPress={() => onInstall(item)}
                >
                  <Text
                    size={12.5}
                    style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                  >
                    {installingId === item.id ? 'Updating…' : 'Update'}
                  </Text>
                </HausButton>
              ) : (
                <Text size={11.5} tone="muted">
                  Up to date
                </Text>
              )}
            </Row>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
