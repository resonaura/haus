/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Box, Heading, Text } from '@haus/ui';
import { Search } from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  nativeApi,
  supervisor,
  type AddonInfo,
  type FlowProgress,
  type IntegrationEntry,
} from '../../ha/management';
import { AddonDetails } from './AddonDetails';
import { ConfirmDialog } from './ConfirmDialog';
import { IntegrationDetails } from './IntegrationDetails';
import { IntegrationFlow, type FlowTarget } from './IntegrationFlow';
import { ManagementFeedback } from './ManagementFeedback';
import { IntegrationsGrid } from './details/IntegrationsGrid';
import { usePendingTuyaCameras } from './flow/tuya-camera-pending';
import { entryHasIssueOrAttention } from './integration-health';
import { AddonRepositoriesModal, AddonsGridView } from './system/AddonsGridView';
import { ConnectionsOverviewHeader } from './system/ConnectionsOverviewHeader';
import { DiscoveredPanel, filterDiscoveredProgress } from './system/DiscoveredPanel';
import { HacsPage } from './system/hacs';
import { RepairsPanel } from './system/RepairsPanel';
import { UpdatesPanel } from './system/UpdatesPanel';
import {
  buildIntegrationGroups,
  buildRepairFlowTarget,
  filterAddonItems,
  type RichRepairIssue,
} from './system/types';
import { useConnectionsData } from './system/use-connections';

export function ConnectionsPage({
  kind,
  demo,
  snapshot,
  onAdd,
  initialSection,
  onOpenDevice,
  onRefreshSnapshot,
}: {
  kind: 'integrations' | 'addons';
  demo: boolean;
  snapshot: Snapshot;
  onAdd: () => void;
  openServer?: (path: string) => void;
  initialSection?: 'repairs' | 'updates' | null;
  onOpenDevice?: (deviceId: string) => void;
  onRefreshSnapshot?: () => void;
}) {
  const [subView, setSubView] = useState<'list' | 'repairs' | 'updates'>(() =>
    kind === 'integrations' ? (initialSection ?? 'list') : 'list',
  );
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState('all');
  const [viewStore, setViewStore] = useState(false);
  const [repositoryDialog, setRepositoryDialog] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [community, setCommunity] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedAddon, setSelectedAddon] = useState<AddonInfo | null>(null);
  const [flow, setFlow] = useState<FlowTarget | null>(null);

  const admin = snapshot.user.is_admin;
  const {
    progress,
    issues,
    updates,
    metaByDomain,
    entries,
    addons,
    store,
    repositories,
    titles,
    loading,
    error,
    notice,
    busy,
    checkingUpdates,
    installingUpdateId,
    confirm,
    setConfirm,
    pretty,
    load,
    perform,
    toggleIgnoreRepair,
    checkUpdates,
    installUpdate,
    installAllUpdates,
    addonAction,
    refreshIntegrations,
    handleProgressUpdate,
  } = useConnectionsData({ kind, demo, viewStore, onRefreshSnapshot });

  const { pending: pendingTuya, byEntry: tuyaByEntry } = usePendingTuyaCameras(snapshot, {
    demo,
    enabled: kind === 'integrations',
    entries,
  });

  const issue = useCallback(
    (entry: IntegrationEntry) => entryHasIssueOrAttention(entry, progress, issues, tuyaByEntry),
    [issues, progress, tuyaByEntry],
  );

  useEffect(() => {
    setCommunity(false);
    setSelectedDomain('');
    setSelectedAddon(null);
    setFlow(null);
    setRepositoryDialog(false);
    setViewStore(false);
    setSubView(kind === 'integrations' ? (initialSection ?? 'list') : 'list');
  }, [kind, initialSection]);

  useEffect(() => {
    setQuery('');
    setFilter('all');
  }, [kind, demo, viewStore]);

  const discoveredItems = useMemo(
    () => filterDiscoveredProgress(progress, deferredQuery, pretty),
    [pretty, progress, deferredQuery],
  );
  const filteredGroups = useMemo(
    () => buildIntegrationGroups(entries, filter, deferredQuery, issue, pretty),
    [entries, filter, issue, pretty, deferredQuery],
  );
  const progressIssuesCount = useMemo(
    () => entries.reduce((count, entry) => (issue(entry) ? count + 1 : count), 0),
    [entries, issue],
  );
  const filteredAddons = useMemo(
    () => filterAddonItems(viewStore ? store : addons, viewStore, filter, deferredQuery),
    [viewStore, store, addons, filter, deferredQuery],
  );

  const handleToggleStore = useCallback(() => setViewStore((prev) => !prev), []);
  const handleOpenRepoDialog = useCallback(() => setRepositoryDialog(true), []);
  const handleOpenHacs = useCallback(() => setCommunity(true), []);
  const handleOpenRepairs = useCallback(() => setSubView('repairs'), []);
  const handleOpenUpdates = useCallback(() => setSubView('updates'), []);
  const handleRefresh = useCallback(() => {
    if (kind === 'addons' && admin) {
      void perform(() => supervisor('/store/reload', 'post'), 'Add-on catalog refreshed.');
    } else if (kind === 'integrations') {
      void refreshIntegrations();
    } else {
      void load();
    }
  }, [kind, admin, perform, refreshIntegrations, load]);
  const handleSelectDomain = useCallback(
    (domain: string) => (domain === 'hacs' ? setCommunity(true) : setSelectedDomain(domain)),
    [],
  );
  const handleConfigureDiscovered = useCallback(
    (item: FlowProgress) => setFlow({ flowId: item.flow_id, domain: item.handler }),
    [],
  );
  const handleIgnoreDiscovered = useCallback(
    (item: FlowProgress) =>
      void perform(
        () => nativeApi().request({ type: 'config_entries/ignore_flow', flow_id: item.flow_id }),
        'Discovery ignored.',
      ),
    [perform],
  );
  const openRepairFix = useCallback(
    (r: RichRepairIssue) => setFlow(buildRepairFlowTarget(r, pretty(r.domain))),
    [pretty],
  );

  const showingOverview = !selectedDomain && !selectedAddon && !community;

  return (
    <Box className="connections-page">
      {showingOverview && kind === 'integrations' && subView !== 'list' && (
        <>
          <ManagementFeedback error={error} notice={notice} />
          {subView === 'repairs' ? (
            <RepairsPanel
              issues={issues}
              formatDomain={pretty}
              busy={busy}
              onBack={() => setSubView('list')}
              onFix={openRepairFix}
              onToggleIgnore={toggleIgnoreRepair}
            />
          ) : (
            <UpdatesPanel
              updates={updates}
              checking={checkingUpdates}
              installingId={installingUpdateId}
              onBack={() => setSubView('list')}
              onCheck={checkUpdates}
              onInstall={installUpdate}
              onInstallAll={installAllUpdates}
              onOpenHacs={() => {
                setSubView('list');
                setCommunity(true);
              }}
            />
          )}
        </>
      )}

      {showingOverview && (kind !== 'integrations' || subView === 'list') && (
        <>
          <ConnectionsOverviewHeader
            kind={kind}
            demo={demo}
            admin={admin}
            loading={loading}
            busy={busy}
            viewStore={viewStore}
            query={query}
            filter={filter}
            error={error}
            notice={notice}
            entries={entries}
            addons={addons}
            progressIssuesCount={progressIssuesCount}
            discoveredCount={discoveredItems.length}
            issues={issues}
            updates={updates}
            hasHacs={!demo}
            formatDomain={pretty}
            onChangeQuery={setQuery}
            onChangeFilter={setFilter}
            onToggleStore={handleToggleStore}
            onOpenRepoDialog={handleOpenRepoDialog}
            onRefresh={handleRefresh}
            onOpenHacs={handleOpenHacs}
            onOpenFlow={setFlow}
            onOpenRepairs={handleOpenRepairs}
            onOpenUpdates={handleOpenUpdates}
            onProgressUpdate={handleProgressUpdate}
            onAdd={onAdd}
          />

          {!loading && !demo && kind === 'integrations' && (
            <>
              {(filter === 'all' || filter === 'discovered') && (
                <DiscoveredPanel
                  items={discoveredItems}
                  formatDomain={pretty}
                  busy={busy}
                  emptyWhenShown={filter === 'discovered'}
                  onConfigure={handleConfigureDiscovered}
                  onIgnore={handleIgnoreDiscovered}
                />
              )}
              {filter !== 'discovered' && (
                <IntegrationsGrid
                  groups={filteredGroups}
                  devices={snapshot.devices}
                  entities={snapshot.entities}
                  admin={admin}
                  metaByDomain={metaByDomain}
                  progress={progress}
                  issues={issues}
                  updates={updates}
                  installingUpdateId={installingUpdateId}
                  loading={loading}
                  error={error}
                  hasPendingTuya={pendingTuya.length > 0}
                  search={deferredQuery || (filter !== 'all' ? filter : '')}
                  onSelect={handleSelectDomain}
                  onFlow={setFlow}
                  onInstallUpdate={installUpdate}
                />
              )}
            </>
          )}

          {!loading && !demo && kind === 'addons' && (
            <>
              <AddonsGridView
                filteredAddons={filteredAddons}
                addons={addons}
                viewStore={viewStore}
                admin={admin}
                busy={busy}
                onSelectAddon={setSelectedAddon}
                onAddonAction={addonAction}
              />
              {!filteredAddons.length && (
                <Box className="management-empty">
                  <Search size={28} />
                  <Heading level={3}>No matches</Heading>
                  <Text semantic="p">Try another name or filter.</Text>
                </Box>
              )}
            </>
          )}
        </>
      )}

      {community && (
        <Suspense
          fallback={
            <Text semantic="p" role="status" className="management-loading">
              Opening community…
            </Text>
          }
        >
          <HacsPage
            entry={entries.find((entry) => entry.domain === 'hacs')}
            onBack={() => setCommunity(false)}
            onFlow={setFlow}
          />
        </Suspense>
      )}

      {selectedDomain && (
        <IntegrationDetails
          domain={selectedDomain}
          name={pretty(selectedDomain)}
          meta={metaByDomain.get(selectedDomain)}
          updates={updates}
          installingUpdateId={installingUpdateId}
          checkingUpdates={checkingUpdates}
          progress={progress}
          issues={issues}
          entries={entries}
          snapshot={snapshot}
          busy={busy}
          feedback={{ error, notice }}
          onClose={() => setSelectedDomain('')}
          onFlow={setFlow}
          onChange={perform}
          onConfirm={setConfirm}
          onInstallUpdate={installUpdate}
          onCheckUpdates={checkUpdates}
          onOpenHacs={() => {
            setSelectedDomain('');
            setCommunity(true);
          }}
          onOpenDevice={onOpenDevice}
          onRefreshSnapshot={onRefreshSnapshot}
        />
      )}

      {selectedAddon && (
        <AddonDetails
          addon={selectedAddon}
          snapshot={snapshot}
          busy={busy}
          feedback={{ error, notice }}
          onClose={() => setSelectedAddon(null)}
          onAction={addonAction}
          onChange={perform}
          revision={addons}
        />
      )}

      {flow && (
        <IntegrationFlow
          target={flow}
          snapshot={snapshot}
          names={titles}
          onClose={() => {
            setFlow(null);
            void load();
          }}
          onDone={() => {
            void load();
            onRefreshSnapshot?.();
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          confirmation={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onConfirm={() => void perform(confirm.action, 'Operation completed.')}
        />
      )}

      {repositoryDialog && (
        <AddonRepositoriesModal
          repositories={repositories}
          repositoryUrl={repositoryUrl}
          admin={admin}
          busy={busy}
          onChangeUrl={setRepositoryUrl}
          onClose={() => setRepositoryDialog(false)}
          onPerform={perform}
          onConfirm={setConfirm}
        />
      )}
    </Box>
  );
}
