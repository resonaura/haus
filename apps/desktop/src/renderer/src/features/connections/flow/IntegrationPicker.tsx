/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useDeferredValue, useMemo } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import type { FlowProgress } from '../../../ha/management';

interface IndexedHandler {
  readonly id: string;
  readonly title: string;
  readonly searchText: string;
}

const PickerRow = memo(function PickerRow({
  id,
  title,
  busy,
  onStartDomain,
}: {
  id: string;
  title: string;
  busy: boolean;
  onStartDomain: (domain: string) => void;
}) {
  const hint = useMemo(() => ({ name: title }), [title]);
  return (
    <button disabled={busy} onClick={() => onStartDomain(id)}>
      <span className="integration-logo">
        <BrandIcon kind="integration" id={id} size={35} hint={hint} />
      </span>
      <span>{title}</span>
      <ChevronRight size={15} />
    </button>
  );
});

export const IntegrationPicker = memo(function IntegrationPicker({
  query,
  onQueryChange,
  discovered,
  handlers,
  names,
  busy,
  onResumeDiscovered,
  onStartDomain,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  discovered: readonly FlowProgress[];
  handlers: readonly string[];
  names: Readonly<Record<string, string>>;
  busy: boolean;
  onResumeDiscovered: (flowId: string) => void;
  onStartDomain: (domain: string) => void;
}) {
  const deferredQuery = useDeferredValue(query);

  const indexedHandlers = useMemo<IndexedHandler[]>(
    () =>
      handlers.map((id) => {
        const title = names[`component.${id}.title`] ?? id;
        return {
          id,
          title,
          searchText: `${id} ${title}`.toLowerCase(),
        };
      }),
    [handlers, names],
  );

  const visibleHandlers = useMemo(() => {
    const term = deferredQuery.trim().toLowerCase();
    const limit = term ? 100 : 40;
    if (!term) return indexedHandlers.slice(0, limit);
    const matched: IndexedHandler[] = [];
    for (const item of indexedHandlers) {
      if (item.searchText.includes(term)) {
        matched.push(item);
        if (matched.length >= limit) break;
      }
    }
    return matched;
  }, [indexedHandlers, deferredQuery]);

  return (
    <>
      <label className="management-search">
        <Search size={17} />
        <input
          aria-label="Find integration"
          placeholder="Find a brand or integration"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
      {!!discovered.length && !deferredQuery && (
        <section className="flow-discovered">
          <h3>Discovered &amp; ready to set up</h3>
          {discovered.map((item) => {
            const label =
              item.context?.title_placeholders?.name ??
              names[`component.${item.handler}.title`] ??
              item.handler;
            return (
              <button key={item.flow_id} onClick={() => onResumeDiscovered(item.flow_id)}>
                <BrandIcon
                  kind="integration"
                  id={item.handler}
                  size={35}
                  hint={{
                    name: label,
                    ...(item.context?.source ? { category: item.context.source } : {}),
                  }}
                />
                <span>{label}</span>
                <small>{item.context?.source ?? 'Discovered'}</small>
                <ChevronRight size={15} />
              </button>
            );
          })}
        </section>
      )}
      <div className="integration-picker">
        {visibleHandlers.map((item) => (
          <PickerRow
            key={item.id}
            id={item.id}
            title={item.title}
            busy={busy}
            onStartDomain={onStartDomain}
          />
        ))}
      </div>
      {handlers.length > 40 && !deferredQuery && (
        <p className="management-hint">Search {handlers.length} available integrations.</p>
      )}
    </>
  );
});
