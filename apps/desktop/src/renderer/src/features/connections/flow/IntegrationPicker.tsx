/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ChevronRight, Search } from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { humanize, type FlowProgress } from '../../../ha/management';

export function IntegrationPicker({
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
      {!!discovered.length && !query && (
        <section className="flow-discovered">
          <h3>Discovered &amp; ready to set up</h3>
          {discovered.map((item) => (
            <button key={item.flow_id} onClick={() => onResumeDiscovered(item.flow_id)}>
              <BrandIcon
                kind="integration"
                id={item.handler}
                size={35}
                hint={{
                  name:
                    item.context?.title_placeholders?.name ??
                    names[`component.${item.handler}.title`] ??
                    humanize(item.handler),
                  ...(item.context?.source ? { category: item.context.source } : {}),
                }}
              />
              <span>
                {item.context?.title_placeholders?.name ??
                  names[`component.${item.handler}.title`] ??
                  humanize(item.handler)}
              </span>
              <small>{item.context?.source ?? 'Discovered'}</small>
              <ChevronRight size={15} />
            </button>
          ))}
        </section>
      )}
      <div className="integration-picker">
        {handlers
          .filter((id) =>
            `${id} ${names[`component.${id}.title`] ?? ''}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .slice(0, query ? 100 : 40)
          .map((id) => (
            <button key={id} disabled={busy} onClick={() => onStartDomain(id)}>
              <span className="integration-logo">
                <BrandIcon
                  kind="integration"
                  id={id}
                  size={35}
                  hint={{ name: names[`component.${id}.title`] ?? humanize(id) }}
                />
              </span>
              <span>{names[`component.${id}.title`] ?? humanize(id)}</span>
              <ChevronRight size={15} />
            </button>
          ))}
      </div>
      {handlers.length > 40 && !query && (
        <p className="management-hint">Search {handlers.length} available integrations.</p>
      )}
    </>
  );
}
