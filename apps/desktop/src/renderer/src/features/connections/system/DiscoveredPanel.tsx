/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useMemo } from 'react';
import {
  DiscoveredIntegrationsPanel,
  formatDiscoverySourceLabel,
  isDiscoveredFlowSource,
  type PortableDiscoveredFlow,
} from '@haus/ui/components';
import type { FlowProgress } from '../../../ha/management';

export { formatDiscoverySourceLabel };

export function isDiscoveredFlowProgress(item: FlowProgress): boolean {
  return isDiscoveredFlowSource(item.context?.source);
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
  const byFlowId = useMemo(() => new Map(items.map((item) => [item.flow_id, item])), [items]);
  const portable = useMemo<PortableDiscoveredFlow[]>(
    () =>
      items.map((item) => {
        const integrationTitle = formatDomain(item.handler);
        return {
          flowId: item.flow_id,
          handler: item.handler,
          integrationTitle,
          deviceLabel: item.context?.title_placeholders?.name || integrationTitle,
          source: item.context?.source,
          sourceLabel: formatDiscoverySourceLabel(item.context?.source),
        };
      }),
    [formatDomain, items],
  );

  return (
    <DiscoveredIntegrationsPanel
      items={portable}
      busy={busy}
      emptyWhenShown={emptyWhenShown}
      onConfigure={(entry) => {
        const match = byFlowId.get(entry.flowId);
        if (match) onConfigure(match);
      }}
      onIgnore={(entry) => {
        const match = byFlowId.get(entry.flowId);
        if (match) onIgnore(match);
      }}
    />
  );
});
