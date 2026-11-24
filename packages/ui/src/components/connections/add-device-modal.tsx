/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  filterIntegrationChoices,
  type IntegrationCatalogChoice,
  type OnboardingDiscoveredFlow,
} from '@haus/core/transport';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  Pressable,
  Row,
  ScrollView,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface AddDeviceModalProps {
  readonly query: string;
  readonly discovered: readonly OnboardingDiscoveredFlow[];
  readonly catalog: readonly IntegrationCatalogChoice[];
  readonly loading?: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onRescan: () => void;
  readonly onSelectDiscovered: (item: OnboardingDiscoveredFlow) => void;
  readonly onSelectCatalog: (item: IntegrationCatalogChoice) => void;
  readonly onChooseCode: () => void;
  readonly onChooseBrowse: () => void;
  readonly onChooseApps: () => void;
  readonly onClose: () => void;
}

function SetupPathRow({
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
    <Pressable
      id={id}
      onActivate={onPress}
      style={{
        layout: {
          direction: 'row',
          alignItems: 'center',
          justifyContent: 'between',
          gap: px(12),
          width: pct(100),
          padding: insets(12, 14),
        },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('border') },
        corners: corners(14),
        states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
      }}
    >
      <Row align="center" gapPx={12} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
        <Box
          style={{
            layout: { width: px(36), height: px(36), alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
            material: new SolidMaterial(colorToken('surface')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(10),
          }}
        >
          <UiIcon name={icon} size={17} />
        </Box>
        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Text size={13} weight={600}>
            {title}
          </Text>
          <Text size={11.5} tone="muted">
            {subtitle}
          </Text>
        </Stack>
      </Row>
      <UiIcon name="chevron-right" size={16} />
    </Pressable>
  );
}

export function AddDeviceModal({
  query,
  discovered,
  catalog,
  loading = false,
  onQueryChange,
  onRescan,
  onSelectDiscovered,
  onSelectCatalog,
  onChooseCode,
  onChooseBrowse,
  onChooseApps,
  onClose,
}: AddDeviceModalProps) {
  const searching = query.trim().length > 0;
  const filteredCatalog = searching ? filterIntegrationChoices(catalog, query) : [];

  return (
    <HausDialog
      size="lg"
      title="What are we adding?"
      subtitle="Set up a nearby discovered device, pair with a code, or search integrations."
      scrollable
      onClose={onClose}
    >
      <Stack gapPx={16} style={{ layout: { width: pct(100) } }}>
        <Row align="center" gapPx={10} style={{ layout: { width: pct(100) } }}>
          <Row
            align="center"
            gapPx={8}
            style={{
              layout: { flexGrow: 1, minWidth: px(180), minHeight: px(38), padding: insets(0, 12) },
              material: new SolidMaterial(colorToken('surfaceSecondary')),
              border: { width: 1, color: colorToken('border') },
              corners: corners(12),
            }}
          >
            <UiIcon name="search" size={16} />
            <TextInput
              id="add-device-search"
              ariaLabel="Search integrations"
              placeholder={
                catalog.length > 0
                  ? `Search ${catalog.length} brands & integrations (Hue, Matter, Tuya)…`
                  : 'Search brands & integrations…'
              }
              value={query}
              onChange={onQueryChange}
              style={{
                layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
                typography: { size: 13, color: colorToken('textPrimary') },
              }}
            />
            {searching && (
              <Pressable
                id="add-device-search-clear"
                ariaLabel="Clear search"
                onActivate={() => onQueryChange('')}
                style={{ layout: { padding: insets(4) }, corners: corners(8) }}
              >
                <UiIcon name="x" size={14} />
              </Pressable>
            )}
          </Row>
          {catalog.length > 0 && (
            <Box
              style={{
                layout: { padding: insets(6, 10) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(999),
              }}
            >
              <Text size={11.5} mono tone="muted">
                {searching ? `${filteredCatalog.length} / ${catalog.length}` : String(catalog.length)}
              </Text>
            </Box>
          )}
        </Row>

        {searching ? (
          <ScrollView style={{ layout: { width: pct(100), maxHeight: px(360) } }}>
            <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
              {filteredCatalog.length > 0 ? (
                filteredCatalog.map((item) => (
                  <Row
                    key={item.domain}
                    align="center"
                    justify="between"
                    gapPx={12}
                    style={{
                      layout: { width: pct(100), padding: insets(10, 14) },
                      material: new SolidMaterial(colorToken('surfaceSecondary')),
                      border: { width: 1, color: colorToken('border') },
                      corners: corners(12),
                    }}
                  >
                    <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                      <Text size={13} weight={600}>
                        {item.title}
                      </Text>
                      <Text size={11.5} tone="muted">
                        {item.subtitle ?? item.domain}
                      </Text>
                    </Stack>
                    <HausButton
                      id={`add-device-choice-${item.domain}`}
                      variant="secondary"
                      size="sm"
                      onPress={() => onSelectCatalog(item)}
                    >
                      <Text size={12}>Set up</Text>
                    </HausButton>
                  </Row>
                ))
              ) : (
                <Box
                  style={{
                    layout: { width: pct(100), padding: insets(18) },
                    material: new SolidMaterial(colorToken('surfaceSecondary')),
                    border: { width: 1, color: colorToken('border') },
                    corners: corners(12),
                  }}
                >
                  <Text size={12.5} tone="muted">
                    No matching integrations found. Try another brand or protocol name.
                  </Text>
                </Box>
              )}
            </Stack>
          </ScrollView>
        ) : (
          <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
            <Stack
              gapPx={12}
              style={{
                layout: { width: pct(100), padding: insets(14) },
                material: new SolidMaterial(colorToken('surfaceSecondary')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(16),
              }}
            >
              <Row align="center" justify="between" gapPx={10} style={{ layout: { width: pct(100) } }}>
                <Row align="center" gapPx={8}>
                  <UiIcon name="radar" size={16} />
                  <Text size={13.5} weight={600}>
                    Discovered nearby
                  </Text>
                  <Box
                    style={{
                      layout: { padding: insets(2, 8) },
                      material: new SolidMaterial(rgba(52, 211, 153, 0.14)),
                      border: { width: 1, color: rgba(52, 211, 153, 0.36) },
                      corners: corners(999),
                    }}
                  >
                    <Text size={11} mono weight={600}>
                      {String(discovered.length)}
                    </Text>
                  </Box>
                </Row>
                <HausButton
                  id="add-device-rescan"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onPress={onRescan}
                >
                  <UiIcon name="refresh-cw" size={13} />
                  <Text size={12}>{loading ? 'Scanning…' : 'Rescan'}</Text>
                </HausButton>
              </Row>

              {discovered.length > 0 ? (
                <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
                  {discovered.map((item) => (
                    <Row
                      key={item.flowId}
                      align="center"
                      justify="between"
                      gapPx={12}
                      style={{
                        layout: { width: pct(100), padding: insets(10, 12) },
                        material: new SolidMaterial(colorToken('surface')),
                        border: { width: 1, color: colorToken('border') },
                        corners: corners(12),
                      }}
                    >
                      <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                        <Row align="center" gapPx={8} wrap>
                          <Text size={13} weight={600}>
                            {item.label}
                          </Text>
                          <Box
                            style={{
                              layout: { padding: insets(2, 7) },
                              material: new SolidMaterial(colorToken('surfaceSecondary')),
                              border: { width: 1, color: colorToken('border') },
                              corners: corners(999),
                            }}
                          >
                            <Text size={10.5} weight={600} tone="muted">
                              {item.sourceLabel}
                            </Text>
                          </Box>
                        </Row>
                        <Text size={11.5} tone="muted">
                          {item.title}
                        </Text>
                      </Stack>
                      <HausButton
                        id={`add-device-discovered-${item.flowId}`}
                        variant="secondary"
                        size="sm"
                        onPress={() => onSelectDiscovered(item)}
                      >
                        <Text size={12}>Set up</Text>
                      </HausButton>
                    </Row>
                  ))}
                </Stack>
              ) : (
                <Text size={12} tone="muted">
                  {loading
                    ? 'Listening for Matter, HomeKit, mDNS, and Bluetooth devices nearby…'
                    : 'Power on any Matter, HomeKit, mDNS, or MQTT device nearby, or choose a setup method below.'}
                </Text>
              )}
            </Stack>

            <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
              <SetupPathRow
                id="add-device-path-code"
                icon="qr-code"
                title="Set up with code"
                subtitle="Matter QR, HomeKit PIN, Improv, or vendor code"
                onPress={onChooseCode}
              />
              <SetupPathRow
                id="add-device-path-browse"
                icon="cable"
                title="Browse all integrations"
                subtitle={
                  catalog.length > 0
                    ? `Explore ${catalog.length} bridges, hubs, and ecosystems`
                    : 'Bridges, hubs, and ecosystems'
                }
                onPress={onChooseBrowse}
              />
              <SetupPathRow
                id="add-device-path-apps"
                icon="box"
                title="Apps & bridges"
                subtitle="Cameras, NVR, Homebridge, and managed add-on services"
                onPress={onChooseApps}
              />
            </Stack>
          </Stack>
        )}
      </Stack>
    </HausDialog>
  );
}
