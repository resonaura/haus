/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { Box, Check, Download, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { FeatureLoading } from '../../components/ui/Deferred';
import { EmptyState } from '../../components/ui/EmptyState';
import { BrandIcon } from '../../components/brand/BrandIcon';
import { AppConfigFields } from './config-form';
import { appRequest } from './api';
import {
  initialConfigFromManifest,
  parseCatalog,
  parseCatalogDetail,
  parseInstallProgress,
  requiredManifestPermissions,
  sanitizeOptionsSubmission,
  type AppInstallProgress,
  type CatalogAppDetail,
  type CatalogAppSummary,
} from './catalog-api';

const stageLabel = (stage: string) =>
  ({
    validating: 'Validating manifest…',
    'checking-local': 'Checking local images…',
    pulling: 'Pulling container image…',
    building: 'Building App image…',
    ready: 'Image ready…',
    creating: 'Creating App container…',
    starting: 'Starting App…',
    complete: 'Installed',
    failed: 'Installation failed',
  })[stage] ?? `${stage}…`;

export function AppCatalogBrowser({
  admin,
  onInstalled,
  onManageApp,
}: {
  admin: boolean;
  onInstalled: () => Promise<void>;
  onManageApp: (appId: string) => void;
}) {
  const [entries, setEntries] = useState<CatalogAppSummary[]>();
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [installingTarget, setInstallingTarget] = useState<CatalogAppSummary>();
  const [detail, setDetail] = useState<CatalogAppDetail>();
  const [detailError, setDetailError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [progress, setProgress] = useState<AppInstallProgress>();
  const [busy, setBusy] = useState(false);
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

  const openInstall = async (entry: CatalogAppSummary) => {
    setInstallingTarget(entry);
    setDetail(undefined);
    setDetailError('');
    setProgress(undefined);
    try {
      const loaded = parseCatalogDetail(
        await appRequest('GET', `apps/catalog/${encodeURIComponent(entry.id)}`),
      );
      if (!mounted.current) return;
      setDetail(loaded);
      setValues(initialConfigFromManifest(loaded.manifest));
    } catch (reason) {
      if (mounted.current) {
        setDetailError(reason instanceof Error ? reason.message : 'Could not load App details.');
      }
    }
  };

  useEffect(() => {
    if (!busy || !installingTarget) return;
    let active = true;
    const poll = () => {
      void appRequest('GET', `apps/${encodeURIComponent(installingTarget.id)}/install-progress`)
        .then((raw) => {
          const parsed = parseInstallProgress(raw);
          if (active && parsed) setProgress(parsed);
        })
        .catch(() => {});
    };
    poll();
    const timer = window.setInterval(poll, 600);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, installingTarget]);

  const submitInstall = async () => {
    if (!installingTarget || !detail || busy) return;
    setBusy(true);
    setDetailError('');
    setProgress({ appId: detail.manifest.id, stage: 'validating' });
    try {
      const grantedPermissions = requiredManifestPermissions(detail.manifest);
      const config = sanitizeOptionsSubmission(detail.manifest, values);
      await appRequest('POST', 'apps/install', {
        manifest: detail.manifest,
        grantedPermissions,
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      await onInstalled();
      await load();
      if (mounted.current) setInstallingTarget(undefined);
    } catch (reason) {
      if (mounted.current) {
        setDetailError(reason instanceof Error ? reason.message : 'App installation failed.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const categories = useMemo(
    () => ['all', ...Array.from(new Set((entries ?? []).map((item) => item.category))).sort()],
    [entries],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
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
  }, [entries, category, query]);

  const permissions = detail ? requiredManifestPermissions(detail.manifest) : [];

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
          <article className="addon-card" key={entry.id}>
            <span className="addon-glyph">
              <BrandIcon
                kind={
                  entry.runtimeType === 'homebridge'
                    ? 'homebridge'
                    : entry.runtimeType === 'scrypted'
                      ? 'scrypted'
                      : entry.runtimeType === 'addon'
                        ? 'addon'
                        : 'app'
                }
                id={entry.id}
                size={44}
                hint={{
                  name: entry.name,
                  category: entry.category,
                  ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
                }}
              />
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
            {entry.installed ? (
              <Button variant="secondary" onPress={() => onManageApp(entry.id)}>
                <Check size={16} />
                Installed
              </Button>
            ) : (
              <Button variant="primary" isDisabled={!admin} onPress={() => void openInstall(entry)}>
                <Download size={16} />
                Install
              </Button>
            )}
          </article>
        ))}
      </div>
      {installingTarget && (
        <Dialog
          title={`Install ${installingTarget.name}`}
          onClose={() => {
            if (!busy) setInstallingTarget(undefined);
          }}
          className="native-app-dialog"
        >
          {!detail && !detailError && <FeatureLoading />}
          {detailError && (
            <p className="form-error" role="alert">
              {detailError}
            </p>
          )}
          {detail && (
            <>
              {detail.manifest.description && (
                <p className="management-hint">{detail.manifest.description}</p>
              )}
              <p className="management-hint">
                Version {detail.manifest.version} · Runtime {detail.runtimeType}
                {detail.author ? ` · ${detail.author}` : ''}
              </p>
              {permissions.length > 0 && (
                <div className="native-app-permissions">
                  <strong>Requested Hub permissions</strong>
                  <ul>
                    {permissions.map((perm) => (
                      <li key={perm}>{perm}</li>
                    ))}
                  </ul>
                </div>
              )}
              <AppConfigFields
                options={detail.manifest.options}
                secrets={detail.manifest.secrets}
                values={values}
                disabled={busy}
                onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
              />
              {progress && (
                <div className="native-app-progress" role="status">
                  {busy && <LoaderCircle size={15} className="spin" />}
                  <span>
                    {stageLabel(progress.stage)}
                    {progress.errorCode ? ` (${progress.errorCode})` : ''}
                  </span>
                </div>
              )}
              <div className="native-app-actions">
                <Button
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => setInstallingTarget(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  isDisabled={!admin || busy}
                  onPress={() => void submitInstall()}
                >
                  <Download size={16} />
                  {busy ? 'Installing…' : 'Install App'}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
