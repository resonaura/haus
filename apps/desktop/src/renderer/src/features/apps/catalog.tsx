/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  ArrowLeft,
  Box,
  Check,
  ChevronRight,
  Download,
  FolderGit2,
  Layers,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { FeatureLoading } from '../../components/ui/Deferred';
import { EmptyState } from '../../components/ui/EmptyState';
import { appRequest, type InstalledApp } from './api';
import { parseCatalog, type CatalogAppSummary } from './catalog-api';
import { catalogIconKind } from './catalog-details';
import { CustomRepositoriesDialog } from './custom-repositories-dialog';
import { HausGoveeGroupView } from './haus-govee-group';
import {
  formatStabilityMedal,
  groupCatalogAppsByVendor,
  resolveBrandIdentity,
  type CatalogVendorGroup,
} from './vendor-grouping';

const CATALOG_PAGE_BATCH = 60;

const RUNTIME_FILTERS: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'homebridge', label: 'Homebridge' },
  { id: 'scrypted', label: 'Scrypted' },
  { id: 'docker', label: 'Docker' },
  { id: 'hacs', label: 'HACS' },
];

const CatalogAppCard = memo(function CatalogAppCard({
  entry,
  rank,
  admin,
  onSelectEntry,
  onManageApp,
}: {
  entry: CatalogAppSummary;
  rank?: number;
  admin: boolean;
  onSelectEntry: (entry: CatalogAppSummary) => void;
  onManageApp: (appId: string) => void;
}) {
  const brand = useMemo(
    () =>
      resolveBrandIdentity(
        entry.packageName ?? entry.id,
        entry.name,
        entry.vendorId,
        entry.vendorName,
      ),
    [entry.packageName, entry.id, entry.name, entry.vendorId, entry.vendorName],
  );
  const hint = useMemo(
    () => ({
      name: entry.name,
      category: entry.category,
      supportedBy: brand.vendorId,
      ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
    }),
    [entry.name, entry.category, brand.vendorId, entry.repositoryUrl],
  );
  const medal = formatStabilityMedal(entry.stabilityTier, entry.trustScore, entry.verified);

  return (
    <article className="addon-card">
      {rank !== undefined && (
        <span className="vendor-driver-rank">{rank === 1 ? '#1 Top' : `#${rank}`}</span>
      )}
      <span className="addon-glyph">
        <BrandIcon
          kind={catalogIconKind(entry.runtimeType)}
          id={brand.iconId || entry.packageName || entry.id}
          size={44}
          hint={hint}
        />
      </span>
      <div className="addon-copy">
        <div>
          <h3>{entry.name}</h3>
          <div className="native-app-badges">
            <span className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</span>
            <span className="status-pill">{entry.runtimeType}</span>
            {entry.installed && (
              <span className="status-pill status-available">
                {entry.updateAvailable ? 'Update available' : 'Installed'}
              </span>
            )}
          </div>
        </div>
        <p>{entry.description || entry.category}</p>
        <small>
          {entry.packageName ? `${entry.packageName} · ` : ''}Version {entry.latestVersion}
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
            {rank !== undefined ? <Settings2 size={15} /> : admin ? <Download size={16} /> : null}
            {rank !== undefined ? 'Configure separately' : admin ? 'Install' : 'Details'}
            {!admin && rank === undefined ? <ChevronRight size={15} /> : null}
          </Button>
        )}
      </div>
    </article>
  );
});

const CatalogVendorGroupCard = memo(function CatalogVendorGroupCard({
  group,
  onOpenGroup,
}: {
  group: CatalogVendorGroup;
  onOpenGroup: (group: CatalogVendorGroup) => void;
}) {
  const medal = formatStabilityMedal(group.topStabilityTier, group.topTrustScore, true);
  const hint = useMemo(
    () => ({
      name: group.vendorTitle,
      supportedBy: group.vendorId,
      ...(group.items[0]?.repositoryUrl ? { repositoryUrl: group.items[0].repositoryUrl } : {}),
    }),
    [group.vendorTitle, group.vendorId, group.items],
  );
  const runtimes = Array.from(new Set(group.items.map((i) => i.runtimeType))).join(' · ');

  return (
    <article className="addon-card vendor-group-addon-card">
      <span className="addon-glyph">
        <BrandIcon kind="integration" id={group.iconId} size={44} hint={hint} />
      </span>
      <div className="addon-copy">
        <div>
          <h3>{group.vendorTitle}</h3>
          <div className="native-app-badges">
            <span className="vendor-group-count-pill">
              <Layers size={12} />
              {group.items.length} items in group
            </span>
            <span className={`stability-medal-pill is-${medal.tier}`}>{medal.label}</span>
            <span className="status-pill">{runtimes}</span>
            {group.installedCount > 0 && (
              <span className="status-pill status-available">{group.installedCount} installed</span>
            )}
          </div>
        </div>
        <p>{group.whyGrouped}</p>
        <small>Includes: {group.items.map((item) => item.name).join(' · ')}</small>
      </div>
      <div className="addon-actions">
        <Button variant="secondary" onPress={() => onOpenGroup(group)}>
          {group.isCombinedHausGovee
            ? 'Combined & Separate Setup'
            : `Open Group (${group.items.length})`}
          <ChevronRight size={15} />
        </Button>
      </div>
    </article>
  );
});

export const AppCatalogBrowser = memo(function AppCatalogBrowser({
  admin,
  installedApps = [],
  onSelectEntry,
  onManageApp,
  onInstalled,
}: {
  admin: boolean;
  installedApps?: readonly InstalledApp[];
  onSelectEntry: (entry: CatalogAppSummary) => void;
  onManageApp: (appId: string) => void;
  onInstalled?: () => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<CatalogAppSummary[]>();
  const [runtime, setRuntime] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [activeGroup, setActiveGroup] = useState<CatalogVendorGroup | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleLimit, setVisibleLimit] = useState(CATALOG_PAGE_BATCH);
  const [reposOpen, setReposOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const generation = useRef(0);

  const mergeEntries = useCallback((incoming: readonly CatalogAppSummary[]) => {
    setEntries((prev) => {
      const byId = new Map<string, CatalogAppSummary>();
      for (const item of prev ?? []) byId.set(item.id, item);
      for (const item of incoming) byId.set(item.id, item);
      return Array.from(byId.values());
    });
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const path = forceRefresh ? 'apps/catalog?refresh=true' : 'apps/catalog';
      const list = parseCatalog(await appRequest('GET', path));
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
    void load(false);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [load]);

  useEffect(() => {
    const trimmed = deferredQuery.trim();
    if (trimmed.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search: trimmed });
      if (runtime === 'homebridge' || runtime === 'scrypted') {
        params.set('runtimeType', runtime);
      }
      void appRequest('GET', `apps/catalog?${params.toString()}`)
        .then((raw) => {
          if (!active || !mounted.current) return;
          mergeEntries(parseCatalog(raw));
        })
        .catch(() => {});
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [deferredQuery, runtime, mergeEntries]);

  useEffect(() => {
    setVisibleLimit(CATALOG_PAGE_BATCH);
  }, [runtime, category, deferredQuery]);

  const runtimeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: (entries ?? []).length };
    for (const item of entries ?? []) {
      counts[item.runtimeType] = (counts[item.runtimeType] ?? 0) + 1;
    }
    return counts;
  }, [entries]);

  const categories = useMemo(
    () => [
      'all',
      ...Array.from(
        new Set(
          (entries ?? [])
            .filter((item) => runtime === 'all' || item.runtimeType === runtime)
            .map((item) => item.category),
        ),
      ).sort(),
    ],
    [entries, runtime],
  );

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLocaleLowerCase();
    return (entries ?? []).filter((item) => {
      if (runtime !== 'all' && item.runtimeType !== runtime) return false;
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.name.toLocaleLowerCase().includes(q) ||
        item.id.toLocaleLowerCase().includes(q) ||
        (item.packageName ?? '').toLocaleLowerCase().includes(q) ||
        (item.vendorName ?? '').toLocaleLowerCase().includes(q) ||
        (item.description ?? '').toLocaleLowerCase().includes(q) ||
        (item.author ?? '').toLocaleLowerCase().includes(q)
      );
    });
  }, [entries, runtime, category, deferredQuery]);

  const vendorGroups = useMemo(() => groupCatalogAppsByVendor(filtered), [filtered]);
  const visibleGroups = useMemo(
    () => vendorGroups.slice(0, visibleLimit),
    [vendorGroups, visibleLimit],
  );

  if (activeGroup) {
    if (activeGroup.isCombinedHausGovee) {
      return (
        <HausGoveeGroupView
          admin={admin}
          catalogItems={activeGroup.items}
          installedApps={installedApps}
          onBack={() => setActiveGroup(null)}
          onSelectCatalogEntry={onSelectEntry}
          onManageInstalledApp={onManageApp}
          onCombinedSaved={async () => {
            await load(false);
            await onInstalled?.();
          }}
        />
      );
    }

    const topMedal = formatStabilityMedal(
      activeGroup.topStabilityTier,
      activeGroup.topTrustScore,
      true,
    );
    return (
      <div className="haus-govee-group-view">
        <div className="haus-govee-back-row">
          <Button variant="ghost" size="sm" onPress={() => setActiveGroup(null)}>
            <ArrowLeft size={15} />
            Back to catalog
          </Button>
        </div>
        <section className="vendor-group-explainer-banner">
          <div className="vendor-group-explainer-head">
            <span className="integration-logo">
              <BrandIcon
                kind="integration"
                id={activeGroup.iconId}
                size={42}
                hint={{ name: activeGroup.vendorTitle, supportedBy: activeGroup.vendorId }}
              />
            </span>
            <div className="vendor-group-explainer-titles">
              <div className="vendor-group-title-row">
                <h3>{activeGroup.vendorTitle}</h3>
                <span className="vendor-group-count-pill">
                  <Layers size={12} />
                  {activeGroup.items.length} items in group
                </span>
                <span className={`stability-medal-pill is-${topMedal.tier}`}>{topMedal.label}</span>
              </div>
              <p>{activeGroup.whyGrouped}</p>
            </div>
          </div>
        </section>
        <div className="addon-list">
          {activeGroup.items.map((entry, idx) => (
            <CatalogAppCard
              key={entry.id}
              entry={entry}
              rank={idx + 1}
              admin={admin}
              onSelectEntry={onSelectEntry}
              onManageApp={onManageApp}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label="Search App catalog"
            placeholder="Search Homebridge, Scrypted, HACS & Docker Apps by brand or package…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button variant="secondary" onPress={() => setReposOpen(true)}>
          <FolderGit2 size={15} />
          Repositories
        </Button>
        <Button variant="ghost" isDisabled={loading} onPress={() => void load(true)}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </Button>
      </div>
      <div className="filter-tabs" role="tablist" aria-label="App ecosystems">
        {RUNTIME_FILTERS.map((rt) => {
          const count = runtimeCounts[rt.id] ?? 0;
          return (
            <button
              key={rt.id}
              type="button"
              role="tab"
              aria-selected={runtime === rt.id}
              aria-pressed={runtime === rt.id}
              onClick={() => {
                setRuntime(rt.id);
                setCategory('all');
              }}
            >
              {rt.label}
              {entries ? ` (${count.toLocaleString()})` : ''}
            </button>
          );
        })}
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
              {cat === 'all' ? 'All categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}
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
      {entries && vendorGroups.length === 0 && (
        <EmptyState
          icon={<Box />}
          title="No catalog Apps match"
          description="Try another search, ecosystem, or category."
        />
      )}
      <div className="addon-list">
        {visibleGroups.map((group) =>
          group.isCombinedHausGovee || group.items.length > 1 ? (
            <CatalogVendorGroupCard
              key={`group:${group.vendorId}`}
              group={group}
              onOpenGroup={setActiveGroup}
            />
          ) : (
            <CatalogAppCard
              key={group.items[0]!.id}
              entry={group.items[0]!}
              admin={admin}
              onSelectEntry={onSelectEntry}
              onManageApp={onManageApp}
            />
          ),
        )}
      </div>
      {visibleLimit < vendorGroups.length && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button
            variant="secondary"
            onPress={() => setVisibleLimit((prev) => prev + CATALOG_PAGE_BATCH)}
          >
            Show more ({(vendorGroups.length - visibleLimit).toLocaleString()} brands remaining)
          </Button>
        </div>
      )}
      {reposOpen && (
        <CustomRepositoriesDialog
          admin={admin}
          onClose={() => setReposOpen(false)}
          onChanged={() => void load(false)}
        />
      )}
    </>
  );
});
