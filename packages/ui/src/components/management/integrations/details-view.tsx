/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import type { RepairIssueRecord, UnifiedUpdateRecord } from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Heading,
  Row,
  Stack,
  Text,
  useHausUi,
} from '../../../primitives/index.js';
import {
  BrandIcon,
  ManagementEmptyCard,
  ManagementGlassCard,
  ManagementSearchBar,
  ManagementStatusPill,
  type BrandIconKind,
} from '../../brand/index.js';
import type { PortableDiscoveredFlow } from '../../connections/discovered-panel.js';
import { UiIcon } from '../../icon.js';
import { IntegrationAttentionSection } from './attention-section.js';
import { IntegrationEntryCardView, type IntegrationEntryDetailItem } from './entry-card.js';

export type { IntegrationEntryDetailItem, PortableIntegrationDeviceItem } from './entry-card.js';

/**
 * Full-page Electron-matched Integration Details view built on `<ManagementGlassCard />`
 * and `<BrandIcon />`, featuring Needs Attention (Reauthenticate / Reconfigure / Fix repairs /
 * Discovered), per-entry Options/Reconfigure/Reload/Disable/Delete with confirmation,
 * linked device rows, and integration updates.
 */
export function IntegrationDetailsView({
  domain,
  iconKind = 'integration',
  title,
  runtimeLabel,
  iotClassLabel,
  version,
  documentationUrl,
  deviceCount,
  entityCount,
  entries,
  issues = [],
  discovered = [],
  updateItem,
  installingUpdateId,
  canManage,
  busy,
  error,
  notice,
  onBack,
  onAddEntry,
  onOptionsEntry,
  onReconfigureEntry,
  onReauthEntry,
  onReloadEntry,
  onToggleDisabled,
  onDeleteEntry,
  onFixRepair,
  onToggleIgnoreRepair,
  onConfigureDiscovered,
  onInstallUpdate,
  onOpenHacs,
  onOpenExternal,
  onOpenDevice,
}: {
  readonly domain: string;
  readonly iconKind?: BrandIconKind;
  readonly title: string;
  readonly runtimeLabel: string;
  readonly iotClassLabel?: string;
  readonly version?: string;
  readonly documentationUrl?: string;
  readonly deviceCount: number;
  readonly entityCount: number;
  readonly entries: readonly IntegrationEntryDetailItem[];
  readonly issues?: readonly RepairIssueRecord[];
  readonly discovered?: readonly PortableDiscoveredFlow[];
  readonly updateItem?: UnifiedUpdateRecord;
  readonly installingUpdateId?: string | null;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly notice?: string;
  readonly onBack: () => void;
  readonly onAddEntry?: () => void;
  readonly onOptionsEntry?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReconfigureEntry?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReauthEntry?: (entry: IntegrationEntryDetailItem) => void;
  readonly onReloadEntry: (entryId: string) => void;
  readonly onToggleDisabled: (entryId: string, disabled: boolean) => void;
  readonly onDeleteEntry?: (entryId: string) => void;
  readonly onFixRepair?: (issue: RepairIssueRecord) => void;
  readonly onToggleIgnoreRepair?: (issue: RepairIssueRecord, ignore: boolean) => void;
  readonly onConfigureDiscovered?: (item: PortableDiscoveredFlow) => void;
  readonly onInstallUpdate?: (item: UnifiedUpdateRecord) => void;
  readonly onOpenHacs?: () => void;
  readonly onOpenExternal?: (url: string) => void;
  readonly onOpenDevice?: (deviceId: string) => void;
}) {
  const { theme } = useHausUi();
  const dark = theme.mode === 'dark';
  const primaryFg = dark ? '#101010' : '#ffffff';
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<IntegrationEntryDetailItem | null>(null);

  const flaggedEntries = entries.filter((entry) => entry.needsAttention);
  const activeRepairs = issues.filter((issue) => !issue.ignored);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasMatches =
    !normalizedQuery ||
    entries.some(
      (entry) =>
        entry.title.toLowerCase().includes(normalizedQuery) ||
        entry.devices.some((dev) =>
          `${dev.name} ${dev.model ?? ''} ${dev.manufacturer ?? ''} ${dev.areaName ?? ''} ${dev.id}`
            .toLowerCase()
            .includes(normalizedQuery),
        ),
    );

  return (
    <Stack gapPx={16} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <Row align="center" justify="between" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <HausButton id="integration-detail-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={16} />
          <Text size={13}>Integrations</Text>
        </HausButton>
        <Row align="center" gapPx={8} wrap>
          {documentationUrl && onOpenExternal && (
            <HausButton
              id="integration-detail-docs"
              variant="ghost"
              size="sm"
              onPress={() => onOpenExternal(documentationUrl)}
            >
              <Text size={12.5}>Documentation</Text>
              <UiIcon name="external-link" size={13} />
            </HausButton>
          )}
          {onOpenHacs && (
            <HausButton variant="secondary" size="sm" onPress={onOpenHacs}>
              <UiIcon name="sparkles" size={14} />
              <Text size={12.5}>Open in HACS</Text>
            </HausButton>
          )}
          {updateItem?.updateAvailable && onInstallUpdate && canManage && (
            <HausButton
              id="integration-detail-update"
              variant="secondary"
              size="sm"
              disabled={busy || installingUpdateId === updateItem.id}
              onPress={() => onInstallUpdate(updateItem)}
            >
              <UiIcon name="arrow-up-circle" size={14} />
              <Text size={12.5}>
                {installingUpdateId === updateItem.id
                  ? 'Updating…'
                  : `Update to ${updateItem.latestVersion}`}
              </Text>
            </HausButton>
          )}
          {canManage && onAddEntry && (
            <HausButton
              id="integration-detail-add-entry"
              variant="primary"
              size="sm"
              disabled={busy}
              onPress={onAddEntry}
            >
              <UiIcon name="plus" size={14} color={primaryFg} />
              <Text
                size={12.5}
                style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
              >
                Add entry
              </Text>
            </HausButton>
          )}
        </Row>
      </Row>

      <ManagementGlassCard
        radius={24}
        padding={insets(20, 22)}
        style={{ layout: { width: pct(100) } }}
      >
        <Row
          align="center"
          justify="between"
          gapPx={16}
          wrap
          style={{ layout: { width: pct(100) } }}
        >
          <Row align="center" gapPx={16} style={{ layout: { flexGrow: 1, minWidth: px(240) } }}>
            <BrandIcon kind={iconKind} id={domain} size={56} hint={{ name: title }} />
            <Stack gapPx={6} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
              <Heading level={2} size={20} weight={600}>
                {title}
              </Heading>
              <Row align="center" gapPx={6} wrap>
                <ManagementStatusPill label={runtimeLabel} tone="neutral" />
                {iotClassLabel && <ManagementStatusPill label={iotClassLabel} tone="neutral" />}
                {version && <ManagementStatusPill label={`v${version}`} tone="neutral" />}
                {updateItem?.updateAvailable && (
                  <ManagementStatusPill
                    label={`Update ${updateItem.latestVersion}`}
                    tone="accent"
                    showDot
                  />
                )}
              </Row>
            </Stack>
          </Row>

          <Row align="center" gapPx={8} wrap>
            <ManagementStatusPill
              label={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
              tone="neutral"
            />
            <ManagementStatusPill
              label={`${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`}
              tone="neutral"
            />
            <ManagementStatusPill
              label={`${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`}
              tone="neutral"
            />
          </Row>
        </Row>
      </ManagementGlassCard>

      {notice && (
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(10, 14) },
            material: new SolidMaterial(rgba(52, 211, 153, dark ? 0.12 : 0.1)),
            border: { width: 1, color: rgba(52, 211, 153, 0.32) },
            corners: corners(14),
          }}
        >
          <UiIcon name="check-circle" size={15} color="#34d399" />
          <Text size={12.5}>{notice}</Text>
        </Row>
      )}
      {error && (
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(10, 14) },
            material: new SolidMaterial(rgba(239, 68, 68, dark ? 0.14 : 0.1)),
            border: { width: 1, color: rgba(239, 68, 68, 0.34) },
            corners: corners(14),
          }}
        >
          <UiIcon name="alert-circle" size={15} color={dark ? '#fca5a5' : '#b91c1c'} />
          <Text size={12.5} tone="critical">
            {error}
          </Text>
        </Row>
      )}

      <IntegrationAttentionSection
        title={title}
        flaggedEntries={flaggedEntries}
        activeRepairs={activeRepairs}
        discovered={discovered}
        canManage={canManage}
        busy={busy}
        onReauthEntry={onReauthEntry}
        onReconfigureEntry={onReconfigureEntry}
        onFixRepair={onFixRepair}
        onToggleIgnoreRepair={onToggleIgnoreRepair}
        onConfigureDiscovered={onConfigureDiscovered}
        onOpenExternal={onOpenExternal}
      />

      <ManagementSearchBar
        id="integration-detail-search"
        ariaLabel="Search integration entries or devices"
        placeholder="Search entries or linked devices…"
        value={searchQuery}
        onChange={setSearchQuery}
      />

      <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
        <Text size={11.5} weight={700} tone="muted">
          {entries.length === 1 && !normalizedQuery
            ? 'CONFIGURED INSTANCE & DEVICES'
            : 'CONFIGURED INSTANCES'}
        </Text>
        {entries.map((entry) => (
          <IntegrationEntryCardView
            key={entry.entryId}
            entry={entry}
            searchQuery={searchQuery}
            canManage={canManage}
            busy={busy}
            onOptions={onOptionsEntry}
            onReconfigure={onReconfigureEntry}
            onReauth={onReauthEntry}
            onReload={onReloadEntry}
            onToggleDisabled={onToggleDisabled}
            onDelete={onDeleteEntry ? (target) => setConfirmDelete(target) : undefined}
            onOpenDevice={onOpenDevice}
          />
        ))}
        {!hasMatches && (
          <ManagementEmptyCard
            icon="search"
            title="No matching entries or devices"
            subtitle={`Nothing matched "${searchQuery.trim()}".`}
          />
        )}
      </Stack>

      {confirmDelete && (
        <HausDialog
          size="sm"
          eyebrow="REMOVE INTEGRATION"
          title={`Delete ${confirmDelete.title}?`}
          subtitle="This removes the integration entry and its saved credentials from your Hub."
          scrollable={false}
          onClose={() => setConfirmDelete(null)}
          footer={
            <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
              <HausButton variant="ghost" onPress={() => setConfirmDelete(null)}>
                <Text size={12.5}>Cancel</Text>
              </HausButton>
              <HausButton
                id="integration-confirm-delete"
                variant="danger"
                disabled={busy}
                onPress={() => {
                  const targetId = confirmDelete.entryId;
                  setConfirmDelete(null);
                  onDeleteEntry?.(targetId);
                }}
              >
                <UiIcon name="trash-2" size={13} color="#ffffff" />
                <Text
                  size={12.5}
                  style={{ typography: { color: rgba(255, 255, 255, 1), weight: 600 } }}
                >
                  Delete entry
                </Text>
              </HausButton>
            </Row>
          }
        >
          <Text size={12.5} tone="muted" style={{ typography: { size: 12.5, lineHeight: 1.45 } }}>
            Devices associated exclusively with this entry will stop updating until the integration
            is configured again.
          </Text>
        </HausDialog>
      )}
    </Stack>
  );
}
