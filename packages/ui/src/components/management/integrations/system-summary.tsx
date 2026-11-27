/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatRelativeAge,
  humanizeIdentifier,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
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
import { Box, Pressable, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import { BrandIcon, ManagementGlassCard, ManagementStatusPill } from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

function formatUpdateCategory(category: UnifiedUpdateRecord['category']): string {
  switch (category) {
    case 'core':
      return 'Core';
    case 'firmware':
      return 'Firmware';
    case 'addon':
      return 'App';
    case 'hacs':
      return 'Community';
    case 'homebridge':
      return 'Homebridge';
    case 'scrypted':
      return 'Scrypted';
    case 'plugin':
      return 'Plugin';
    default:
      return 'Integration';
  }
}

function brandKindForUpdate(
  category: UnifiedUpdateRecord['category'],
): 'integration' | 'addon' | 'hacs' | 'homebridge' | 'scrypted' | 'plugin' {
  if (category === 'firmware' || category === 'core') return 'integration';
  return category;
}

/**
 * Shared Electron-matched Repairs & Updates summary preview cards with refined
 * monochrome glass surfaces (`<GlassRim />`) and `<BrandIcon />` icons.
 */
export function SystemSummaryCardsView({
  issues,
  updates,
  formatDomain = humanizeIdentifier,
  onOpenRepairs,
  onFixRepair,
  onOpenUpdates,
}: {
  readonly issues: readonly RepairIssueRecord[];
  readonly updates: UnifiedUpdatesSummary | null;
  readonly formatDomain?: (domain: string) => string;
  readonly onOpenRepairs: () => void;
  readonly onFixRepair?: (issue: RepairIssueRecord) => void;
  readonly onOpenUpdates: () => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const activeRepairs = issues.filter((item) => !item.ignored);
  const availableUpdates = (updates?.items ?? []).filter((item) => item.updateAvailable);
  const totalUpdates = updates?.total ?? 0;

  if (activeRepairs.length === 0 && availableUpdates.length === 0 && totalUpdates === 0) {
    return null;
  }

  const rowHoverBg = mixColor(transparentColor, colorToken('ink'), dark ? 0.05 : 0.035);

  return (
    <Row gapPx={14} wrap style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      {activeRepairs.length > 0 && (
        <ManagementGlassCard
          id="system-summary-repairs"
          radius={22}
          padding={insets(14, 16)}
          attention
          style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(280), gap: px(10) } }}
        >
          <Pressable
            id="system-summary-repairs-header"
            onActivate={onOpenRepairs}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                width: pct(100),
                padding: insets(2, 4),
              },
              corners: corners(10),
            }}
          >
            <Row align="center" gapPx={8}>
              <UiIcon name="wrench" size={14} />
              <Text size={13.5} weight={600}>
                {`${activeRepairs.length} ${activeRepairs.length === 1 ? 'repair' : 'repairs'}`}
              </Text>
              <ManagementStatusPill label="Attention" tone="warning" />
            </Row>
            <UiIcon name="chevron-right" size={15} />
          </Pressable>

          <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
            {activeRepairs.slice(0, 2).map((issue) => {
              const title =
                issue.title || humanizeIdentifier(issue.translation_key ?? issue.issue_id);
              const age = formatRelativeAge(issue.created);
              const source = issue.sourceLabel || formatDomain(issue.domain);
              const severity = humanizeIdentifier(issue.severity ?? 'warning');
              const isCritical = issue.severity === 'error' || issue.severity === 'critical';
              return (
                <Pressable
                  key={`${issue.domain}:${issue.issue_id}`}
                  onActivate={() => (onFixRepair ? onFixRepair(issue) : onOpenRepairs())}
                  style={{
                    layout: {
                      direction: 'row',
                      alignItems: 'center',
                      justifyContent: 'between',
                      gap: px(10),
                      width: pct(100),
                      padding: insets(8, 10),
                    },
                    material: new SolidMaterial(colorToken('surface')),
                    border: { width: 1, color: colorToken('borderSubtle') },
                    corners: corners(14),
                    states: { hover: { material: new SolidMaterial(rowHoverBg) } },
                  }}
                >
                  <Row
                    align="center"
                    gapPx={10}
                    style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                  >
                    <BrandIcon
                      kind="integration"
                      id={issue.domain}
                      size={38}
                      hint={issue.sourceLabel ? { name: issue.sourceLabel } : undefined}
                    />
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text
                        size={12.5}
                        weight={600}
                        style={{
                          typography: { size: 12.5, weight: 600, maxLines: 1, truncate: true },
                        }}
                      >
                        {title}
                      </Text>
                      <Row align="center" gapPx={5} wrap>
                        <Text
                          size={11}
                          weight={600}
                          style={{
                            typography: {
                              size: 11,
                              weight: 600,
                              color: isCritical ? rgba(248, 113, 113, 1) : rgba(251, 191, 36, 1),
                            },
                          }}
                        >
                          {severity}
                        </Text>
                        <Text size={11} tone="muted">
                          {[age ? `· ${age}` : '', source ? `by ${source}` : '']
                            .filter(Boolean)
                            .join(' ')}
                        </Text>
                      </Row>
                    </Stack>
                  </Row>
                  <UiIcon name="chevron-right" size={14} />
                </Pressable>
              );
            })}
          </Stack>
        </ManagementGlassCard>
      )}

      {(availableUpdates.length > 0 || totalUpdates > 0) && (
        <ManagementGlassCard
          id="system-summary-updates"
          radius={22}
          padding={insets(14, 16)}
          style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(280), gap: px(10) } }}
        >
          <Pressable
            id="system-summary-updates-header"
            onActivate={onOpenUpdates}
            style={{
              layout: {
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'between',
                width: pct(100),
                padding: insets(2, 4),
              },
              corners: corners(10),
            }}
          >
            <Row align="center" gapPx={8}>
              <UiIcon name="arrow-up-circle" size={14} />
              <Text size={13.5} weight={600}>
                {availableUpdates.length > 0
                  ? `${availableUpdates.length} ${availableUpdates.length === 1 ? 'update' : 'updates'}`
                  : 'Updates · All up to date'}
              </Text>
              {availableUpdates.length > 0 && (
                <ManagementStatusPill label="Available" tone="accent" />
              )}
            </Row>
            <UiIcon name="chevron-right" size={15} />
          </Pressable>

          {availableUpdates.length > 0 && (
            <Stack gapPx={6} style={{ layout: { width: pct(100) } }}>
              {availableUpdates.slice(0, 2).map((item) => (
                <Pressable
                  key={item.id}
                  onActivate={onOpenUpdates}
                  style={{
                    layout: {
                      direction: 'row',
                      alignItems: 'center',
                      justifyContent: 'between',
                      gap: px(10),
                      width: pct(100),
                      padding: insets(8, 10),
                    },
                    material: new SolidMaterial(colorToken('surface')),
                    border: { width: 1, color: colorToken('borderSubtle') },
                    corners: corners(14),
                    states: { hover: { material: new SolidMaterial(rowHoverBg) } },
                  }}
                >
                  <Row
                    align="center"
                    gapPx={10}
                    style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                  >
                    {item.category === 'core' ? (
                      <Box
                        style={{
                          layout: {
                            width: px(38),
                            height: px(38),
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          },
                          material: new SolidMaterial(colorToken('card')),
                          border: { width: 1, color: colorToken('border') },
                          corners: corners(11),
                        }}
                      >
                        <UiIcon name="arrow-up-circle" size={19} />
                      </Box>
                    ) : (
                      <BrandIcon
                        kind={brandKindForUpdate(item.category)}
                        id={item.domain}
                        size={38}
                        hint={{ name: item.title, category: item.category }}
                      />
                    )}
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text
                        size={12.5}
                        weight={600}
                        style={{
                          typography: { size: 12.5, weight: 600, maxLines: 1, truncate: true },
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text size={11} tone="muted">
                        {`${formatUpdateCategory(item.category)} · ${item.installedVersion} → ${item.latestVersion}`}
                      </Text>
                    </Stack>
                  </Row>
                  <UiIcon name="chevron-right" size={14} />
                </Pressable>
              ))}
            </Stack>
          )}
        </ManagementGlassCard>
      )}
    </Row>
  );
}
