/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Box, ChevronRight, Layers, RefreshCw, Search } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeatureLoading } from '../../components/ui/Deferred';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { appRequest, parseApps, type InstalledApp } from './api';
import type { CatalogAppSummary } from './catalog-api';
import { AppCatalogBrowser } from './catalog';
import { AppCatalogDetails } from './catalog-details';
import { AppDetails } from './details';
import { HausGoveeGroupView } from './haus-govee-group';
import {
  groupInstalledAppsWithHausGovee,
  HAUS_GOVEE_WHY_GROUPED,
  resolveBrandIdentity,
  type InstalledVendorGroup,
} from './vendor-grouping';
import { NativeCameraSetup } from '../connections/NativeCameraSetup';
import './style.scss';

const InstalledAppCard = memo(function InstalledAppCard({
  app,
  onSelect,
}: {
  app: InstalledApp;
  onSelect: (appId: string) => void;
}) {
  const ext = app.externalId || app.id;
  const brand = useMemo(() => resolveBrandIdentity(ext, app.name), [ext, app.name]);
  const hint = useMemo(
    () => ({ name: app.name, supportedBy: brand.vendorId }),
    [app.name, brand.vendorId],
  );
  return (
    <article className="addon-card">
      <span className="addon-glyph">
        <BrandIcon kind="app" id={brand.iconId || ext} size={44} hint={hint} />
      </span>
      <div className="addon-copy">
        <div>
          <h3>{app.name}</h3>
          <span
            className={`status-pill ${app.available && app.state === 'running' ? 'status-available' : ''}`}
          >
            {app.available ? app.state : 'Unavailable'}
          </span>
        </div>
        <p>
          {app.accessories?.mqtt
            ? 'Accessories connect automatically'
            : app.accessories?.camera
              ? 'Camera accessories'
              : 'Home App'}
        </p>
        {app.version && <small>Version {app.version}</small>}
      </div>
      <Button variant="ghost" onPress={() => onSelect(app.id)} aria-label={`Manage ${app.name}`}>
        Manage
        <ChevronRight size={17} />
      </Button>
    </article>
  );
});

const InstalledHausGoveeGroupCard = memo(function InstalledHausGoveeGroupCard({
  group,
  onOpenGroup,
}: {
  group: InstalledVendorGroup;
  onOpenGroup: () => void;
}) {
  const runningCount = group.apps.filter((a) => a.available && a.state === 'running').length;
  return (
    <article className="addon-card vendor-group-addon-card">
      <span className="addon-glyph">
        <BrandIcon
          kind="integration"
          id="govee"
          size={44}
          hint={{ name: 'Haus Govee', supportedBy: 'govee' }}
        />
      </span>
      <div className="addon-copy">
        <div>
          <h3>{group.vendorTitle}</h3>
          <div className="native-app-badges">
            <span className="vendor-group-count-pill">
              <Layers size={12} />
              {group.apps.length} {group.apps.length === 1 ? 'item' : 'items'} in group (Govee2MQTT
              + Homebridge Govee)
            </span>
            <span className="stability-medal-pill is-gold">🥇 Gold Stability · 99% Trust</span>
            <span className={`status-pill ${runningCount > 0 ? 'status-available' : ''}`}>
              {runningCount > 0 ? `${runningCount} running` : 'Installed'}
            </span>
          </div>
        </div>
        <p>{HAUS_GOVEE_WHY_GROUPED}</p>
        <small>Combined flow active · Engines: {group.apps.map((a) => a.name).join(' · ')}</small>
      </div>
      <Button variant="secondary" onPress={onOpenGroup}>
        Open Group
        <ChevronRight size={17} />
      </Button>
    </article>
  );
});

export const InstalledApps = memo(function InstalledApps({ admin }: { admin: boolean }) {
  const [tab, setTab] = useState<'installed' | 'catalog'>('installed');
  const [apps, setApps] = useState<InstalledApp[]>();
  const [selected, setSelected] = useState<string>();
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogAppSummary>();
  const [goveeGroupOpen, setGoveeGroupOpen] = useState(false);
  const [external, setExternal] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = parseApps(await appRequest('GET', 'apps'));
      if (current === generation.current) {
        setApps(result);
        setError('');
      }
    } catch (reason) {
      if (current === generation.current)
        setError(reason instanceof Error ? reason.message : 'Could not load Apps.');
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  const activeApp = useMemo(
    () => apps?.find((app) => app.id === selected || app.externalId === selected),
    [apps, selected],
  );

  const filtered = useMemo(() => {
    const term = deferredQuery.trim().toLocaleLowerCase();
    if (!term) return apps;
    return apps?.filter(
      (app) =>
        app.name.toLocaleLowerCase().includes(term) ||
        (term.includes('govee') &&
          (app.id.includes('govee') || (app.externalId ?? '').includes('govee'))),
    );
  }, [apps, deferredQuery]);

  const groupedInstalled = useMemo(
    () => (filtered ? groupInstalledAppsWithHausGovee(filtered) : null),
    [filtered],
  );

  const handleManageApp = useCallback((appId: string) => {
    setSelectedCatalog(undefined);
    setGoveeGroupOpen(false);
    setSelected(appId);
    setTab('installed');
  }, []);

  if (activeApp) {
    return (
      <section className="native-apps native-apps-detail">
        <AppDetails
          key={activeApp.id}
          app={activeApp}
          admin={admin}
          onClose={() => setSelected(undefined)}
          onChanged={load}
        />
      </section>
    );
  }

  if (selectedCatalog) {
    return (
      <section className="native-apps native-apps-detail">
        <AppCatalogDetails
          key={selectedCatalog.id}
          entry={selectedCatalog}
          admin={admin}
          onBack={() => setSelectedCatalog(undefined)}
          onInstalled={load}
          onManageApp={handleManageApp}
        />
      </section>
    );
  }

  if (goveeGroupOpen) {
    return (
      <section className="native-apps native-apps-detail">
        <HausGoveeGroupView
          admin={admin}
          installedApps={apps ?? []}
          onBack={() => setGoveeGroupOpen(false)}
          onManageInstalledApp={handleManageApp}
          onCombinedSaved={load}
        />
      </section>
    );
  }

  return (
    <section className="native-apps">
      <div className="filter-tabs" role="tablist" aria-label="Apps views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'installed'}
          aria-pressed={tab === 'installed'}
          onClick={() => setTab('installed')}
        >
          Installed{apps ? ` (${apps.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'catalog'}
          aria-pressed={tab === 'catalog'}
          onClick={() => setTab('catalog')}
        >
          Catalog
        </button>
      </div>
      {tab === 'catalog' ? (
        <AppCatalogBrowser
          admin={admin}
          installedApps={apps ?? []}
          onSelectEntry={setSelectedCatalog}
          onManageApp={handleManageApp}
          onInstalled={load}
        />
      ) : (
        <>
          <div className="management-toolbar">
            {admin && (
              <Button variant="secondary" onPress={() => setExternal(true)}>
                <Box size={16} />
                Connect a camera App
              </Button>
            )}
            <label className="management-search">
              <Search size={17} />
              <input
                aria-label="Search Apps"
                placeholder="Search Apps…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <Button variant="ghost" isDisabled={loading} onPress={() => void load()}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Refresh
            </Button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!apps && loading && <FeatureLoading />}
          {apps?.length === 0 && (
            <EmptyState
              icon={<Box />}
              title="Your Apps live here"
              description="Install Apps from the catalog or add accessories connected through an App."
              action={
                <Button variant="secondary" onPress={() => setTab('catalog')}>
                  Browse App catalog
                </Button>
              }
            />
          )}
          {!!apps?.length && filtered?.length === 0 && (
            <p className="management-hint">No Apps match your search.</p>
          )}
          <div className="addon-list">
            {groupedInstalled?.goveeGroup && (
              <InstalledHausGoveeGroupCard
                group={groupedInstalled.goveeGroup}
                onOpenGroup={() => setGoveeGroupOpen(true)}
              />
            )}
            {groupedInstalled?.standaloneApps.map((app) => (
              <InstalledAppCard key={app.id} app={app} onSelect={setSelected} />
            ))}
          </div>
        </>
      )}
      {external && (
        <NativeCameraSetup
          onClose={() => setExternal(false)}
          onDone={() => {
            setExternal(false);
            void load();
          }}
        />
      )}
    </section>
  );
});
