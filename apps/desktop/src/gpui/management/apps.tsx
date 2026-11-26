/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDemoAppConfig,
  buildDemoAppsState,
  countAppFilters,
  filterCatalogApps,
  filterInstalledApps,
  parseCatalogAppsPayload,
  parseInstalledAppsPayload,
  parseSupervisorAddonsPayload,
  type AppActionId,
  type AppsFilterId,
  type AppsTabId,
  type CatalogAppRecord,
  type InstalledAppRecord,
  type LoadedAppConfigInfo,
  type ManagementPort,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  AppConfigEditorPanel,
  AppDetailsModal,
  AppsWorkspaceView,
  type PortableAppFilterTab,
} from '@haus/ui/components';
import {
  applyDemoConfigSave,
  executeHubAppAction,
  fetchHubAppLogs,
  installHubCatalogApp,
  loadHubAppConfig,
  removeHubApp,
  saveHubAppConfig,
  toAppConfigState,
  type AppConfigState,
} from './apps-config.js';
import { GpuiAppRepositoriesModal } from './apps-repos.js';
import type { GpuiRpcRequest } from './integrations.js';

export function GpuiAppsView({
  snapshot,
  columns = 3,
  demo,
  sessionKind,
  management,
  requestRpc,
  openExternal,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly columns?: number;
  readonly demo?: boolean;
  readonly sessionKind?: 'haus-hub' | 'home-assistant';
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openExternal?: (url: string) => void;
  readonly onSaved?: () => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoAppsState() : undefined), [demo]);
  const [tab, setTab] = useState<AppsTabId>('installed');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AppsFilterId>('all');
  const [installed, setInstalled] = useState<readonly InstalledAppRecord[]>(
    () => demoInitial?.installed ?? [],
  );
  const [catalog, setCatalog] = useState<readonly CatalogAppRecord[]>(
    () => demoInitial?.catalog ?? [],
  );
  const [demoLogs, setDemoLogs] = useState<Readonly<Record<string, string>>>(
    () => demoInitial?.logsById ?? {},
  );
  const [demoConfigs, setDemoConfigs] = useState<Readonly<Record<string, LoadedAppConfigInfo>>>({});
  const [activeAppId, setActiveAppId] = useState<string | undefined>(undefined);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [configState, setConfigState] = useState<AppConfigState>({
    values: {},
    configuredSecrets: new Set(),
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [reposOpen, setReposOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyAppId, setBusyAppId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const isHaSession = sessionKind === 'home-assistant';
  const canManage = Boolean(demo || snapshot.user.is_admin);

  const load = useCallback(async () => {
    if (demo) {
      const next = buildDemoAppsState();
      setInstalled(next.installed);
      setCatalog(next.catalog);
      setDemoLogs(next.logsById);
      return;
    }
    if (!isHaSession && management) {
      setLoading(true);
      setError('');
      try {
        const [appsRaw, catalogRaw] = await Promise.all([
          management.management({ method: 'GET', path: 'apps' }),
          management.management({ method: 'GET', path: 'apps/catalog' }).catch(() => []),
        ]);
        setInstalled(parseInstalledAppsPayload(appsRaw));
        setCatalog(parseCatalogAppsPayload(catalogRaw));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load Apps.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (isHaSession && requestRpc) {
      setLoading(true);
      setError('');
      try {
        const [addonsRaw, storeRaw] = await Promise.all([
          requestRpc({ type: 'supervisor/api', endpoint: '/addons', method: 'get' }),
          requestRpc({ type: 'supervisor/api', endpoint: '/store', method: 'get' }).catch(
            () => undefined,
          ),
        ]);
        const parsed = parseSupervisorAddonsPayload(addonsRaw, storeRaw);
        setInstalled(parsed.installed);
        setCatalog(parsed.catalog);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load Supervisor add-ons.');
      } finally {
        setLoading(false);
      }
      return;
    }
    setError('Connect to Haus Hub or enable Demo mode to manage Apps.');
  }, [demo, isHaSession, management, requestRpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const filterTabs = useMemo<PortableAppFilterTab[]>(() => {
    const counts = countAppFilters(installed);
    return [
      { id: 'all', label: 'Installed', count: counts.all },
      { id: 'running', label: 'Running', count: counts.running },
      { id: 'stopped', label: 'Stopped', count: counts.stopped },
      { id: 'updates', label: 'Updates', count: counts.updates },
    ];
  }, [installed]);

  const visibleInstalled = useMemo(
    () => filterInstalledApps(installed, filter, query),
    [filter, installed, query],
  );
  const visibleCatalog = useMemo(() => filterCatalogApps(catalog, query), [catalog, query]);
  const installedIds = useMemo(() => new Set(installed.map((item) => item.id)), [installed]);
  const activeApp = activeAppId ? installed.find((item) => item.id === activeAppId) : undefined;

  const loadConfig = useCallback(
    async (app: InstalledAppRecord) => {
      if (demo) {
        const current = demoConfigs[app.id] ?? buildDemoAppConfig(app.id);
        setConfigState(toAppConfigState(current));
        setConfigLoaded(true);
        setConfigSaved(false);
        return;
      }
      if (isHaSession || !management) return;
      setConfigLoading(true);
      setError('');
      try {
        setConfigState(await loadHubAppConfig(management, app));
        setConfigLoaded(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load App configuration.');
      } finally {
        setConfigLoading(false);
      }
    },
    [demo, demoConfigs, isHaSession, management],
  );

  const saveConfig = async (
    app: InstalledAppRecord,
    options: Record<string, unknown>,
    restartAfter: boolean,
  ) => {
    if (demo) {
      const current = demoConfigs[app.id] ?? buildDemoAppConfig(app.id);
      const updated = applyDemoConfigSave(current, options);
      setDemoConfigs((prev) => ({ ...prev, [app.id]: updated }));
      setConfigState(toAppConfigState(updated));
      setConfigLoaded(true);
      setConfigSaved(true);
      setNotice(`${app.name}: configuration saved${restartAfter ? ' and restarted' : ''}.`);
      return;
    }
    if (isHaSession || !management) return;
    setBusyAppId(app.id);
    setError('');
    setConfigSaved(false);
    try {
      await saveHubAppConfig(management, app, options, restartAfter);
      setConfigState(await loadHubAppConfig(management, app));
      setConfigLoaded(true);
      setConfigSaved(true);
      onSaved?.();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save App configuration.');
    } finally {
      setBusyAppId(null);
    }
  };

  const refreshLogs = useCallback(
    async (app: InstalledAppRecord) => {
      if (demo) {
        setLogsText(demoLogs[app.id] ?? '');
        return;
      }
      setLogsLoading(true);
      try {
        if (!isHaSession && management) {
          setLogsText(await fetchHubAppLogs(management, app.id, 400));
        } else if (isHaSession && requestRpc) {
          const payload = await requestRpc<string>({
            type: 'supervisor/api',
            endpoint: `/addons/${encodeURIComponent(app.id)}/logs`,
            method: 'get',
          });
          setLogsText(typeof payload === 'string' ? payload : '');
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not read App logs.');
      } finally {
        setLogsLoading(false);
      }
    },
    [demo, demoLogs, isHaSession, management, requestRpc],
  );

  const runAction = (app: InstalledAppRecord, action: AppActionId) => {
    if (demo) {
      const nextState = action === 'stop' ? 'stopped' : 'running';
      setInstalled((prev) =>
        prev.map((item) =>
          item.id === app.id
            ? {
                ...item,
                state: nextState,
                actions: nextState === 'running' ? ['stop', 'restart'] : ['start'],
              }
            : item,
        ),
      );
      setNotice(`${app.name}: ${action} applied.`);
      return;
    }
    setBusyAppId(app.id);
    setError('');
    const op =
      !isHaSession && management
        ? executeHubAppAction(management, app.id, action)
        : isHaSession && requestRpc
          ? requestRpc({
              type: 'supervisor/api',
              endpoint: `/addons/${encodeURIComponent(app.id)}/${action}`,
              method: 'post',
            })
          : undefined;
    if (!op) {
      setBusyAppId(null);
      return;
    }
    void op
      .then(() => {
        setNotice(`${app.name}: ${action} completed.`);
        onSaved?.();
        return load();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'App operation failed.'),
      )
      .finally(() => setBusyAppId(null));
  };

  const handleRemoveApp = (app: InstalledAppRecord) => {
    if (demo) {
      setInstalled((prev) => prev.filter((item) => item.id !== app.id));
      setCatalog((prev) =>
        prev.map((item) => (item.id === app.id ? { ...item, installed: false } : item)),
      );
      setNotice(`Removed ${app.name}.`);
      setActiveAppId(undefined);
      return;
    }
    if (isHaSession || !management) return;
    setBusyAppId(app.id);
    setError('');
    void removeHubApp(management, app.id)
      .then(() => {
        setNotice(`Removed ${app.name}.`);
        setActiveAppId(undefined);
        onSaved?.();
        return load();
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not remove App.'),
      )
      .finally(() => setBusyAppId(null));
  };

  const installCatalogApp = (entry: CatalogAppRecord) => {
    if (demo) {
      setInstalled((prev) => [
        ...prev,
        {
          id: entry.id,
          externalId: entry.id,
          name: entry.name,
          description: entry.description,
          version: entry.latestVersion,
          state: 'running',
          available: true,
          managed: true,
          actions: ['stop', 'restart'],
          logs: true,
          updateAvailable: false,
          sourceKind: 'haus-app',
        },
      ]);
      setCatalog((prev) =>
        prev.map((item) => (item.id === entry.id ? { ...item, installed: true } : item)),
      );
      setNotice(`Installed ${entry.name}.`);
      return;
    }
    setBusyAppId(entry.id);
    setError('');
    const op =
      !isHaSession && management
        ? installHubCatalogApp(management, entry.id)
        : isHaSession && requestRpc
          ? requestRpc({
              type: 'supervisor/api',
              endpoint: `/store/addons/${encodeURIComponent(entry.id)}/install`,
              method: 'post',
            })
          : undefined;
    if (!op) {
      setBusyAppId(null);
      return;
    }
    void op
      .then(() => {
        setNotice(`Installed ${entry.name}.`);
        onSaved?.();
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Install failed.'))
      .finally(() => setBusyAppId(null));
  };

  return (
    <>
      <AppsWorkspaceView
        columns={columns}
        tab={tab}
        query={query}
        filter={filter}
        filters={filterTabs}
        installedApps={visibleInstalled.map((app) => ({
          ...app,
          iconKind: isHaSession ? 'addon' : 'app',
        }))}
        totalInstalledCount={installed.length}
        catalogApps={visibleCatalog.map((entry) => ({
          ...entry,
          iconKind: isHaSession ? 'addon' : 'app',
        }))}
        catalogTabLabel={isHaSession ? 'Add-on store' : 'Catalog'}
        loading={loading}
        busyAppId={busyAppId}
        error={error || undefined}
        notice={notice || undefined}
        canManage={canManage}
        onTabChange={setTab}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onRefresh={() => void load()}
        onOpenRepositories={
          !isHaSession && (demo || management) ? () => setReposOpen(true) : undefined
        }
        onManageApp={(app) => {
          setError('');
          setLogsText(demo ? (demoLogs[app.id] ?? '') : '');
          setConfigState({ values: {}, configuredSecrets: new Set() });
          setConfigLoaded(false);
          setConfigSaved(false);
          setActiveAppId(app.id);
        }}
        onQuickToggleApp={(app, action) => runAction(app, action)}
        onInstallCatalogApp={(entry) => {
          if (entry.installed) {
            setTab('installed');
            setActiveAppId(entry.id);
            return;
          }
          installCatalogApp(entry);
        }}
      />
      {activeApp && (
        <AppDetailsModal
          app={activeApp}
          logs={logsText}
          logsLoading={logsLoading}
          canManage={canManage}
          busy={busyAppId === activeApp.id}
          error={error || undefined}
          configSlot={
            !isHaSession && (demo || management) ? (
              <AppConfigEditorPanel
                values={configState.values}
                configuredSecrets={configState.configuredSecrets}
                fieldMeta={configState.fieldMeta}
                appRunning={activeApp.state === 'running'}
                loading={configLoading}
                loaded={configLoaded}
                busy={busyAppId === activeApp.id}
                saved={configSaved}
                error={error || undefined}
                onReload={() => void loadConfig(activeApp)}
                onSave={(options, restartAfter) =>
                  void saveConfig(activeApp, options, restartAfter)
                }
              />
            ) : undefined
          }
          onAction={(action) => runAction(activeApp, action)}
          onRefreshLogs={() => void refreshLogs(activeApp)}
          onOpenConfig={() => void loadConfig(activeApp)}
          onRemove={
            !isHaSession && (demo || management) ? () => handleRemoveApp(activeApp) : undefined
          }
          onClose={() => setActiveAppId(undefined)}
        />
      )}
      <GpuiAppRepositoriesModal
        open={reposOpen}
        canManage={canManage}
        demo={demo}
        installedIds={installedIds}
        management={management}
        onOpenExternal={openExternal}
        onCatalogChanged={load}
        onClose={() => setReposOpen(false)}
      />
    </>
  );
}
