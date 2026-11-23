/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo } from 'react';
import { Box, HausButton, Heading, Text } from '@haus/ui';
import { Radar } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, type FlowProgress } from '../../../ha/management';

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

const SOURCE_LABELS: Record<string, string> = {
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

export function isDiscoveredFlowProgress(item: FlowProgress): boolean {
  const source = item.context?.source?.toLowerCase() ?? '';
  if (source === 'reauth' || source === 'reconfigure' || source === 'user') return false;
  return !source || DISCOVERY_SOURCES.has(source);
}

export function formatDiscoverySourceLabel(source?: string): string {
  const key = source?.toLowerCase() ?? '';
  return SOURCE_LABELS[key] ?? (source ? humanize(source) : 'Discovered');
}

export function filterDiscoveredProgress(
  progress: readonly FlowProgress[],
  query: string,
  formatDomain: (domain: string) => string = (domain) => domain,
): FlowProgress[] {
  const term = query.trim().toLowerCase();
  return progress.filter((item) => {
    if (!isDiscoveredFlowProgress(item)) return false;
    if (!term) return true;
    const handler = item.handler.toLowerCase();
    const display = formatDomain(item.handler).toLowerCase();
    const title = (item.context?.title_placeholders?.name ?? '').toLowerCase();
    const source = (item.context?.source ?? '').toLowerCase();
    return (
      handler.includes(term) ||
      display.includes(term) ||
      title.includes(term) ||
      source.includes(term)
    );
  });
}

export const DiscoveredPanel = memo(function DiscoveredPanel({
  items,
  formatDomain = (domain) => domain,
  busy,
  emptyWhenShown = false,
  onConfigure,
  onIgnore,
}: {
  items: readonly FlowProgress[];
  formatDomain?: (domain: string) => string;
  busy: boolean;
  emptyWhenShown?: boolean;
  onConfigure: (item: FlowProgress) => void;
  onIgnore: (item: FlowProgress) => void;
}) {
  if (items.length === 0) {
    if (!emptyWhenShown) return null;
    return (
      <Box semantic="section" className="discovered-section" ariaLabel="Discovered devices">
        <Box className="management-empty">
          <Radar size={30} />
          <Heading level={3}>No discovered devices waiting</Heading>
          <Text semantic="p">
            Devices announcing via mDNS, SSDP, DHCP, HomeKit, or MQTT appear here when ready to
            configure.
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box semantic="section" className="discovered-section" ariaLabel="Discovered devices">
      <Box className="discovered-head">
        <Heading level={3}>Discovered</Heading>
        <Text>{items.length}</Text>
      </Box>
      <Box className="discovered-grid">
        {items.map((item) => {
          const integrationTitle = formatDomain(item.handler);
          const deviceLabel = item.context?.title_placeholders?.name || integrationTitle;
          const sourceLabel = formatDiscoverySourceLabel(item.context?.source);
          return (
            <Box semantic="article" key={item.flow_id} className="discovered-card">
              <Box className="discovered-card-main">
                <Text className="integration-logo">
                  <BrandIcon
                    kind="integration"
                    id={item.handler}
                    hint={
                      item.context?.title_placeholders?.name
                        ? { name: item.context.title_placeholders.name }
                        : undefined
                    }
                  />
                </Text>
                <Box className="discovered-card-copy">
                  <Box className="discovered-card-title-row">
                    <Text semantic="strong">{integrationTitle}</Text>
                    <Text className="discovered-source-pill">{sourceLabel}</Text>
                  </Box>
                  <Text semantic="p">{deviceLabel}</Text>
                </Box>
              </Box>
              <Box className="discovered-card-actions">
                <HausButton
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => onIgnore(item)}
                >
                  Ignore
                </HausButton>
                <HausButton size="sm" isDisabled={busy} onPress={() => onConfigure(item)}>
                  Configure
                </HausButton>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});
