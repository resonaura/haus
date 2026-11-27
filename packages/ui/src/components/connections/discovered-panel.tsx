/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { humanizeIdentifier } from '@haus/core/transport';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box, HausButton, Heading, Row, Stack, Text } from '../../primitives/index.js';
import {
  BrandIcon,
  ManagementEmptyCard,
  ManagementGlassCard,
  ManagementStatusPill,
} from '../brand/index.js';
import { DashboardGrid } from '../home.js';

const DISCOVERY_SOURCES = new Set([
  'zeroconf',
  'ssdp',
  'dhcp',
  'bluetooth',
  'usb',
  'mqtt',
  'homekit',
  'matter',
  'discovery',
  'hassio',
  'hardware',
  'integration_discovery',
]);

const DISCOVERY_SOURCE_LABELS: Readonly<Record<string, string>> = {
  zeroconf: 'mDNS / Zeroconf',
  ssdp: 'UPnP / SSDP',
  dhcp: 'LAN / DHCP',
  mqtt: 'MQTT',
  homekit: 'HomeKit',
  bluetooth: 'Bluetooth',
  usb: 'USB',
  matter: 'Matter',
  discovery: 'Network discovery',
  integration_discovery: 'Integration discovery',
};

export interface PortableDiscoveredFlow {
  readonly flowId: string;
  readonly handler: string;
  readonly integrationTitle: string;
  readonly deviceLabel: string;
  readonly source?: string;
  readonly sourceLabel?: string;
}

export function isDiscoveredFlowSource(source?: string): boolean {
  const normalized = source?.trim().toLowerCase() ?? '';
  if (normalized === 'reauth' || normalized === 'reconfigure' || normalized === 'user') {
    return false;
  }
  return !normalized || DISCOVERY_SOURCES.has(normalized);
}

export function formatDiscoverySourceLabel(source?: string): string {
  const key = source?.trim().toLowerCase() ?? '';
  return DISCOVERY_SOURCE_LABELS[key] ?? (source ? humanizeIdentifier(source) : 'Discovered');
}

export function filterPortableDiscoveredFlows(
  items: readonly PortableDiscoveredFlow[],
  query: string,
): PortableDiscoveredFlow[] {
  const term = query.trim().toLowerCase();
  return items.filter((item) => {
    if (!isDiscoveredFlowSource(item.source)) return false;
    if (!term) return true;
    const sourceText = (item.sourceLabel ?? formatDiscoverySourceLabel(item.source)).toLowerCase();
    return (
      item.handler.toLowerCase().includes(term) ||
      item.integrationTitle.toLowerCase().includes(term) ||
      item.deviceLabel.toLowerCase().includes(term) ||
      sourceText.includes(term)
    );
  });
}

/**
 * Shared Electron-matched Discovered devices section with refined monochrome glass
 * cards (`<GlassRim />`), `<BrandIcon />`, discovery source pills, and quick `Configure` / `Ignore`.
 */
export function DiscoveredIntegrationsPanel({
  items,
  columns = 3,
  busy = false,
  emptyWhenShown = false,
  onConfigure,
  onIgnore,
}: {
  readonly items: readonly PortableDiscoveredFlow[];
  readonly columns?: number;
  readonly busy?: boolean;
  readonly emptyWhenShown?: boolean;
  readonly onConfigure: (item: PortableDiscoveredFlow) => void;
  readonly onIgnore?: (item: PortableDiscoveredFlow) => void;
}) {
  if (items.length === 0) {
    if (!emptyWhenShown) return null;
    return (
      <ManagementEmptyCard
        icon="radar"
        title="No discovered devices waiting"
        subtitle="Devices announcing via mDNS, SSDP, DHCP, HomeKit, Matter, or MQTT appear here when ready to configure."
      />
    );
  }

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100), flexShrink: 0 } }}>
      <Row align="center" gapPx={8}>
        <Heading level={3} size={15} weight={600}>
          Discovered
        </Heading>
        <Box
          style={{
            layout: { padding: insets(2, 8), alignItems: 'center', justifyContent: 'center' },
            material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.08)),
            border: { width: 1, color: colorToken('border') },
            corners: corners(999),
          }}
        >
          <Text size={11} mono weight={600} tone="muted">
            {String(items.length)}
          </Text>
        </Box>
      </Row>

      <DashboardGrid columns={Math.max(1, Math.min(columns, 3))}>
        {items.map((item) => {
          const sourceLabel = item.sourceLabel ?? formatDiscoverySourceLabel(item.source);
          return (
            <ManagementGlassCard
              key={item.flowId}
              id={`discovered-card-${item.flowId}`}
              radius={22}
              padding={insets(16, 18)}
              interactive
              style={{
                layout: {
                  width: pct(100),
                  minHeight: px(134),
                  gap: px(14),
                  justifyContent: 'between',
                },
              }}
            >
              <Row align="center" gapPx={12} style={{ layout: { width: pct(100) } }}>
                <BrandIcon
                  kind="integration"
                  id={item.handler}
                  size={46}
                  hint={{ name: item.integrationTitle }}
                />
                <Stack gapPx={4} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                  <Row align="center" gapPx={7} wrap>
                    <Text
                      size={14}
                      weight={600}
                      style={{ typography: { size: 14, weight: 600, maxLines: 1, truncate: true } }}
                    >
                      {item.integrationTitle}
                    </Text>
                    <ManagementStatusPill label={sourceLabel} tone="neutral" />
                  </Row>
                  <Text
                    size={12}
                    tone="muted"
                    style={{ typography: { size: 12, maxLines: 1, truncate: true } }}
                  >
                    {item.deviceLabel}
                  </Text>
                </Stack>
              </Row>

              <Row align="center" justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
                {onIgnore && (
                  <HausButton
                    id={`discovered-ignore-${item.flowId}`}
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onPress={() => onIgnore(item)}
                  >
                    <Text size={12} tone="muted">
                      Ignore
                    </Text>
                  </HausButton>
                )}
                <HausButton
                  id={`discovered-configure-${item.flowId}`}
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onPress={() => onConfigure(item)}
                >
                  <Text
                    size={12}
                    style={{
                      typography: { size: 12, weight: 600, color: colorToken('accentForeground') },
                    }}
                  >
                    Configure
                  </Text>
                </HausButton>
              </Row>
            </ManagementGlassCard>
          );
        })}
      </DashboardGrid>
    </Stack>
  );
}
