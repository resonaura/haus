/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDemoIntegrationsState,
  countIntegrationFilters,
  filterIntegrationGroups,
  filterUpdates,
  formatIotClass,
  formatRuntimeLabel,
  groupIntegrationsByDomain,
  humanizeIdentifier,
  integrationFamilyKey,
  isIntegrationEntryIssue,
  type IntegrationDomainMetaRecord,
  type IntegrationEntryRecord,
  type IntegrationFilterId,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  IntegrationDetailsModal,
  IntegrationsOverviewView,
  RepairsPanelView,
  UpdatesPanelView,
  type PortableIntegrationCardItem,
  type PortableIntegrationEntryItem,
  type PortableIntegrationFilterTab,
} from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';
import type { GpuiAddDeviceRequest } from './add-device.js';
import { GpuiHaDataImportModal } from './ha-data-import.js';
import { GpuiHacsView } from './hacs.js';
import type { homeDashboard } from '../home/model.js';

export type GpuiRpcRequest = <T = unknown>(message: Record<string, unknown>) => Promise<T>;

export function GpuiIntegrationsView({
  snapshot,
  home,
  columns = 3,
  demo,
  requestRpc,
  openExternal,
  openPaths,
  onOpenEntity,
  onAddDevice,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly columns?: number;
  readonly demo?: boolean;
  readonly requestRpc?: GpuiRpcRequest;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onOpenEntity?: (entityId: string) => void;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly onSaved?: () => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoIntegrationsState() : undefined), [demo]);
  const [subView, setSubView] = useState<'list' | 'repairs' | 'updates' | 'hacs'>('list');
  const [haImportOpen, setHaImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<IntegrationFilterId>('all');
  const [entries, setEntries] = useState<readonly IntegrationEntryRecord[]>(
    () => demoInitial?.entries ?? [],
  );
  const [metaByDomain, setMetaByDomain] = useState<
    ReadonlyMap<string, IntegrationDomainMetaRecord>
  >(() => demoInitial?.metaByDomain ?? new Map());
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>(
    () => demoInitial?.titles ?? {},
  );
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const [issues, setIssues] = useState<readonly RepairIssueRecord[]>(
    () => demoInitial?.issues ?? [],
  );
  const [updates, setUpdates] = useState<UnifiedUpdatesSummary | null>(
    () => demoInitial?.updates ?? null,
  );
  const [selectedDomain, setSelectedDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (demo) {
      const next = buildDemoIntegrationsState();
      setEntries(next.entries);
      setMetaByDomain(next.metaByDomain);
      setTitles(next.titles);
      setDiscoveredCount(next.progress.length);
      setIssues(next.issues);
      setUpdates(next.updates);
      return;
    }
    if (!requestRpc) {
      setError('Connect to a Home Hub or enable Demo mode to view integrations.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [loadedEntries, loadedMeta] = await Promise.all([
        requestRpc<IntegrationEntryRecord[]>({ type: 'config_entries/get' }),
        requestRpc<IntegrationDomainMetaRecord[]>({ type: 'haus/integration_meta' }).catch(
          () => [],
        ),
      ]);
      setEntries(Array.isArray(loadedEntries) ? loadedEntries : []);
      setMetaByDomain(
        new Map((Array.isArray(loadedMeta) ? loadedMeta : []).map((item) => [item.domain, item])),
      );

      void requestRpc<Array<{ domain: string; name: string }>>({ type: 'manifest/list' })
        .then((manifests) => {
          if (Array.isArray(manifests)) {
            setTitles(Object.fromEntries(manifests.map((m) => [m.domain, m.name])));
          }
        })
        .catch(() => undefined);
      void requestRpc<unknown[]>({ type: 'config_entries/flow/progress' })
        .then((flows) => setDiscoveredCount(Array.isArray(flows) ? flows.length : 0))
        .catch(() => undefined);
      void requestRpc<{ issues?: RepairIssueRecord[] }>({ type: 'repairs/list_issues' })
        .then((res) => setIssues(Array.isArray(res?.issues) ? res.issues : []))
        .catch(() => undefined);
      void requestRpc<UnifiedUpdatesSummary | null>({ type: 'haus/updates/list' })
        .then((res) => setUpdates(res ?? null))
        .catch(() => undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load integrations.');
    } finally {
      setLoading(false);
    }
  }, [demo, requestRpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolveTitle = useCallback(
    (domain: string) =>
      titles[domain] ?? metaByDomain.get(domain)?.name ?? humanizeIdentifier(domain),
    [metaByDomain, titles],
  );

  const groups = useMemo(
    () => groupIntegrationsByDomain(entries, resolveTitle),
    [entries, resolveTitle],
  );

  const visibleGroups = useMemo(
    () => filterIntegrationGroups(groups, filter, query, issues),
    [filter, groups, issues, query],
  );

  const filterTabs = useMemo<PortableIntegrationFilterTab[]>(() => {
    const counts = countIntegrationFilters(entries, discoveredCount, issues);
    return [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'loaded', label: 'Connected', count: counts.loaded },
      { id: 'issues', label: 'Needs attention', count: counts.issues },
      { id: 'disabled', label: 'Disabled', count: counts.disabled },
    ];
  }, [discoveredCount, entries, issues]);

  const cards = useMemo<PortableIntegrationCardItem[]>(() => {
    return visibleGroups.map((group) => {
      const meta = metaByDomain.get(group.domain);
      const hasAttention = group.entries.some((entry) => isIntegrationEntryIssue(entry, issues));
      const hasUpdate = Boolean(
        updates?.items.some(
          (item) => item.updateAvailable && integrationFamilyKey(item.domain) === group.domain,
        ),
      );
      const first = group.entries[0]?.title ?? '';
      const second = group.entries[1]?.title ?? '';
      return {
        domain: group.domain,
        displayName: group.name,
        summary: `${group.entries.length} ${group.entries.length === 1 ? 'account' : 'accounts'}`,
        firstEntryTitle: first,
        secondEntryTitle: second,
        extraEntries: Math.max(0, group.entries.length - 2),
        entityCount: meta?.entityCount ?? 0,
        hasAttention,
        attentionLabel: 'Attention',
        hasUpdate,
        allDisabled: group.entries.every((entry) => Boolean(entry.disabled_by)),
      };
    });
  }, [issues, metaByDomain, updates?.items, visibleGroups]);

  const activeRepairCount = issues.filter((item) => !item.ignored).length;
  const availableUpdateCount = updates?.availableCount ?? 0;
  const hacsEntry = entries.find((entry) => entry.domain === 'hacs');
  const hasHacs = Boolean(
    demo || hacsEntry || updates?.items.some((item) => item.category === 'hacs'),
  );

  const selectedGroup = selectedDomain
    ? groups.find((group) => group.domain === selectedDomain)
    : undefined;
  const selectedMeta = selectedGroup ? metaByDomain.get(selectedGroup.domain) : undefined;
  const selectedEntries: PortableIntegrationEntryItem[] = (selectedGroup?.entries ?? []).map(
    (entry) => ({
      entryId: entry.entry_id,
      title: entry.title,
      domain: entry.domain,
      state: entry.state,
      disabledBy: entry.disabled_by,
      reason: entry.reason,
      canUnload: entry.supports_unload !== false,
    }),
  );

  const linkedDevices = useMemo(() => {
    if (!selectedGroup) return [];
    const ids = new Set(selectedGroup.entries.map((item) => item.entry_id));
    return snapshot.devices
      .filter(
        (device) =>
          Array.isArray(device.config_entries) && device.config_entries.some((id) => ids.has(id)),
      )
      .map((device) => ({
        id: device.id,
        name: device.name_by_user || device.name || device.id,
      }));
  }, [selectedGroup, snapshot.devices]);

  const handleReload = (entryId: string) => {
    if (demo) {
      setNotice('Reloaded integration instance.');
      return;
    }
    if (!requestRpc) return;
    setBusy(true);
    setError('');
    void requestRpc({ type: 'config_entries/reload', entry_id: entryId })
      .then(() => {
        setNotice('Integration reloaded.');
        onSaved?.();
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Reload failed.'))
      .finally(() => setBusy(false));
  };

  const handleToggleDisabled = (entryId: string, disabled: boolean) => {
    if (demo) {
      setEntries((prev) =>
        prev.map((item) =>
          item.entry_id === entryId ? { ...item, disabled_by: disabled ? 'user' : null } : item,
        ),
      );
      setNotice(disabled ? 'Integration disabled.' : 'Integration enabled.');
      return;
    }
    if (!requestRpc) return;
    setBusy(true);
    setError('');
    void requestRpc({
      type: 'config_entries/disable',
      entry_id: entryId,
      disabled_by: disabled ? 'user' : null,
    })
      .then(() => {
        setNotice(disabled ? 'Integration disabled.' : 'Integration enabled.');
        onSaved?.();
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Update failed.'))
      .finally(() => setBusy(false));
  };

  if (subView === 'repairs') {
    return (
      <RepairsPanelView
        issues={issues}
        busy={busy}
        onBack={() => setSubView('list')}
        onToggleIgnore={(issue, ignore) => {
          if (demo) {
            setIssues((prev) =>
              prev.map((item) =>
                item.issue_id === issue.issue_id ? { ...item, ignored: ignore } : item,
              ),
            );
            return;
          }
          if (!requestRpc) return;
          setBusy(true);
          void requestRpc({
            type: 'repairs/ignore_issue',
            domain: issue.domain,
            issue_id: issue.issue_id,
            ignore,
          })
            .then(() => load())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))
            .finally(() => setBusy(false));
        }}
      />
    );
  }

  if (subView === 'hacs') {
    return (
      <GpuiHacsView
        demo={demo}
        hacsEntry={
          hacsEntry
            ? { entry_id: hacsEntry.entry_id, supports_options: hacsEntry.supports_options }
            : undefined
        }
        requestRpc={requestRpc}
        onAddDevice={onAddDevice}
        openExternal={openExternal}
        onBack={() => setSubView('list')}
        onSaved={() => {
          onSaved?.();
          void load();
        }}
      />
    );
  }

  if (subView === 'updates') {
    return (
      <UpdatesPanelView
        updates={updates}
        checking={checkingUpdates}
        installingId={installingId}
        onBack={() => setSubView('list')}
        onOpenHacs={hasHacs ? () => setSubView('hacs') : undefined}
        onCheck={() => {
          if (demo) {
            setNotice('Updates checked.');
            return;
          }
          if (!requestRpc) return;
          setCheckingUpdates(true);
          void requestRpc<UnifiedUpdatesSummary>({ type: 'haus/updates/check' })
            .then((next) => setUpdates(next))
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Check failed.'))
            .finally(() => setCheckingUpdates(false));
        }}
        onInstall={(item: UnifiedUpdateRecord) => {
          if (demo) {
            setUpdates((prev) =>
              prev
                ? {
                    ...prev,
                    availableCount: Math.max(0, prev.availableCount - 1),
                    items: prev.items.map((u) =>
                      u.id === item.id
                        ? { ...u, updateAvailable: false, installedVersion: u.latestVersion }
                        : u,
                    ),
                  }
                : null,
            );
            return;
          }
          if (!requestRpc) return;
          setInstallingId(item.id);
          void requestRpc({ type: 'haus/updates/install', update_id: item.id })
            .then(() => load())
            .catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Install failed.'),
            )
            .finally(() => setInstallingId(null));
        }}
        onInstallAll={(items) => {
          const targets = filterUpdates(items, 'available');
          if (!targets.length || demo || !requestRpc) return;
          setInstallingId('__batch__');
          void Promise.all(
            targets.map((u) => requestRpc({ type: 'haus/updates/install', update_id: u.id })),
          )
            .then(() => load())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Batch failed.'))
            .finally(() => setInstallingId(null));
        }}
      />
    );
  }

  const canImportHa = Boolean(demo || (snapshot.user.is_admin && requestRpc));

  return (
    <>
      <IntegrationsOverviewView
        columns={columns}
        query={query}
        filter={filter}
        filters={filterTabs}
        cards={cards}
        discoveredCount={discoveredCount}
        repairCount={activeRepairCount}
        updateCount={availableUpdateCount}
        loading={loading}
        error={error || undefined}
        notice={notice || undefined}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onRefresh={() => void load()}
        onOpenRepairs={() => setSubView('repairs')}
        onOpenUpdates={() => setSubView('updates')}
        onOpenHacs={hasHacs ? () => setSubView('hacs') : undefined}
        onImportHa={canImportHa ? () => setHaImportOpen(true) : undefined}
        onConfigureDiscovered={onAddDevice ? () => onAddDevice({ mode: 'picker' }) : undefined}
        onAddDevice={onAddDevice ? () => onAddDevice({ mode: 'picker' }) : undefined}
        onSelectDomain={(domain) => {
          setError('');
          setNotice('');
          setSelectedDomain(domain);
        }}
      />
      {haImportOpen && (
        <GpuiHaDataImportModal
          demo={demo}
          busy={busy}
          formatDomain={resolveTitle}
          requestRpc={requestRpc}
          openPaths={openPaths}
          onClose={() => setHaImportOpen(false)}
          onComplete={() => {
            void load();
            onSaved?.();
          }}
        />
      )}
      {selectedGroup && (
        <IntegrationDetailsModal
          title={selectedGroup.name}
          runtimeLabel={formatRuntimeLabel(selectedMeta?.runtimeType)}
          iotClassLabel={formatIotClass(selectedMeta?.iotClass)}
          version={selectedMeta?.version}
          deviceNames={linkedDevices}
          entries={selectedEntries}
          canManage={Boolean(demo || snapshot.user.is_admin)}
          busy={busy}
          error={error || undefined}
          notice={notice || undefined}
          onReloadEntry={handleReload}
          onToggleDisabled={handleToggleDisabled}
          onOpenDevice={(deviceId) => {
            const inv = home.inventory.find((item) => item.id === deviceId);
            onOpenEntity?.(inv?.accessory?.primaryEntityId ?? deviceId);
          }}
          onClose={() => setSelectedDomain('')}
        />
      )}
    </>
  );
}
