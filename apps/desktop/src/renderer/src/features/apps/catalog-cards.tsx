/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import {
  HausButton,
  Heading,
  insets,
  ManagementGlassCard,
  ManagementStatusPill,
  pct,
  px,
  Row,
  Stack,
  Text,
} from '@haus/ui';
import { Check, ChevronRight, Download, Layers, Settings2 } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import type { CatalogAppSummary } from './catalog-api';
import { catalogIconKind } from './catalog-details';
import {
  formatStabilityMedal,
  resolveBrandIdentity,
  type CatalogVendorGroup,
} from './vendor-grouping';

export const CatalogAppCard = memo(function CatalogAppCard({
  entry,
  rank,
  admin,
  onSelectEntry,
  onManageApp,
}: {
  entry: CatalogAppSummary;
  rank?: number;
  admin: boolean;
  onSelectEntry: (entry: CatalogAppSummary) => void;
  onManageApp: (appId: string) => void;
}) {
  const brand = useMemo(
    () =>
      resolveBrandIdentity(
        entry.packageName ?? entry.id,
        entry.name,
        entry.vendorId,
        entry.vendorName,
      ),
    [entry.packageName, entry.id, entry.name, entry.vendorId, entry.vendorName],
  );
  const hint = useMemo(
    () => ({
      name: entry.name,
      category: entry.category,
      supportedBy: brand.vendorId,
      ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
    }),
    [entry.name, entry.category, brand.vendorId, entry.repositoryUrl],
  );
  const medal = formatStabilityMedal(entry.stabilityTier, entry.trustScore, entry.verified);

  return (
    <ManagementGlassCard
      radius={22}
      padding={insets(16, 18)}
      interactive
      style={{ layout: { width: pct(100) } }}
    >
      <Row align="center" justify="between" gapPx={14} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
          <BrandIcon
            kind={catalogIconKind(entry.runtimeType)}
            id={brand.iconId || entry.packageName || entry.id}
            size={44}
            hint={hint}
          />
          <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Row align="center" gapPx={7} wrap>
              {rank !== undefined && (
                <ManagementStatusPill label={rank === 1 ? '#1 Top' : `#${rank}`} tone="accent" />
              )}
              <Heading level={3} size={14.5} weight={600}>
                {entry.name}
              </Heading>
              <ManagementStatusPill label={medal.label} tone="neutral" />
              <ManagementStatusPill label={entry.runtimeType} tone="neutral" />
              {entry.installed && (
                <ManagementStatusPill
                  label={entry.updateAvailable ? 'Update available' : 'Installed'}
                  tone={entry.updateAvailable ? 'accent' : 'success'}
                />
              )}
            </Row>
            <Text size={12} tone="muted" style={{ typography: { size: 12, maxLines: 2 } }}>
              {entry.description || entry.category}
            </Text>
            <Text size={11.5} tone="muted">
              {`${entry.packageName ? `${entry.packageName} · ` : ''}Version ${entry.latestVersion}${entry.author ? ` · ${entry.author}` : ''}`}
            </Text>
          </Stack>
        </Row>
        <Row align="center" gapPx={8}>
          {entry.installed ? (
            <HausButton variant="secondary" size="sm" onPress={() => onManageApp(entry.id)}>
              <Check size={15} />
              Manage
              <ChevronRight size={14} />
            </HausButton>
          ) : (
            <HausButton
              variant={admin ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => onSelectEntry(entry)}
            >
              {rank !== undefined ? <Settings2 size={14} /> : admin ? <Download size={15} /> : null}
              {rank !== undefined ? 'Configure separately' : admin ? 'Install' : 'Details'}
              {!admin && rank === undefined ? <ChevronRight size={14} /> : null}
            </HausButton>
          )}
        </Row>
      </Row>
    </ManagementGlassCard>
  );
});

export const CatalogVendorGroupCard = memo(function CatalogVendorGroupCard({
  group,
  onOpenGroup,
}: {
  group: CatalogVendorGroup;
  onOpenGroup: (group: CatalogVendorGroup) => void;
}) {
  const medal = formatStabilityMedal(group.topStabilityTier, group.topTrustScore, true);
  const hint = useMemo(
    () => ({
      name: group.vendorTitle,
      supportedBy: group.vendorId,
      ...(group.items[0]?.repositoryUrl ? { repositoryUrl: group.items[0].repositoryUrl } : {}),
    }),
    [group.vendorTitle, group.vendorId, group.items],
  );
  const runtimes = Array.from(new Set(group.items.map((i) => i.runtimeType))).join(' · ');

  return (
    <ManagementGlassCard
      radius={22}
      padding={insets(16, 18)}
      interactive
      style={{ layout: { width: pct(100) } }}
    >
      <Row align="center" justify="between" gapPx={14} wrap style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(220) } }}>
          <BrandIcon kind="integration" id={group.iconId} size={44} hint={hint} />
          <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Row align="center" gapPx={7} wrap>
              <Heading level={3} size={14.5} weight={600}>
                {group.vendorTitle}
              </Heading>
              <ManagementStatusPill label={`${group.items.length} items in group`} tone="neutral" />
              <ManagementStatusPill label={medal.label} tone="neutral" />
              <ManagementStatusPill label={runtimes} tone="neutral" />
              {group.installedCount > 0 && (
                <ManagementStatusPill label={`${group.installedCount} installed`} tone="success" />
              )}
            </Row>
            <Text size={12} tone="muted">
              {group.whyGrouped}
            </Text>
            <Text size={11.5} tone="muted">
              {`Includes: ${group.items.map((item) => item.name).join(' · ')}`}
            </Text>
          </Stack>
        </Row>
        <HausButton variant="secondary" size="sm" onPress={() => onOpenGroup(group)}>
          <Layers size={14} />
          {group.isCombinedHausGovee
            ? 'Combined & Separate Setup'
            : `Open Group (${group.items.length})`}
          <ChevronRight size={14} />
        </HausButton>
      </Row>
    </ManagementGlassCard>
  );
});
