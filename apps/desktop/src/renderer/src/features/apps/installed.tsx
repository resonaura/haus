/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Box, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeatureLoading } from '../../components/ui/Deferred';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { appRequest, parseApps, type InstalledApp } from './api';
import { AppCatalogBrowser } from './catalog';
import { AppDetails } from './details';
import { NativeCameraSetup } from '../connections/NativeCameraSetup';
import './style.scss';

export function InstalledApps({ admin }: { admin: boolean }) {
  const [tab, setTab] = useState<'installed' | 'catalog'>('installed');
  const [apps, setApps] = useState<InstalledApp[]>();
  const [selected, setSelected] = useState<string>();
  const [external, setExternal] = useState(false);
  const [query, setQuery] = useState('');
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

  const activeApp = apps?.find((app) => app.id === selected || app.externalId === selected);
  const filtered = apps?.filter((app) =>
    app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

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
          onInstalled={load}
          onManageApp={(catalogId) => {
            setSelected(catalogId);
            setTab('installed');
          }}
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
            {filtered?.map((app) => (
              <article className="addon-card" key={app.id}>
                <span className="addon-glyph">
                  <BrandIcon
                    kind="app"
                    id={app.externalId || app.id}
                    size={44}
                    hint={{ name: app.name }}
                  />
                </span>
                <div className="addon-copy">
                  <div>
                    <h3>{app.name}</h3>
                    <span className="status-pill">{app.available ? app.state : 'Unavailable'}</span>
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
                <Button
                  variant="ghost"
                  onPress={() => setSelected(app.id)}
                  aria-label={`Manage ${app.name}`}
                >
                  Manage
                  <ChevronRight size={17} />
                </Button>
              </article>
            ))}
          </div>
        </>
      )}
      {activeApp && (
        <AppDetails
          key={activeApp.id}
          app={activeApp}
          admin={admin}
          onClose={() => setSelected(undefined)}
          onChanged={load}
        />
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
}
