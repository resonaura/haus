/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  formatStabilityMedal,
  HAUS_GOVEE_WHY_GROUPED,
  VENDOR_GROUP_WHY_DEFAULT,
  type BrandCatalogItem,
} from '@haus/core/transport';
import { colorToken, insets, pct, px } from '../../../ir/geometry.js';
import { HausButton, Heading, Row, Stack, Text, useHausUi } from '../../../primitives/index.js';
import {
  BrandIcon,
  ManagementGlassCard,
  ManagementStatusPill,
  type BrandIconKind,
  type ManagementPillTone,
} from '../../brand/index.js';
import { UiIcon } from '../../icon.js';

function runtimeLabel(runtime: BrandCatalogItem['runtime']): string {
  if (runtime === 'hacs') return 'HACS';
  if (runtime === 'homebridge') return 'Homebridge';
  if (runtime === 'scrypted') return 'Scrypted';
  if (runtime === 'docker') return 'Docker';
  return 'Home Assistant';
}

function runtimeIconKind(runtime: BrandCatalogItem['runtime']): BrandIconKind {
  if (runtime === 'hacs') return 'hacs';
  if (runtime === 'homebridge') return 'homebridge';
  if (runtime === 'scrypted') return 'scrypted';
  if (runtime === 'docker') return 'app';
  return 'integration';
}

function medalTone(tier: BrandCatalogItem['stabilityTier']): ManagementPillTone {
  if (tier === 'gold') return 'success';
  if (tier === 'silver') return 'accent';
  if (tier === 'bronze') return 'warning';
  return 'neutral';
}

/**
 * Shared glass brand driver selector showing ranked drivers across Home Assistant,
 * HACS, Homebridge, Scrypted, and Docker with stability medals & trust scores.
 */
export function IntegrationBrandDetailView({
  brand,
  busy = false,
  onBack,
  onLaunchDriver,
}: {
  readonly brand: BrandCatalogItem;
  readonly busy?: boolean;
  readonly onBack: () => void;
  readonly onLaunchDriver: (driver: BrandCatalogItem) => void;
}) {
  const { theme } = useHausUi();
  const primaryFg = theme.mode === 'dark' ? '#101010' : '#ffffff';
  const drivers = brand.groupItems ?? [brand];
  const topMedal = formatStabilityMedal(brand.stabilityTier, brand.trustScore, brand.verified);
  const explainer = brand.isCombinedHausGovee ? HAUS_GOVEE_WHY_GROUPED : VENDOR_GROUP_WHY_DEFAULT;

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      <Row align="center" justify="between">
        <HausButton id="brand-detail-back" variant="ghost" size="sm" onPress={onBack}>
          <UiIcon name="arrow-left" size={14} />
          <Text size={12.5}>Back to all brands</Text>
        </HausButton>
      </Row>

      <ManagementGlassCard
        radius={22}
        padding={insets(16, 18)}
        style={{ layout: { width: pct(100) } }}
      >
        <Row align="start" gapPx={14} style={{ layout: { width: pct(100) } }}>
          <BrandIcon
            kind="integration"
            id={brand.iconId ?? brand.id}
            size={48}
            hint={{ name: brand.title }}
          />
          <Stack gapPx={6} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Row align="center" gapPx={7} wrap>
              <Heading level={3} size={16.5} weight={600}>
                {brand.title}
              </Heading>
              <ManagementStatusPill
                label={`${drivers.length} ${drivers.length === 1 ? 'driver' : 'drivers'}`}
                tone="neutral"
              />
              <ManagementStatusPill
                label={topMedal.label}
                tone={medalTone(topMedal.tier)}
                showDot
              />
            </Row>
            <Text size={12} tone="muted" style={{ typography: { size: 12, lineHeight: 1.45 } }}>
              {explainer}
            </Text>
          </Stack>
        </Row>
      </ManagementGlassCard>

      <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
        <Row align="center" justify="between" wrap gapPx={6}>
          <Text size={11.5} weight={700} tone="muted">
            {`AVAILABLE DRIVERS FOR ${brand.title.toUpperCase()}`}
          </Text>
          <Text size={11} tone="muted">
            Ranked by stability &amp; community trust
          </Text>
        </Row>

        {drivers.map((driver, index) => {
          const medal = formatStabilityMedal(
            driver.stabilityTier,
            driver.trustScore,
            driver.verified,
          );
          const rtLabel = runtimeLabel(driver.runtime);
          const isTop = index === 0;
          return (
            <ManagementGlassCard
              key={driver.id}
              id={`brand-driver-${driver.id}`}
              radius={18}
              padding={insets(13, 15)}
              interactive
              style={{ layout: { width: pct(100) } }}
            >
              <Row
                align="center"
                justify="between"
                gapPx={14}
                style={{ layout: { width: pct(100) } }}
              >
                <Row
                  align="center"
                  gapPx={12}
                  style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(0) } }}
                >
                  <BrandIcon
                    kind={runtimeIconKind(driver.runtime)}
                    id={driver.iconId ?? driver.packageName ?? driver.appId ?? driver.id}
                    size={40}
                    hint={{ name: driver.title }}
                  />
                  <Stack
                    gapPx={4}
                    style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(0) } }}
                  >
                    <Row align="center" gapPx={6} wrap>
                      <ManagementStatusPill
                        label={isTop ? '#1 Top' : `#${index + 1}`}
                        tone={isTop ? 'success' : 'neutral'}
                      />
                      <Text size={13.5} weight={600}>
                        {driver.title}
                      </Text>
                      <ManagementStatusPill label={rtLabel} tone="neutral" />
                      <ManagementStatusPill label={medal.shortLabel} tone={medalTone(medal.tier)} />
                      {driver.installed && (
                        <ManagementStatusPill label="Installed" tone="success" />
                      )}
                    </Row>
                    <Text
                      size={12}
                      tone="muted"
                      style={{ typography: { size: 12, lineHeight: 1.4 } }}
                    >
                      {driver.description ??
                        `Official ${rtLabel} integration (${driver.packageName ?? driver.id}).`}
                    </Text>
                  </Stack>
                </Row>

                <HausButton
                  id={`brand-driver-launch-${driver.id}`}
                  variant={isTop ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={busy}
                  style={{ layout: { flexShrink: 0 } }}
                  onPress={() => onLaunchDriver(driver)}
                >
                  <UiIcon name="settings-2" size={13} color={isTop ? primaryFg : undefined} />
                  <Text
                    size={12}
                    style={
                      isTop
                        ? { typography: { color: colorToken('accentForeground'), weight: 600 } }
                        : undefined
                    }
                  >
                    {driver.runtime && driver.runtime !== 'ha' && !driver.installed
                      ? 'Install & set up'
                      : 'Set up'}
                  </Text>
                </HausButton>
              </Row>
            </ManagementGlassCard>
          );
        })}
      </Stack>
    </Stack>
  );
}
