/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useDeferredValue } from 'react';
import {
  filterBrandIntegrationCatalog,
  filterIntegrationChoices,
  formatStabilityMedal,
  type BrandCatalogItem,
  type IntegrationCatalogChoice,
  type OnboardingDiscoveredFlow,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  Row,
  ScrollView,
  Stack,
  Text,
} from '../../primitives/index.js';
import {
  BrandIcon,
  ManagementEmptyCard,
  ManagementGlassCard,
  ManagementSearchBar,
  ManagementStatusPill,
} from '../brand/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';
import { DiscoveryRadarPanel } from './discovery-radar.js';

export interface AddDeviceModalProps {
  readonly query: string;
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly brandCatalog?: readonly BrandCatalogItem[];
  readonly loading?: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onRescan: () => void;
  readonly onSelectDiscovered: (item: OnboardingDiscoveredFlow) => void;
  readonly onSelectCatalog: (item: IntegrationCatalogChoice) => void;
  readonly onSelectBrand?: (item: BrandCatalogItem) => void;
  readonly onChooseCode: () => void;
  readonly onChooseCamera?: () => void;
  readonly onChooseBrowse: () => void;
  readonly onChooseApps: () => void;
  readonly onClose: () => void;
}

function SetupPathCard({
  id,
  icon,
  title,
  subtitle,
  onPress,
}: {
  readonly id: string;
  readonly icon: UiIconName;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
}) {
  return (
    <ManagementGlassCard
      id={id}
      radius={18}
      padding={insets(12, 14)}
      interactive
      onPress={onPress}
      style={{ layout: { flexGrow: 1, flexShrink: 1, minWidth: px(210) } }}
    >
      <Row align="center" justify="between" gapPx={12} style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Box
            style={{
              layout: {
                width: px(36),
                height: px(36),
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              },
              material: new SolidMaterial(colorToken('surface')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(11),
            }}
          >
            <UiIcon name={icon} size={17} />
          </Box>
          <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
            <Text size={13} weight={600}>
              {title}
            </Text>
            <Text size={11.5} tone="muted" style={{ typography: { size: 11.5, lineHeight: 1.35 } }}>
              {subtitle}
            </Text>
          </Stack>
        </Row>
        <UiIcon name="chevron-right" size={15} />
      </Row>
    </ManagementGlassCard>
  );
}

/**
 * Shared Add Device modal matching Electron's Discovery Radar, quick device setup,
 * live integration search with brand icons, and setup-path glass cards.
 */
export const AddDeviceModal = memo(function AddDeviceModal({
  query,
  discovered,
  catalog,
  brandCatalog,
  loading = false,
  onQueryChange,
  onRescan,
  onSelectDiscovered,
  onSelectCatalog,
  onSelectBrand,
  onChooseCode,
  onChooseCamera,
  onChooseBrowse,
  onChooseApps,
  onClose,
}: AddDeviceModalProps) {
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;
  const useGrouped = Boolean(brandCatalog && brandCatalog.length > 0 && onSelectBrand);
  const filteredBrands =
    searching && useGrouped ? filterBrandIntegrationCatalog(brandCatalog!, deferredQuery) : [];
  const filteredCatalog =
    searching && !useGrouped ? filterIntegrationChoices(catalog, deferredQuery) : [];
  const totalCount = useGrouped ? brandCatalog!.length : catalog.length;
  const matchCount = useGrouped ? filteredBrands.length : filteredCatalog.length;

  return (
    <HausDialog
      size="lg"
      eyebrow="ADD DEVICE"
      title="What are we adding?"
      subtitle="Set up a nearby discovered device, pair with a code, add a camera, or search all integrations."
      scrollable
      onClose={onClose}
    >
      <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
        <ManagementSearchBar
          id="add-device-search"
          ariaLabel="Search integrations"
          placeholder={
            totalCount > 0
              ? `Search ${totalCount.toLocaleString()} brands & integrations (Hue, Matter, Tuya)…`
              : 'Search brands & integrations…'
          }
          value={query}
          onChange={onQueryChange}
          countBadge={
            totalCount > 0
              ? searching
                ? `${matchCount.toLocaleString()} / ${totalCount.toLocaleString()}`
                : totalCount.toLocaleString()
              : undefined
          }
        />

        {searching ? (
          <ScrollView style={{ layout: { width: pct(100), maxHeight: px(380) } }}>
            <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
              {useGrouped ? (
                filteredBrands.length > 0 ? (
                  filteredBrands.slice(0, 24).map((item) => {
                    const drivers = item.groupItems ?? [item];
                    const multi = drivers.length > 1 || Boolean(item.isCombinedHausGovee);
                    const medal = formatStabilityMedal(
                      item.stabilityTier,
                      item.trustScore,
                      item.verified,
                    );
                    return (
                      <ManagementGlassCard
                        key={item.id}
                        id={`add-device-brand-${item.id}`}
                        radius={16}
                        padding={insets(10, 14)}
                        interactive
                        rim={false}
                        onPress={() => onSelectBrand?.(item)}
                        style={{ layout: { width: pct(100) } }}
                      >
                        <Row
                          align="center"
                          justify="between"
                          gapPx={12}
                          style={{ layout: { width: pct(100) } }}
                        >
                          <Row
                            align="center"
                            gapPx={12}
                            style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                          >
                            <BrandIcon
                              kind={
                                item.runtime === 'hacs' ||
                                item.runtime === 'homebridge' ||
                                item.runtime === 'scrypted'
                                  ? item.runtime
                                  : item.runtime === 'docker'
                                    ? 'app'
                                    : 'integration'
                              }
                              id={item.iconId ?? item.id}
                              size={40}
                              hint={{ name: item.title }}
                            />
                            <Stack gapPx={3} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                              <Row align="center" gapPx={7} wrap>
                                <Text size={13.5} weight={600}>
                                  {item.title}
                                </Text>
                                {multi && (
                                  <ManagementStatusPill
                                    label={`${drivers.length} drivers`}
                                    tone="accent"
                                  />
                                )}
                                <ManagementStatusPill
                                  label={medal.shortLabel}
                                  tone={medal.tier === 'gold' ? 'success' : 'neutral'}
                                />
                              </Row>
                              <Text size={11.5} tone="muted">
                                {item.description ?? item.domain ?? item.id}
                              </Text>
                            </Stack>
                          </Row>
                          <HausButton
                            id={`add-device-choice-${item.id}`}
                            variant="secondary"
                            size="sm"
                            onPress={() => onSelectBrand?.(item)}
                          >
                            <Text size={12}>{multi ? 'Choose driver' : 'Set up'}</Text>
                          </HausButton>
                        </Row>
                      </ManagementGlassCard>
                    );
                  })
                ) : (
                  <ManagementEmptyCard
                    icon="search"
                    title="No matching integrations"
                    subtitle="Try another brand, ecosystem, or protocol name."
                  />
                )
              ) : filteredCatalog.length > 0 ? (
                filteredCatalog.map((item) => (
                  <ManagementGlassCard
                    key={item.domain}
                    radius={16}
                    padding={insets(10, 14)}
                    interactive
                    style={{ layout: { width: pct(100) } }}
                  >
                    <Row
                      align="center"
                      justify="between"
                      gapPx={12}
                      style={{ layout: { width: pct(100) } }}
                    >
                      <Row
                        align="center"
                        gapPx={12}
                        style={{ layout: { flexGrow: 1, minWidth: px(0) } }}
                      >
                        <BrandIcon
                          kind="integration"
                          id={item.domain}
                          size={40}
                          hint={{ name: item.title, category: item.category }}
                        />
                        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                          <Row align="center" gapPx={7} wrap>
                            <Text size={13} weight={600}>
                              {item.title}
                            </Text>
                            {item.category && (
                              <ManagementStatusPill label={item.category} tone="neutral" />
                            )}
                          </Row>
                          <Text size={11.5} tone="muted">
                            {item.subtitle ?? item.domain}
                          </Text>
                        </Stack>
                      </Row>
                      <HausButton
                        id={`add-device-choice-${item.domain}`}
                        variant="secondary"
                        size="sm"
                        onPress={() => onSelectCatalog(item)}
                      >
                        <Text size={12}>Set up</Text>
                      </HausButton>
                    </Row>
                  </ManagementGlassCard>
                ))
              ) : (
                <ManagementEmptyCard
                  icon="search"
                  title="No matching integrations"
                  subtitle="Try another brand, ecosystem, or protocol name."
                />
              )}
            </Stack>
          </ScrollView>
        ) : (
          <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
            <DiscoveryRadarPanel
              discovered={discovered}
              loading={loading}
              onRescan={onRescan}
              onSelectDiscovered={onSelectDiscovered}
            />

            <Row gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
              <SetupPathCard
                id="add-device-path-code"
                icon="qr-code"
                title="Set up with code"
                subtitle="Matter QR, HomeKit PIN, Improv, or vendor code"
                onPress={onChooseCode}
              />
              {onChooseCamera && (
                <SetupPathCard
                  id="add-device-path-camera"
                  icon="camera"
                  title="Camera"
                  subtitle="Live video, RTSP/ONVIF, Tuya, Aqara & NVR"
                  onPress={onChooseCamera}
                />
              )}
              <SetupPathCard
                id="add-device-path-browse"
                icon="cable"
                title="Browse all integrations"
                subtitle={
                  totalCount > 0
                    ? `Explore ${totalCount.toLocaleString()} bridges, hubs & ecosystems`
                    : 'Bridges, hubs, and ecosystems'
                }
                onPress={onChooseBrowse}
              />
              <SetupPathCard
                id="add-device-path-apps"
                icon="box"
                title="Apps & bridges"
                subtitle="Cameras, NVR, Homebridge & managed services"
                onPress={onChooseApps}
              />
            </Row>
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
});
