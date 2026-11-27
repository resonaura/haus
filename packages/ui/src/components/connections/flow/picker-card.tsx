/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import { formatStabilityMedal, type BrandCatalogItem } from '@haus/core/transport';
import { insets, pct, px } from '../../../ir/geometry.js';
import { Row, Stack, Text } from '../../../primitives/index.js';
import {
  BrandIcon,
  ManagementGlassCard,
  ManagementStatusPill,
  type BrandIconKind,
  type ManagementPillTone,
} from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

function iconKindForRuntime(runtime: BrandCatalogItem['runtime']): BrandIconKind {
  if (runtime === 'hacs') return 'hacs';
  if (runtime === 'homebridge') return 'homebridge';
  if (runtime === 'scrypted') return 'scrypted';
  if (runtime === 'docker') return 'app';
  return 'integration';
}

function runtimeTagLabel(runtime: BrandCatalogItem['runtime']): string | undefined {
  if (runtime === 'hacs') return 'HACS';
  if (runtime === 'homebridge') return 'Homebridge';
  if (runtime === 'scrypted') return 'Scrypted';
  if (runtime === 'docker') return 'Docker';
  return undefined;
}

function medalTone(tier: BrandCatalogItem['stabilityTier']): ManagementPillTone {
  if (tier === 'gold') return 'success';
  if (tier === 'silver') return 'accent';
  if (tier === 'bronze') return 'warning';
  return 'neutral';
}

/** Memoized high-density integration brand picker card (native hover, no per-row GlassRim shader). */
export const BrandPickerCard = memo(function BrandPickerCard({
  item,
  busy,
  onSelectBrand,
}: {
  readonly item: BrandCatalogItem;
  readonly busy: boolean;
  readonly onSelectBrand: (item: BrandCatalogItem) => void;
}) {
  const drivers = item.groupItems ?? [item];
  const multi = drivers.length > 1 || Boolean(item.isCombinedHausGovee);
  const runtimeTag = !multi ? runtimeTagLabel(item.runtime) : undefined;
  const medal = formatStabilityMedal(item.stabilityTier, item.trustScore, item.verified);
  const iconHint = useMemo(() => ({ name: item.title }), [item.title]);

  return (
    <ManagementGlassCard
      id={`flow-picker-${item.id}`}
      radius={18}
      padding={insets(12, 14)}
      interactive
      rim={false}
      onPress={busy ? undefined : () => onSelectBrand(item)}
      style={{ layout: { width: pct(100) } }}
    >
      <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <BrandIcon
            kind={iconKindForRuntime(item.runtime)}
            id={item.iconId ?? item.id}
            size={40}
            hint={iconHint}
          />
          <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text
              size={13.5}
              weight={600}
              style={{ typography: { size: 13.5, weight: 600, maxLines: 1, truncate: true } }}
            >
              {item.title}
            </Text>
            <Row align="center" gapPx={5} wrap>
              {multi ? (
                <ManagementStatusPill label={`${drivers.length} drivers`} tone="accent" />
              ) : runtimeTag ? (
                <ManagementStatusPill label={runtimeTag} tone="neutral" />
              ) : (
                <Text
                  size={11.5}
                  tone="muted"
                  style={{ typography: { size: 11.5, maxLines: 1, truncate: true } }}
                >
                  {item.domain ?? item.id}
                </Text>
              )}
              {(multi || item.runtime !== 'ha') && (
                <ManagementStatusPill label={medal.shortLabel} tone={medalTone(medal.tier)} />
              )}
              {item.installed && <ManagementStatusPill label="Installed" tone="success" />}
            </Row>
          </Stack>
        </Row>
        <UiIcon name="chevron-right" size={14} />
      </Row>
    </ManagementGlassCard>
  );
});
