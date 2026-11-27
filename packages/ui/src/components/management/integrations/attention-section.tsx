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
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { HausButton, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import { ManagementGlassCard, ManagementStatusPill } from '../../brand/index.js';
import type { PortableDiscoveredFlow } from '../../connections/discovered-panel.js';
import { UiIcon } from '../../icon.js';
import type { IntegrationEntryDetailItem } from './entry-card.js';

/**
 * Shared Needs Attention glass card inside Integration Details, unifying
 * Reauthenticate / Reconfigure entry prompts, Repair issues (`Fix` / `Docs` / `Ignore`),
 * and newly discovered devices for the integration family.
 */
export function IntegrationAttentionSection({
  title,
  flaggedEntries,
  activeRepairs,
  discovered,
  canManage,
  busy,
  onReauthEntry,
  onReconfigureEntry,
  onFixRepair,
  onToggleIgnoreRepair,
  onConfigureDiscovered,
  onOpenExternal,
}: {
  readonly title: string;
  readonly flaggedEntries: readonly IntegrationEntryDetailItem[];
  readonly activeRepairs: readonly RepairIssueRecord[];
  readonly discovered: readonly PortableDiscoveredFlow[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onReauthEntry?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReconfigureEntry?: (entry: IntegrationEntryDetailItem) => void;
  readonly onFixRepair?: (issue: RepairIssueRecord) => void;
  readonly onToggleIgnoreRepair?: (issue: RepairIssueRecord, ignore: boolean) => void;
  readonly onConfigureDiscovered?: (item: PortableDiscoveredFlow) => void;
  readonly onOpenExternal?: (url: string) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const totalCount = flaggedEntries.length + activeRepairs.length + discovered.length;
  if (totalCount === 0) return null;

  return (
    <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
      <Row align="center" gapPx={8}>
        <Text size={11.5} weight={700} tone="muted">
          NEEDS ATTENTION
        </Text>
        <ManagementStatusPill label={String(totalCount)} tone="warning" />
      </Row>
      <ManagementGlassCard
        id="integration-detail-attention"
        radius={22}
        padding={insets(14, 16)}
        attention
        style={{ layout: { width: pct(100), gap: px(10) } }}
      >
        {flaggedEntries.map((entry) => {
          const isReauth = entry.attentionSource === 'reauth';
          const actionHandler = isReauth ? onReauthEntry : onReconfigureEntry;
          return (
            <Row
              key={`attn-${entry.entryId}`}
              align="center"
              justify="between"
              gapPx={12}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
              }}
            >
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(180) } }}>
                <Text size={13.5} weight={600}>
                  {entry.title || title}
                </Text>
                <Text size={12} tone="muted">
                  {isReauth
                    ? 'Authentication required to resume syncing.'
                    : entry.reason || 'Attention required'}
                </Text>
              </Stack>
              {canManage && actionHandler && (
                <HausButton
                  id={`attention-action-${entry.entryId}`}
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onPress={() => actionHandler(entry)}
                >
                  <UiIcon name={isReauth ? 'key-round' : 'wrench'} size={13} color={primaryFg} />
                  <Text
                    size={12}
                    style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                  >
                    {isReauth ? 'Reauthenticate' : 'Reconfigure'}
                  </Text>
                </HausButton>
              )}
            </Row>
          );
        })}

        {activeRepairs.map((issue) => {
          const issueTitle =
            issue.title || humanizeIdentifier(issue.translation_key ?? issue.issue_id);
          const age = formatRelativeAge(issue.created);
          const isCritical = issue.severity === 'error' || issue.severity === 'critical';
          return (
            <Row
              key={`repair-${issue.domain}:${issue.issue_id}`}
              align="center"
              justify="between"
              gapPx={12}
              wrap
              style={{
                layout: { width: pct(100), padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
              }}
            >
              <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(200) } }}>
                <Row align="center" gapPx={7} wrap>
                  <Text size={13.5} weight={600}>
                    {issueTitle}
                  </Text>
                  <ManagementStatusPill
                    label={humanizeIdentifier(issue.severity ?? 'warning')}
                    tone={isCritical ? 'danger' : 'warning'}
                  />
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
              <Row align="center" gapPx={6} wrap style={{ layout: { flexShrink: 0 } }}>
                {issue.learn_more_url && onOpenExternal && (
                  <HausButton
                    variant="ghost"
                    size="sm"
                    onPress={() => onOpenExternal(issue.learn_more_url!)}
                  >
                    <Text size={12}>Docs</Text>
                    <UiIcon name="external-link" size={12} />
                  </HausButton>
                )}
                {onToggleIgnoreRepair && (
                  <HausButton
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onPress={() => onToggleIgnoreRepair(issue, true)}
                  >
                    <Text size={12}>Ignore</Text>
                  </HausButton>
                )}
                {canManage && issue.is_fixable !== false && onFixRepair && (
                  <HausButton
                    id={`integration-detail-fix-${issue.issue_id}`}
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onPress={() => onFixRepair(issue)}
                  >
                    <UiIcon name="wrench" size={13} color={primaryFg} />
                    <Text
                      size={12}
                      style={{
                        typography: { color: colorToken('accentForeground'), weight: 600 },
                      }}
                    >
                      Fix
                    </Text>
                  </HausButton>
                )}
              </Row>
            </Row>
          );
        })}

        {discovered.map((item) => (
          <Row
            key={`disc-${item.flowId}`}
            align="center"
            justify="between"
            gapPx={12}
            wrap
            style={{
              layout: { width: pct(100), padding: insets(10, 12) },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('borderSubtle') },
              corners: corners(14),
            }}
          >
            <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(180) } }}>
              <Text size={13.5} weight={600}>
                {item.deviceLabel}
              </Text>
              <Text size={12} tone="muted">
                {`Discovered via ${item.sourceLabel ?? 'network discovery'} · Ready to configure`}
              </Text>
            </Stack>
            {canManage && onConfigureDiscovered && (
              <HausButton
                variant="primary"
                size="sm"
                disabled={busy}
                onPress={() => onConfigureDiscovered(item)}
              >
                <Text
                  size={12}
                  style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
                >
                  Configure
                </Text>
              </HausButton>
            )}
          </Row>
        ))}
      </ManagementGlassCard>
    </Stack>
  );
}
