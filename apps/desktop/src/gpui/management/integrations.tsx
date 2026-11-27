/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useMemo, useState } from 'react';
import {
  buildRepairFlowTarget,
  countIntegrationFilters,
  filterIntegrationGroups,
  groupIntegrationsByDomain,
  humanizeIdentifier,
  type IntegrationFilterId,
  type ManagementPort,
  type RepairIssueRecord,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import {
  IntegrationsOverviewView,
  RepairsPanelView,
  UpdatesPanelView,
  type PortableIntegrationFilterTab,
} from '@haus/ui/components';
import type { GpuiPlatform } from '../platform.js';
import type { GpuiAddDeviceRequest } from './add-device.js';
import { GpuiHaDataImportModal } from './ha-data-import.js';
import { GpuiHacsView } from './hacs.js';
import { GpuiIntegrationDetailView } from './integrations/detail.js';
import { buildGpuiDiscoveredItems, buildGpuiIntegrationCards } from './integrations/helpers.js';
import { useGpuiIntegrationsData } from './integrations/use-data.js';
import type { homeDashboard } from '../home/model.js';

export type GpuiRpcRequest = <T = unknown>(message: Record<string, unknown>) => Promise<T>;

export function GpuiIntegrationsView({
  snapshot,
  home,
  columns = 3,
  demo,
  management,
  requestRpc,
  refreshSignal = 0,
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
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly refreshSignal?: number;
  readonly openExternal?: (url: string) => Promise<void>;
  readonly openPaths?: GpuiPlatform['openPaths'];
  readonly onOpenEntity?: (entityId: string) => void;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly onSaved?: () => void;
}) {
  const [subView, setSubView] = useState<'list' | 'repairs' | 'updates' | 'hacs'>('list');
  const [haImportOpen, setHaImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<IntegrationFilterId>('all');
  const [selectedDomain, setSelectedDomain] = useState('');

  const data = useGpuiIntegrationsData({
    demo,
    management,
    requestRpc,
    refreshSignal,
    onSaved,
  });

  const resolveTitle = useCallback(
    (domain: string) =>
      data.titles[domain] ?? data.metaByDomain.get(domain)?.name ?? humanizeIdentifier(domain),
    [data.metaByDomain, data.titles],
  );

  const groups = useMemo(
    () => groupIntegrationsByDomain(data.entries, resolveTitle),
    [data.entries, resolveTitle],
  );
  const visibleGroups = useMemo(
    () => filterIntegrationGroups(groups, filter, query, data.issues),
    [data.issues, filter, groups, query],
  );
  const discoveredItems = useMemo(
    () => buildGpuiDiscoveredItems(data.progressFlows, query, resolveTitle),
    [data.progressFlows, query, resolveTitle],
  );
  const allDiscoveredItems = useMemo(
    () => buildGpuiDiscoveredItems(data.progressFlows, '', resolveTitle),
    [data.progressFlows, resolveTitle],
  );
  const filterTabs = useMemo<PortableIntegrationFilterTab[]>(() => {
    const counts = countIntegrationFilters(data.entries, discoveredItems.length, data.issues);
    return [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'discovered', label: 'Discovered', count: counts.discovered },
      { id: 'loaded', label: 'Connected', count: counts.loaded },
      { id: 'issues', label: 'Needs attention', count: counts.issues },
      { id: 'disabled', label: 'Disabled', count: counts.disabled },
    ];
  }, [data.entries, data.issues, discoveredItems.length]);

  const cards = useMemo(
    () =>
      buildGpuiIntegrationCards(
        visibleGroups,
        data.metaByDomain,
        data.issues,
        data.updates,
        data.progressFlows,
      ),
    [data.issues, data.metaByDomain, data.progressFlows, data.updates, visibleGroups],
  );

  const activeRepairCount = data.issues.filter((item) => !item.ignored).length;
  const availableUpdateCount = data.updates?.availableCount ?? 0;
  const hacsEntry = data.entries.find((entry) => entry.domain === 'hacs');
  const hasHacs = Boolean(
    demo || hacsEntry || data.updates?.items.some((item) => item.category === 'hacs'),
  );
  const canManage = Boolean(demo || snapshot.user.is_admin);
  const canImportHa = Boolean(demo || (snapshot.user.is_admin && requestRpc));

  const openExternalUrl = useCallback(
    (url: string) => {
      if (openExternal) void openExternal(url).catch(() => undefined);
    },
    [openExternal],
  );

  const openRepairFix = useCallback(
    (issue: RepairIssueRecord) => {
      if (!onAddDevice) return;
      onAddDevice({
        mode: 'flow',
        target: buildRepairFlowTarget(issue, resolveTitle(issue.domain)),
      });
    },
    [onAddDevice, resolveTitle],
  );

  if (subView === 'repairs') {
    return (
      <RepairsPanelView
        issues={data.issues}
        busy={data.busy}
        canManage={canManage}
        formatDomain={resolveTitle}
        onBack={() => setSubView('list')}
        onFix={onAddDevice ? openRepairFix : undefined}
        onOpenExternal={openExternal ? openExternalUrl : undefined}
        onToggleIgnore={data.toggleIgnoreRepair}
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
          void data.load();
        }}
      />
    );
  }

  if (subView === 'updates') {
    return (
      <UpdatesPanelView
        updates={data.updates}
        checking={data.checkingUpdates}
        installingId={data.installingId}
        onBack={() => setSubView('list')}
        onOpenHacs={hasHacs ? () => setSubView('hacs') : undefined}
        onCheck={data.checkUpdates}
        onInstall={data.installUpdate}
        onInstallAll={data.installAllUpdates}
      />
    );
  }

  const selectedGroup = selectedDomain
    ? groups.find((group) => group.domain === selectedDomain)
    : undefined;

  if (selectedGroup) {
    return (
      <GpuiIntegrationDetailView
        group={selectedGroup}
        meta={data.metaByDomain.get(selectedGroup.domain)}
        snapshot={snapshot}
        home={home}
        progressFlows={data.progressFlows}
        issues={data.issues}
        allDiscovered={allDiscoveredItems}
        updates={data.updates}
        installingId={data.installingId}
        canManage={canManage}
        hasHacs={hasHacs}
        busy={data.busy}
        error={data.error || undefined}
        notice={data.notice || undefined}
        onBack={() => setSelectedDomain('')}
        onAddDevice={onAddDevice}
        onReloadEntry={data.reloadEntry}
        onToggleDisabled={data.toggleDisabled}
        onDeleteEntry={(entryId) =>
          data.deleteEntry(entryId, (emptyDomain) => {
            if (emptyDomain === selectedDomain) setSelectedDomain('');
          })
        }
        onFixRepair={onAddDevice ? openRepairFix : undefined}
        onToggleIgnoreRepair={data.toggleIgnoreRepair}
        onInstallUpdate={data.installUpdate}
        onOpenHacs={() => {
          setSelectedDomain('');
          setSubView('hacs');
        }}
        onOpenExternal={openExternal ? openExternalUrl : undefined}
        onOpenEntity={onOpenEntity}
      />
    );
  }

  return (
    <>
      <IntegrationsOverviewView
        columns={columns}
        query={query}
        filter={filter}
        filters={filterTabs}
        cards={cards}
        discoveredItems={discoveredItems}
        discoveredCount={discoveredItems.length}
        issues={data.issues}
        updates={data.updates}
        repairCount={activeRepairCount}
        updateCount={availableUpdateCount}
        canManage={canManage}
        loading={data.loading}
        busy={data.busy}
        installingUpdateId={data.installingId}
        error={data.error || undefined}
        notice={data.notice || undefined}
        formatDomain={resolveTitle}
        onQueryChange={setQuery}
        onFilterChange={setFilter}
        onRefresh={() => void data.load()}
        onOpenRepairs={() => setSubView('repairs')}
        onFixRepair={
          onAddDevice
            ? (issue) => {
                if (issue.is_fixable !== false) openRepairFix(issue);
                else setSubView('repairs');
              }
            : undefined
        }
        onOpenUpdates={() => setSubView('updates')}
        onInstallUpdate={data.installUpdate}
        onOpenHacs={hasHacs ? () => setSubView('hacs') : undefined}
        onImportHa={canImportHa ? () => setHaImportOpen(true) : undefined}
        onConfigureDiscoveredItem={
          onAddDevice
            ? (item) =>
                onAddDevice({
                  mode: 'flow',
                  target: {
                    flowId: item.flowId,
                    domain: item.handler,
                    title: item.integrationTitle,
                  },
                })
            : undefined
        }
        onIgnoreDiscoveredItem={data.ignoreDiscovered}
        onConfigureDiscovered={onAddDevice ? () => onAddDevice({ mode: 'picker' }) : undefined}
        onAddDevice={onAddDevice ? () => onAddDevice({ mode: 'picker' }) : undefined}
        onSelectDomain={(domain) => {
          data.setError('');
          data.setNotice('');
          if (domain === 'hacs' && hasHacs) setSubView('hacs');
          else setSelectedDomain(domain);
        }}
      />
      {haImportOpen && (
        <GpuiHaDataImportModal
          demo={demo}
          busy={data.busy}
          formatDomain={resolveTitle}
          requestRpc={requestRpc}
          openPaths={openPaths}
          onClose={() => setHaImportOpen(false)}
          onComplete={() => {
            void data.load();
            onSaved?.();
          }}
        />
      )}
    </>
  );
}
