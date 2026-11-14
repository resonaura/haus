/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
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
  formatDomain: (domain: string) => string = humanize,
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

export function DiscoveredPanel({
  items,
  formatDomain = humanize,
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
      <section className="discovered-section" aria-label="Discovered devices">
        <div className="management-empty">
          <Radar size={30} />
          <h3>No discovered devices waiting</h3>
          <p>
            Devices announcing via mDNS, SSDP, DHCP, HomeKit, or MQTT appear here when ready to
            configure.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="discovered-section" aria-label="Discovered devices">
      <div className="discovered-head">
        <h3>Discovered</h3>
        <span>{items.length}</span>
      </div>
      <div className="discovered-grid">
        {items.map((item) => {
          const integrationTitle = formatDomain(item.handler);
          const deviceLabel = item.context?.title_placeholders?.name || integrationTitle;
          const sourceLabel = formatDiscoverySourceLabel(item.context?.source);
          return (
            <article key={item.flow_id} className="discovered-card">
              <div className="discovered-card-main">
                <span className="integration-logo">
                  <BrandIcon
                    kind="integration"
                    id={item.handler}
                    hint={
                      item.context?.title_placeholders?.name
                        ? { name: item.context.title_placeholders.name }
                        : undefined
                    }
                  />
                </span>
                <div className="discovered-card-copy">
                  <div className="discovered-card-title-row">
                    <strong>{integrationTitle}</strong>
                    <span className="discovered-source-pill">{sourceLabel}</span>
                  </div>
                  <p>{deviceLabel}</p>
                </div>
              </div>
              <div className="discovered-card-actions">
                <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => onIgnore(item)}>
                  Ignore
                </Button>
                <Button size="sm" isDisabled={busy} onPress={() => onConfigure(item)}>
                  Configure
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
