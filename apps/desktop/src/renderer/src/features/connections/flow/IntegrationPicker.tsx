/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Box, Pressable, Text, TextInput } from '@haus/ui';
import { ArrowDownAZ, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { AddHacsRepoDialog } from '../../community/AddHacsRepoDialog';
import { IntegrationBrandDetail } from './brand-detail';
import { searchEcosystemCatalogLive } from './flow-helpers';
import {
  buildIntegrationCatalog,
  filterIntegrationCatalog,
  VirtualizedIntegrationGrid,
  type EcosystemCatalogSourceItem,
  type IntegrationCatalogItem,
  type IntegrationEcosystem,
} from './integration-grid';

const ECOSYSTEM_TABS: ReadonlyArray<{
  readonly id: IntegrationEcosystem;
  readonly label: string;
}> = [
  { id: 'all', label: 'All Brands' },
  { id: 'ha', label: 'Home Assistant' },
  { id: 'hacs', label: 'HACS' },
  { id: 'homebridge', label: 'Homebridge' },
  { id: 'scrypted', label: 'Scrypted' },
];

export const IntegrationPicker = memo(function IntegrationPicker({
  query,
  onQueryChange,
  handlers,
  names,
  ecosystemApps = [],
  initialSelectedBrand = null,
  busy,
  onStartDomain,
  onSelectEcosystemApp,
  onCombinedGoveeDone,
  onRefreshCatalog,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  handlers: readonly string[];
  names: Readonly<Record<string, string>>;
  ecosystemApps?: readonly EcosystemCatalogSourceItem[];
  initialSelectedBrand?: IntegrationCatalogItem | null;
  busy: boolean;
  onStartDomain: (domain: string) => void;
  onSelectEcosystemApp?: (
    appId: string,
    title: string,
    runtime: 'hacs' | 'homebridge' | 'scrypted' | 'docker',
    meta?: { readonly hacsRepositoryId?: string; readonly hacsDomain?: string },
  ) => void;
  onCombinedGoveeDone?: () => void;
  onRefreshCatalog?: () => void | Promise<void>;
}) {
  const deferredQuery = useDeferredValue(query);
  const effectiveQuery = query.trim().length === 0 ? '' : deferredQuery;
  const [indexOpen, setIndexOpen] = useState(false);
  const [customRepoOpen, setCustomRepoOpen] = useState(false);
  const [ecosystem, setEcosystem] = useState<IntegrationEcosystem>('all');
  const [selectedBrand, setSelectedBrand] = useState<IntegrationCatalogItem | null>(
    initialSelectedBrand,
  );
  const [liveResults, setLiveResults] = useState<readonly EcosystemCatalogSourceItem[]>([]);

  useEffect(() => {
    const trimmed = effectiveQuery.trim();
    if (trimmed.length < 2) {
      setLiveResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchEcosystemCatalogLive(trimmed).then((found) => {
        if (active) setLiveResults(found);
      });
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [effectiveQuery]);

  const mergedEcosystemApps = useMemo(() => {
    if (liveResults.length === 0) return ecosystemApps;
    const byId = new Map<string, EcosystemCatalogSourceItem>();
    for (const item of ecosystemApps) byId.set(item.id, item);
    for (const item of liveResults) byId.set(item.id, item);
    return [...byId.values()];
  }, [ecosystemApps, liveResults]);

  const catalog = useMemo(
    () => buildIntegrationCatalog(handlers, names, mergedEcosystemApps),
    [handlers, names, mergedEcosystemApps],
  );
  const ecosystemCounts = useMemo(() => {
    let ha = 0;
    let hacs = 0;
    let homebridge = 0;
    let scrypted = 0;
    for (const item of catalog) {
      const members = item.groupItems ?? [item];
      if (members.some((m) => (m.runtime ?? 'ha') === 'ha')) ha += 1;
      if (members.some((m) => m.runtime === 'hacs')) hacs += 1;
      if (members.some((m) => m.runtime === 'homebridge')) homebridge += 1;
      if (members.some((m) => m.runtime === 'scrypted')) scrypted += 1;
    }
    return { all: catalog.length, ha, hacs, homebridge, scrypted };
  }, [catalog]);

  const filteredCatalog = useMemo(
    () => filterIntegrationCatalog(catalog, effectiveQuery, ecosystem),
    [catalog, effectiveQuery, ecosystem],
  );

  const launchDriver = useCallback(
    (driver: IntegrationCatalogItem) => {
      if (
        (driver.runtime === 'hacs' ||
          driver.runtime === 'homebridge' ||
          driver.runtime === 'scrypted' ||
          driver.runtime === 'docker') &&
        driver.appId &&
        onSelectEcosystemApp
      ) {
        onSelectEcosystemApp(driver.appId, driver.title, driver.runtime, {
          ...(driver.hacsRepositoryId ? { hacsRepositoryId: driver.hacsRepositoryId } : {}),
          ...(driver.domain ? { hacsDomain: driver.domain } : {}),
        });
        return;
      }
      onStartDomain(driver.id);
    },
    [onSelectEcosystemApp, onStartDomain],
  );

  const handleSelectBrand = useCallback(
    (_id: string, _title: string, item: IntegrationCatalogItem) => {
      setSelectedBrand(item);
    },
    [],
  );

  const handleQueryInput = useCallback(
    (next: string) => {
      if (next.trim().length > 0 && indexOpen) {
        setIndexOpen(false);
      }
      onQueryChange(next);
    },
    [indexOpen, onQueryChange],
  );

  const handleToggleAlphabet = useCallback(() => {
    if (indexOpen) return setIndexOpen(false);
    if (query.length > 0) onQueryChange('');
    setIndexOpen(true);
  }, [indexOpen, query.length, onQueryChange]);

  if (selectedBrand) {
    return (
      <IntegrationBrandDetail
        selectedBrand={selectedBrand}
        busy={busy}
        onBack={() => setSelectedBrand(null)}
        onLaunchDriver={launchDriver}
        onStartDomain={onStartDomain}
        onSelectEcosystemApp={onSelectEcosystemApp}
        onCombinedGoveeDone={onCombinedGoveeDone}
      />
    );
  }

  const hasQuery = effectiveQuery.trim().length > 0;
  const showEcosystemTabs =
    ecosystemCounts.hacs > 0 || ecosystemCounts.homebridge > 0 || ecosystemCounts.scrypted > 0;

  return (
    <Box className="integration-picker-panel">
      <Box className="integration-search-bar">
        <Text semantic="label" className="management-search integration-search-field">
          <Search size={16} />
          <TextInput
            ariaLabel="Find integration"
            placeholder={
              catalog.length > 0
                ? `Search ${catalog.length.toLocaleString()} brands & integrations…`
                : 'Search brands & integrations…'
            }
            value={query}
            onChange={handleQueryInput}
          />
          {query.length > 0 && (
            <Pressable
              className="integration-search-clear"
              ariaLabel="Clear search"
              onPress={() => onQueryChange('')}
            >
              <X size={14} />
            </Pressable>
          )}
        </Text>
        <Pressable
          className={`integration-alpha-trigger${indexOpen ? ' is-active' : ''}`}
          ariaPressed={indexOpen}
          ariaLabel={indexOpen ? 'Return to integrations list' : 'Browse integrations by letter'}
          title={indexOpen ? 'Return to integrations list' : 'Jump to letter'}
          disabled={filteredCatalog.length === 0}
          onPress={handleToggleAlphabet}
        >
          <ArrowDownAZ size={15} />
          <Text>A–Z</Text>
        </Pressable>
        <Pressable
          className="integration-alpha-trigger"
          ariaLabel="Add custom HACS repository"
          title="Add custom HACS repository"
          disabled={busy}
          onPress={() => setCustomRepoOpen(true)}
        >
          <Plus size={15} />
          <Text>Custom repo</Text>
        </Pressable>
        {catalog.length > 0 && (
          <Text className="integration-count-badge">
            {hasQuery || ecosystem !== 'all'
              ? `${filteredCatalog.length.toLocaleString()} / ${catalog.length.toLocaleString()}`
              : catalog.length.toLocaleString()}
          </Text>
        )}
      </Box>

      {showEcosystemTabs && (
        <Box className="integration-ecosystem-row">
          <Box
            className="integration-ecosystem-tabs"
            role="tablist"
            ariaLabel="Filter integrations by ecosystem"
          >
            {ECOSYSTEM_TABS.map((tab) => {
              const count = ecosystemCounts[tab.id];
              const active = ecosystem === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  role="tab"
                  ariaSelected={active}
                  className={`integration-ecosystem-tab${active ? ' is-active' : ''}`}
                  onPress={() => {
                    setEcosystem(tab.id);
                    if (indexOpen) setIndexOpen(false);
                  }}
                >
                  <Text>{tab.label}</Text>
                  <Text className="integration-ecosystem-tab-count">{count.toLocaleString()}</Text>
                </Pressable>
              );
            })}
          </Box>
          <Text className="integration-grouping-note">
            <ShieldCheck size={13} />
            Grouped by brand &amp; ranked by stability — select any brand for combined or separate
            setup
          </Text>
        </Box>
      )}

      <VirtualizedIntegrationGrid
        items={filteredCatalog}
        query={effectiveQuery}
        grouped={!hasQuery}
        indexOpen={indexOpen}
        onIndexOpenChange={setIndexOpen}
        busy={busy}
        loading={busy && catalog.length === 0}
        onSelect={handleSelectBrand}
      />
      {customRepoOpen && (
        <AddHacsRepoDialog
          onClose={() => setCustomRepoOpen(false)}
          onAdded={async (added) => {
            await onRefreshCatalog?.();
            if (added.category === 'integration' && added.domain) {
              onSelectEcosystemApp?.(
                `hacs-${added.domain.replaceAll('_', '-')}`,
                added.name,
                'hacs',
                {
                  hacsRepositoryId: String(added.id),
                  hacsDomain: added.domain,
                },
              );
            }
          }}
        />
      )}
    </Box>
  );
});
