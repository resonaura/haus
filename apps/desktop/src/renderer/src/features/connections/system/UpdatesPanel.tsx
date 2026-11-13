/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import {
  ArrowLeft,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { BrandIcon } from '../../../components/brand/BrandIcon';
import { nativeApi } from '../../../ha/management';
import { formatCategoryBadge, type UnifiedUpdateItem, type UnifiedUpdatesResponse } from './types';

type FilterKind = 'available' | 'all' | 'core_addon' | 'hacs' | 'bridges';

function matchesFilter(item: UnifiedUpdateItem, filter: FilterKind): boolean {
  if (filter === 'available') return item.updateAvailable;
  if (filter === 'core_addon') return item.category === 'core' || item.category === 'addon';
  if (filter === 'hacs') return item.category === 'hacs' || item.category === 'integration';
  if (filter === 'bridges') {
    return (
      item.category === 'homebridge' || item.category === 'scrypted' || item.category === 'plugin'
    );
  }
  return true;
}

export function UpdatesPanel({
  updates,
  checking,
  installingId,
  onBack,
  onCheck,
  onInstall,
}: {
  updates: UnifiedUpdatesResponse | null;
  checking: boolean;
  installingId: string | null;
  onBack: () => void;
  onCheck: () => Promise<void>;
  onInstall: (item: UnifiedUpdateItem) => Promise<void>;
}) {
  const [filter, setFilter] = useState<FilterKind>(() =>
    (updates?.availableCount ?? 0) > 0 ? 'available' : 'all',
  );
  const items = updates?.items ?? [];
  const availableCount = items.filter((i) => i.updateAvailable).length;
  const visible = items.filter((item) => matchesFilter(item, filter));

  return (
    <section className="connection-detail-page" aria-label="Updates">
      <div className="system-panel-topbar">
        <Button variant="ghost" className="connection-back" onPress={onBack}>
          <ArrowLeft size={17} />
          Back
        </Button>
        <Button size="sm" variant="secondary" isDisabled={checking} onPress={() => void onCheck()}>
          {checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
      </div>

      <header className="management-page-head">
        <div>
          <h2>Updates</h2>
          <p>
            Manage updates across Core, HACS custom integrations, Apps, Homebridge, and Scrypted
            plugins.
          </p>
        </div>
      </header>

      <div className="system-filter-pills" role="tablist" aria-label="Update category filter">
        {(
          [
            ['available', `Available (${availableCount})`],
            ['all', `All (${items.length})`],
            ['core_addon', 'Core & Add-ons'],
            ['hacs', 'Integrations & HACS'],
            ['bridges', 'Homebridge & Scrypted'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={`system-filter-pill ${filter === id ? 'is-active' : ''}`}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="management-empty">
          <CheckCircle2 size={32} />
          <h3>{filter === 'available' ? 'Everything is up to date' : 'No matching items'}</h3>
          <p>
            {filter === 'available'
              ? 'No pending updates were found across your installed integrations and plugins.'
              : 'Run Check for updates or switch filters to inspect installed versions.'}
          </p>
        </div>
      ) : (
        <div className="system-list">
          {visible.map((item) => {
            const busy = installingId === item.id || item.inProgress;
            return (
              <article key={item.id} className="system-item-card">
                <span className="integration-logo">
                  {item.category === 'core' ? (
                    <ArrowUpCircle size={22} />
                  ) : (
                    <BrandIcon kind="integration" id={item.domain} />
                  )}
                </span>
                <div className="system-item-copy">
                  <div className="system-item-title-row">
                    <h3>{item.title}</h3>
                    <span className="integration-badge">{formatCategoryBadge(item.category)}</span>
                    {item.updateAvailable && <span className="update-pill">Update available</span>}
                  </div>
                  <p>
                    {item.updateAvailable
                      ? `${item.installedVersion} → ${item.latestVersion}`
                      : `Version ${item.installedVersion}`}
                  </p>
                  {item.releaseSummary && <small>{item.releaseSummary}</small>}
                </div>
                <div className="system-item-actions">
                  {item.releaseUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        void nativeApi()
                          .openExternal(item.releaseUrl!)
                          .catch(() => {})
                      }
                    >
                      Release notes
                      <ExternalLink size={13} />
                    </Button>
                  )}
                  {item.updateAvailable && item.canInstall && (
                    <Button
                      size="sm"
                      className="flow-next-pill"
                      isPending={busy}
                      isDisabled={Boolean(installingId)}
                      onPress={() => void onInstall(item)}
                    >
                      {busy ? 'Updating…' : 'Update'}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
