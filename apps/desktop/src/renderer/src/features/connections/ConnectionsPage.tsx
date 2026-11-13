/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Snapshot } from '../../model';
import {
  humanize,
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
import { ManagementFeedback, type Confirmation, type Repository } from './ManagementFeedback';
import { IntegrationsGrid, type IntegrationGroup } from './details/IntegrationsGrid';
import { entryNeedsAttention } from './integration-health';
import { AddonRepositoriesModal, AddonsGridView } from './system/AddonsGridView';
import { ConnectionsOverviewHeader } from './system/ConnectionsOverviewHeader';
import { RepairsPanel } from './system/RepairsPanel';
import { UpdatesPanel } from './system/UpdatesPanel';
import {
  INTEGRATION_NAME_OVERRIDES,
  buildAddonActionDescription,
  filterIntegrationEntries,
  type IntegrationDomainMeta,
  type RichRepairIssue,
  type UnifiedUpdateItem,
  type UnifiedUpdatesResponse,
} from './system/types';

const HacsPage = lazy(() =>
  import('../community/HacsPage').then((module) => ({ default: module.HacsPage })),
);

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
  const [progress, setProgress] = useState<FlowProgress[]>([]);
  const [issues, setIssues] = useState<RichRepairIssue[]>([]);
  const [updates, setUpdates] = useState<UnifiedUpdatesResponse | null>(null);
  const [metaByDomain, setMetaByDomain] = useState<ReadonlyMap<string, IntegrationDomainMeta>>(
    () => new Map(),
  );
  const [entries, setEntries] = useState<IntegrationEntry[]>([]);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [store, setStore] = useState<AddonInfo[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdateId, setInstallingUpdateId] = useState<string | null>(null);
  const [viewStore, setViewStore] = useState(false);
  const [repositoryDialog, setRepositoryDialog] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [community, setCommunity] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedAddon, setSelectedAddon] = useState<AddonInfo | null>(null);
  const [flow, setFlow] = useState<FlowTarget | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const admin = snapshot.user.is_admin;

  const issue = useCallback(
    (entry: IntegrationEntry) =>
      entryNeedsAttention(entry, progress) ||
      (!entry.disabled_by &&
        issues.some(
          (item) =>
            !item.ignored && (item.domain === entry.domain || item.issue_domain === entry.domain),
        )),
    [issues, progress],
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

  const pretty = useCallback(
    (domain: string) => titles[domain] ?? INTEGRATION_NAME_OVERRIDES[domain] ?? humanize(domain),
    [titles],
  );

  const load = useCallback(async () => {
    if (demo) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (kind === 'integrations') {
        const [current, manifests, flows, repairs, unifiedUpdates, metaList] = await Promise.all([
          nativeApi().request<IntegrationEntry[]>({ type: 'config_entries/get' }),
          nativeApi().request<Array<{ domain: string; name: string }>>({ type: 'manifest/list' }),
          nativeApi()
            .request<FlowProgress[]>({ type: 'config_entries/flow/progress' })
            .catch(() => []),
          nativeApi()
            .request<{ issues: RichRepairIssue[] }>({ type: 'repairs/list_issues' })
            .catch(() => ({ issues: [] })),
          nativeApi()
            .request<UnifiedUpdatesResponse | null>({ type: 'haus/updates/list' })
            .catch(() => null),
          nativeApi()
            .request<IntegrationDomainMeta[]>({ type: 'haus/integration_meta' })
            .catch(() => []),
        ]);
        setEntries(current);
        setProgress(flows);
        setIssues(repairs.issues);
        setUpdates(unifiedUpdates);
        setMetaByDomain(new Map(metaList.map((item) => [item.domain, item])));
        setTitles(Object.fromEntries(manifests.map((m) => [m.domain, m.name])));
      } else {
        const current = await supervisor<{ addons: AddonInfo[] }>('/addons');
        setAddons(current.addons);
        if (viewStore) {
          const catalog = await supervisor<{ addons: AddonInfo[]; repositories: Repository[] }>(
            '/store',
          );
          setStore(catalog.addons);
          setRepositories(catalog.repositories);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your server.');
    } finally {
      setLoading(false);
    }
  }, [kind, demo, viewStore]);

  useEffect(() => {
    setQuery('');
    setFilter('all');
    void load();
  }, [load]);

  const perform = async (operation: () => Promise<unknown>, success = 'Changes saved.') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setConfirm(null);
    try {
      const result = await operation();
      if (
        result &&
        typeof result === 'object' &&
        'require_restart' in result &&
        result.require_restart
      ) {
        setNotice('Saved. Home Assistant needs a restart to apply this change.');
      } else {
        setNotice(success);
      }
      await load();
      onRefreshSnapshot?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The operation could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const toggleIgnoreRepair = async (repair: RichRepairIssue, ignore: boolean) => {
    await perform(
      () =>
        nativeApi().request({
          type: 'repairs/ignore_issue',
          domain: repair.domain,
          issue_id: repair.issue_id,
          ignore,
        }),
      ignore ? 'Repair issue ignored.' : 'Repair issue restored.',
    );
  };

  const checkUpdates = async () => {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    setError('');
    setNotice('');
    try {
      const next = await nativeApi().request<UnifiedUpdatesResponse>({
        type: 'haus/updates/check',
      });
      setUpdates(next);
      setNotice('Update status refreshed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check for updates.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const installUpdate = async (item: UnifiedUpdateItem) => {
    if (installingUpdateId) return;
    setInstallingUpdateId(item.id);
    setError('');
    setNotice('');
    try {
      await nativeApi().request({
        type: 'haus/updates/install',
        update_id: item.id,
      });
      await load();
      setNotice(`Updated ${item.title}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update ${item.title}.`);
    } finally {
      setInstallingUpdateId(null);
    }
  };

  const filteredGroups = useMemo<IntegrationGroup[]>(
    () =>
      [...new Set(entries.map((e) => e.domain))]
        .map((domain) => ({
          domain,
          name: pretty(domain),
          entries: filterIntegrationEntries(entries, domain, filter, issue),
        }))
        .filter(
          (g) =>
            g.entries.length > 0 &&
            `${g.name} ${g.domain} ${g.entries.map((e) => e.title).join(' ')}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries, filter, issue, pretty, query],
  );

  const filteredAddons = (viewStore ? store : addons).filter(
    (a) =>
      `${a.name} ${a.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (viewStore ||
        filter === 'all' ||
        (filter === 'updates' ? a.update_available : a.state === filter)),
  );

  const addonAction = (addon: AddonInfo, action: string) => {
    const installed = addons.some((a) => a.slug === addon.slug);
    const operation = () =>
      action === 'update'
        ? nativeApi().request({ type: 'hassio/update/addon', addon: addon.slug, backup: true })
        : supervisor(
            `/addons/${addon.slug}/${action}`,
            'post',
            action === 'uninstall' ? { remove_config: false } : undefined,
          );
    if (action === 'start') {
      void perform(operation, `${addon.name} started.`);
      return;
    }
    setConfirm({
      title: `${humanize(action)} ${addon.name}?`,
      label: humanize(action),
      danger: action === 'uninstall',
      description: buildAddonActionDescription(
        action,
        installed,
        addon.version,
        addon.version_latest,
      ),
      action: operation,
    });
  };

  const showingOverview = !selectedDomain && !selectedAddon && !community;
  const openRepairFix = (repair: RichRepairIssue) =>
    setFlow({
      domain: repair.domain,
      repair: {
        domain: repair.domain,
        issue_id: repair.issue_id,
        translation_key: repair.translation_key,
      },
    });

  return (
    <div className="connections-page">
      {showingOverview && kind === 'integrations' && subView === 'repairs' && (
        <>
          <ManagementFeedback error={error} notice={notice} />
          <RepairsPanel
            issues={issues}
            busy={busy}
            onBack={() => setSubView('list')}
            onFix={openRepairFix}
            onToggleIgnore={toggleIgnoreRepair}
          />
        </>
      )}

      {showingOverview && kind === 'integrations' && subView === 'updates' && (
        <>
          <ManagementFeedback error={error} notice={notice} />
          <UpdatesPanel
            updates={updates}
            checking={checkingUpdates}
            installingId={installingUpdateId}
            onBack={() => setSubView('list')}
            onCheck={checkUpdates}
            onInstall={installUpdate}
          />
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
            progressIssuesCount={entries.filter(issue).length}
            issues={issues}
            updates={updates}
            hasHacs={entries.some((entry) => entry.domain === 'hacs')}
            onChangeQuery={setQuery}
            onChangeFilter={setFilter}
            onToggleStore={() => setViewStore((prev) => !prev)}
            onOpenRepoDialog={() => setRepositoryDialog(true)}
            onRefresh={() =>
              kind === 'addons' && admin
                ? void perform(
                    () => supervisor('/store/reload', 'post'),
                    'Add-on catalog refreshed.',
                  )
                : void load()
            }
            onOpenHacs={() => setCommunity(true)}
            onOpenFlow={setFlow}
            onOpenRepairs={() => setSubView('repairs')}
            onOpenUpdates={() => setSubView('updates')}
            onAdd={onAdd}
          />

          {!loading && !demo && kind === 'integrations' && (
            <IntegrationsGrid
              groups={filteredGroups}
              snapshot={snapshot}
              metaByDomain={metaByDomain}
              progress={progress}
              issues={issues}
              updates={updates}
              loading={loading}
              error={error}
              search={query || (filter !== 'all' ? filter : '')}
              onSelect={(domain) =>
                domain === 'hacs' ? setCommunity(true) : setSelectedDomain(domain)
              }
              onFlow={setFlow}
            />
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
                <div className="management-empty">
                  <Search size={28} />
                  <h3>No matches</h3>
                  <p>Try another name or filter.</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {community && (
        <Suspense
          fallback={
            <p role="status" className="management-loading">
              Opening community…
            </p>
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
          progress={progress}
          issues={issues.filter(
            (i) => i.domain === selectedDomain || i.issue_domain === selectedDomain,
          )}
          entries={entries.filter((e) => e.domain === selectedDomain)}
          snapshot={snapshot}
          busy={busy}
          feedback={{ error, notice }}
          onClose={() => setSelectedDomain('')}
          onFlow={setFlow}
          onChange={perform}
          onConfirm={setConfirm}
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
    </div>
  );
}
