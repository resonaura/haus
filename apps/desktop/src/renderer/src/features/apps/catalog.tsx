/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Box, Check, ChevronRight, Download, RefreshCw, Search } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { FeatureLoading } from '../../components/ui/Deferred';
import { EmptyState } from '../../components/ui/EmptyState';
import { appRequest } from './api';
import { parseCatalog, type CatalogAppSummary } from './catalog-api';
import { catalogIconKind } from './catalog-details';

const CatalogAppCard = memo(function CatalogAppCard({
  entry,
  admin,
  onSelectEntry,
  onManageApp,
}: {
  entry: CatalogAppSummary;
  admin: boolean;
  onSelectEntry: (entry: CatalogAppSummary) => void;
  onManageApp: (appId: string) => void;
}) {
  const hint = useMemo(
    () => ({
      name: entry.name,
      category: entry.category,
      ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
    }),
    [entry.name, entry.category, entry.repositoryUrl],
  );

  return (
    <article className="addon-card">
      <span className="addon-glyph">
        <BrandIcon kind={catalogIconKind(entry.runtimeType)} id={entry.id} size={44} hint={hint} />
      </span>
      <div className="addon-copy">
        <div>
          <h3>{entry.name}</h3>
          <div className="native-app-badges">
            <span className="status-pill">{entry.runtimeType}</span>
            {entry.installed && (
              <span className="status-pill">
                {entry.updateAvailable ? 'Update available' : 'Installed'}
              </span>
            )}
          </div>
        </div>
        <p>{entry.description || entry.category}</p>
        <small>
          Version {entry.latestVersion}
          {entry.author ? ` · ${entry.author}` : ''}
        </small>
      </div>
      <div className="addon-actions">
        {entry.installed ? (
          <Button variant="secondary" onPress={() => onManageApp(entry.id)}>
            <Check size={16} />
            Manage
            <ChevronRight size={15} />
          </Button>
        ) : (
          <Button variant={admin ? 'primary' : 'secondary'} onPress={() => onSelectEntry(entry)}>
            {admin ? <Download size={16} /> : null}
            {admin ? 'Install' : 'Details'}
            {!admin ? <ChevronRight size={15} /> : null}
          </Button>
        )}
      </div>
    </article>
  );
});

export const AppCatalogBrowser = memo(function AppCatalogBrowser({
  admin,
  onSelectEntry,
  onManageApp,
}: {
  admin: boolean;
  onSelectEntry: (entry: CatalogAppSummary) => void;
  onManageApp: (appId: string) => void;
}) {
  const [entries, setEntries] = useState<CatalogAppSummary[]>();
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const list = parseCatalog(await appRequest('GET', 'apps/catalog'));
      if (mounted.current && current === generation.current) {
        setEntries(list);
        setError('');
      }
    } catch (reason) {
      if (mounted.current && current === generation.current) {
        setError(reason instanceof Error ? reason.message : 'Could not load App catalog.');
      }
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [load]);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set((entries ?? []).map((item) => item.category))).sort()],
    [entries],
  );
  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase();
    return (entries ?? []).filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.name.toLocaleLowerCase().includes(q) ||
        item.id.toLocaleLowerCase().includes(q) ||
        (item.description ?? '').toLocaleLowerCase().includes(q) ||
        (item.author ?? '').toLocaleLowerCase().includes(q)
      );
    });
  }, [entries, category, deferredQuery]);

  return (
    <>
      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label="Search App catalog"
            placeholder="Search catalog Apps…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button variant="ghost" isDisabled={loading} onPress={() => void load()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </Button>
      </div>
      {categories.length > 1 && (
        <div className="filter-tabs" role="tablist" aria-label="App categories">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={category === cat}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!entries && loading && <FeatureLoading />}
      {entries && filtered.length === 0 && (
        <EmptyState
          icon={<Box />}
          title="No catalog Apps match"
          description="Try another search or category."
        />
      )}
      <div className="addon-list">
        {filtered.map((entry) => (
          <CatalogAppCard
            key={entry.id}
            entry={entry}
            admin={admin}
            onSelectEntry={onSelectEntry}
            onManageApp={onManageApp}
          />
        ))}
      </div>
    </>
  );
});
