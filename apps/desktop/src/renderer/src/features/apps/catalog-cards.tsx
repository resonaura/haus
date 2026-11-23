/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
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
    <Box semantic="article" className="addon-card">
      {rank !== undefined && (
        <Text className="vendor-driver-rank">{rank === 1 ? '#1 Top' : `#${rank}`}</Text>
      )}
      <Text className="addon-glyph">
        <BrandIcon
          kind={catalogIconKind(entry.runtimeType)}
          id={brand.iconId || entry.packageName || entry.id}
          size={44}
          hint={hint}
        />
      </Text>
      <Box className="addon-copy">
        <Box>
          <Heading level={3}>{entry.name}</Heading>
          <Box className="native-app-badges">
            <Text className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</Text>
            <Text className="status-pill">{entry.runtimeType}</Text>
            {entry.installed && (
              <Text className="status-pill status-available">
                {entry.updateAvailable ? 'Update available' : 'Installed'}
              </Text>
            )}
          </Box>
        </Box>
        <Text semantic="p">{entry.description || entry.category}</Text>
        <Text semantic="small">
          {entry.packageName ? `${entry.packageName} · ` : ''}Version {entry.latestVersion}
          {entry.author ? ` · ${entry.author}` : ''}
        </Text>
      </Box>
      <Box className="addon-actions">
        {entry.installed ? (
          <HausButton variant="secondary" onPress={() => onManageApp(entry.id)}>
            <Check size={16} />
            Manage
            <ChevronRight size={15} />
          </HausButton>
        ) : (
          <HausButton
            variant={admin ? 'primary' : 'secondary'}
            onPress={() => onSelectEntry(entry)}
          >
            {rank !== undefined ? <Settings2 size={15} /> : admin ? <Download size={16} /> : null}
            {rank !== undefined ? 'Configure separately' : admin ? 'Install' : 'Details'}
            {!admin && rank === undefined ? <ChevronRight size={15} /> : null}
          </HausButton>
        )}
      </Box>
    </Box>
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
    <Box semantic="article" className="addon-card vendor-group-addon-card">
      <Text className="addon-glyph">
        <BrandIcon kind="integration" id={group.iconId} size={44} hint={hint} />
      </Text>
      <Box className="addon-copy">
        <Box>
          <Heading level={3}>{group.vendorTitle}</Heading>
          <Box className="native-app-badges">
            <Text className="vendor-group-count-pill">
              <Layers size={12} />
              {group.items.length} items in group
            </Text>
            <Text className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</Text>
            <Text className="status-pill">{runtimes}</Text>
            {group.installedCount > 0 && (
              <Text className="status-pill status-available">{group.installedCount} installed</Text>
            )}
          </Box>
        </Box>
        <Text semantic="p">{group.whyGrouped}</Text>
        <Text semantic="small">Includes: {group.items.map((item) => item.name).join(' · ')}</Text>
      </Box>
      <Box className="addon-actions">
        <HausButton variant="secondary" onPress={() => onOpenGroup(group)}>
          {group.isCombinedHausGovee
            ? 'Combined & Separate Setup'
            : `Open Group (${group.items.length})`}
          <ChevronRight size={15} />
        </HausButton>
      </Box>
    </Box>
  );
});
