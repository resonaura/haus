/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Box as UiBox, HausButton, Heading, Pressable, Row, Text, TextInput } from '@haus/ui';
import { ArrowLeft, Box, FolderGit2, Layers, RefreshCw, Search } from 'lucide-react';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { FeatureLoading, EmptyState } from '@haus/ui/components';
import { appRequest, type InstalledApp } from './api';
import { parseCatalog, type CatalogAppSummary } from './catalog-api';
import { CatalogAppCard, CatalogVendorGroupCard } from './catalog-cards';
import { CustomRepositoriesDialog } from './custom-repositories-dialog';
import { HausGoveeGroupView } from './haus-govee-group';
import {
  formatStabilityMedal,
  groupCatalogAppsByVendor,
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
      <UiBox className="haus-govee-group-view">
        <UiBox className="haus-govee-back-row">
          <HausButton variant="ghost" size="sm" onPress={() => setActiveGroup(null)}>
            <ArrowLeft size={15} />
            Back to catalog
          </HausButton>
        </UiBox>
        <UiBox semantic="section" className="vendor-group-explainer-banner">
          <UiBox className="vendor-group-explainer-head">
            <Text className="integration-logo">
              <BrandIcon
                kind="integration"
                id={activeGroup.iconId}
                size={42}
                hint={{ name: activeGroup.vendorTitle, supportedBy: activeGroup.vendorId }}
              />
            </Text>
            <UiBox className="vendor-group-explainer-titles">
              <UiBox className="vendor-group-title-row">
                <Heading level={3}>{activeGroup.vendorTitle}</Heading>
                <Text className="vendor-group-count-pill">
                  <Layers size={12} />
                  {activeGroup.items.length} items in group
                </Text>
                <Text className={`stability-medal-pill is-${topMedal.tier}`}>{topMedal.label}</Text>
              </UiBox>
              <Text semantic="p">{activeGroup.whyGrouped}</Text>
            </UiBox>
          </UiBox>
        </UiBox>
        <UiBox className="addon-list">
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
        </UiBox>
      </UiBox>
    );
  }

  return (
    <>
      <UiBox className="management-toolbar">
        <Text semantic="label" className="management-search">
          <Search size={17} />
          <TextInput
            ariaLabel="Search App catalog"
            placeholder="Search Homebridge, Scrypted, HACS & Docker Apps by brand or package…"
            value={query}
            onChange={setQuery}
          />
        </Text>
        <HausButton variant="secondary" onPress={() => setReposOpen(true)}>
          <FolderGit2 size={15} />
          Repositories
        </HausButton>
        <HausButton variant="ghost" isDisabled={loading} onPress={() => void load(true)}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </HausButton>
      </UiBox>
      <UiBox className="filter-tabs" role="tablist" ariaLabel="App ecosystems">
        {RUNTIME_FILTERS.map((rt) => {
          const count = runtimeCounts[rt.id] ?? 0;
          return (
            <Pressable
              key={rt.id}
              role="tab"
              ariaSelected={runtime === rt.id}
              ariaPressed={runtime === rt.id}
              onPress={() => {
                setRuntime(rt.id);
                setCategory('all');
              }}
            >
              {rt.label}
              {entries ? ` (${count.toLocaleString()})` : ''}
            </Pressable>
          );
        })}
      </UiBox>
      {categories.length > 1 && (
        <UiBox className="filter-tabs" role="tablist" ariaLabel="App categories">
          {categories.map((cat) => (
            <Pressable
              key={cat}
              role="tab"
              ariaSelected={category === cat}
              ariaPressed={category === cat}
              onPress={() => setCategory(cat)}
            >
              {cat === 'all' ? 'All categories' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Pressable>
          ))}
        </UiBox>
      )}
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
      {!entries && loading && <FeatureLoading />}
      {entries && vendorGroups.length === 0 && (
        <EmptyState
          icon={<Box />}
          title="No catalog Apps match"
          description="Try another search, ecosystem, or category."
        />
      )}
      <UiBox className="addon-list">
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
      </UiBox>
      {visibleLimit < vendorGroups.length && (
        <Row justify="center">
          <HausButton
            variant="secondary"
            onPress={() => setVisibleLimit((prev) => prev + CATALOG_PAGE_BATCH)}
          >
            Show more ({(vendorGroups.length - visibleLimit).toLocaleString()} brands remaining)
          </HausButton>
        </Row>
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
