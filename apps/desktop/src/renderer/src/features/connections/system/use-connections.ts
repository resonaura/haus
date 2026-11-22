/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  nativeApi,
  supervisor,
  type AddonInfo,
  type FlowProgress,
  type IntegrationEntry,
} from '../../../ha/management';
import type { Confirmation, Repository } from '../ManagementFeedback';
import { sameFlowProgress } from './progress-poller';
import {
  createAddonActionPlan,
  type IntegrationDomainMeta,
  type RichRepairIssue,
  type UnifiedUpdateItem,
  type UnifiedUpdatesResponse,
} from './types';

interface WarmIntegrationsState {
  entries: IntegrationEntry[];
  metaByDomain: ReadonlyMap<string, IntegrationDomainMeta>;
  titles: Record<string, string>;
  progress: FlowProgress[];
  issues: RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
}

interface WarmAddonsState {
  addons: AddonInfo[];
  store: AddonInfo[];
  repositories: Repository[];
}

// Keep last known live snapshot in memory so switching tabs renders instantaneously (0ms)
// while fresh server state streams in cleanly in the background.
let warmIntegrations: WarmIntegrationsState | null = null;
let warmAddons: WarmAddonsState | null = null;

export function useConnectionsData({
  kind,
  demo,
  viewStore,
  onRefreshSnapshot,
}: {
  kind: 'integrations' | 'addons';
  demo: boolean;
  viewStore: boolean;
  onRefreshSnapshot?: () => void;
}) {
  const hasWarmIntegrations = !demo && kind === 'integrations' && warmIntegrations !== null;
  const hasWarmAddons = !demo && kind === 'addons' && warmAddons !== null;

  const [progress, setProgress] = useState<FlowProgress[]>(() =>
    hasWarmIntegrations ? warmIntegrations!.progress : [],
  );
  const [issues, setIssues] = useState<RichRepairIssue[]>(() =>
    hasWarmIntegrations ? warmIntegrations!.issues : [],
  );
  const [updates, setUpdates] = useState<UnifiedUpdatesResponse | null>(() =>
    hasWarmIntegrations ? warmIntegrations!.updates : null,
  );
  const [metaByDomain, setMetaByDomain] = useState<ReadonlyMap<string, IntegrationDomainMeta>>(
    () => (hasWarmIntegrations ? warmIntegrations!.metaByDomain : new Map()),
  );
  const [entries, setEntries] = useState<IntegrationEntry[]>(() =>
    hasWarmIntegrations ? warmIntegrations!.entries : [],
  );
  const [addons, setAddons] = useState<AddonInfo[]>(() =>
    hasWarmAddons ? warmAddons!.addons : [],
  );
  const [store, setStore] = useState<AddonInfo[]>(() => (hasWarmAddons ? warmAddons!.store : []));
  const [repositories, setRepositories] = useState<Repository[]>(() =>
    hasWarmAddons ? warmAddons!.repositories : [],
  );
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    hasWarmIntegrations ? warmIntegrations!.titles : {},
  );
  const [loading, setLoading] = useState(() =>
    demo ? false : kind === 'integrations' ? !hasWarmIntegrations : !hasWarmAddons,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdateId, setInstallingUpdateId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);

  const loadGenRef = useRef(0);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const checkingUpdatesRef = useRef(false);
  const installingUpdateRef = useRef<string | null>(null);
  const onRefreshSnapshotRef = useRef(onRefreshSnapshot);
  onRefreshSnapshotRef.current = onRefreshSnapshot;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenRef.current += 1;
    };
  }, []);

  const pretty = useCallback(
    (domain: string) => titles[domain] ?? metaByDomain.get(domain)?.name ?? domain,
    [metaByDomain, titles],
  );

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (demo) {
        setLoading(false);
        return;
      }
      const gen = ++loadGenRef.current;
      const isCurrent = () => mountedRef.current && loadGenRef.current === gen;

      const hasCachedData =
        kind === 'integrations'
          ? warmIntegrations !== null && warmIntegrations.entries.length > 0
          : warmAddons !== null &&
            (viewStore ? warmAddons.store.length > 0 : warmAddons.addons.length > 0);
      if (!silent && !hasCachedData) {
        setLoading(true);
      }
      setError('');

      try {
        if (kind === 'integrations') {
          // Stage 1 (Critical path): load only configured entries + domain metadata (~20-80ms)
          // so the Integrations grid renders immediately without waiting for slow network checks.
          const [current, metaList] = await Promise.all([
            nativeApi().request<IntegrationEntry[]>({ type: 'config_entries/get' }),
            nativeApi()
              .request<IntegrationDomainMeta[]>({ type: 'haus/integration_meta' })
              .catch(() => []),
          ]);
          if (!isCurrent()) return;

          const nextMeta = new Map(metaList.map((item) => [item.domain, item]));
          setEntries(current);
          setMetaByDomain(nextMeta);
          setLoading(false);

          warmIntegrations = {
            entries: current,
            metaByDomain: nextMeta,
            titles: warmIntegrations?.titles ?? {},
            progress: warmIntegrations?.progress ?? [],
            issues: warmIntegrations?.issues ?? [],
            updates: warmIntegrations?.updates ?? null,
          };

          // Stage 2 (Non-blocking background hydration): hydrate catalog titles, LAN discovery
          // progress, repairs, and upstream update checks independently without blocking the UI.
          void nativeApi()
            .request<Array<{ domain: string; name: string }>>({ type: 'manifest/list' })
            .then((manifests) => {
              if (!isCurrent()) return;
              const nextTitles = Object.fromEntries(manifests.map((m) => [m.domain, m.name]));
              setTitles(nextTitles);
              if (warmIntegrations) warmIntegrations = { ...warmIntegrations, titles: nextTitles };
            })
            .catch(() => undefined);

          void nativeApi()
            .request<FlowProgress[]>({ type: 'config_entries/flow/progress' })
            .then((flows) => {
              if (!isCurrent()) return;
              setProgress((prev) => (sameFlowProgress(prev, flows) ? prev : flows));
              if (warmIntegrations) warmIntegrations = { ...warmIntegrations, progress: flows };
            })
            .catch(() => undefined);

          void nativeApi()
            .request<{ issues: RichRepairIssue[] }>({ type: 'repairs/list_issues' })
            .then((repairs) => {
              if (!isCurrent()) return;
              setIssues(repairs.issues);
              if (warmIntegrations) {
                warmIntegrations = { ...warmIntegrations, issues: repairs.issues };
              }
            })
            .catch(() => undefined);

          void nativeApi()
            .request<UnifiedUpdatesResponse | null>({ type: 'haus/updates/list' })
            .then((unifiedUpdates) => {
              if (!isCurrent()) return;
              setUpdates(unifiedUpdates);
              if (warmIntegrations) {
                warmIntegrations = { ...warmIntegrations, updates: unifiedUpdates };
              }
            })
            .catch(() => undefined);
        } else {
          const current = await supervisor<{ addons: AddonInfo[] }>('/addons');
          if (!isCurrent()) return;
          setAddons(current.addons);
          warmAddons = {
            addons: current.addons,
            store: warmAddons?.store ?? [],
            repositories: warmAddons?.repositories ?? [],
          };
          if (viewStore) {
            const catalog = await supervisor<{ addons: AddonInfo[]; repositories: Repository[] }>(
              '/store',
            );
            if (!isCurrent()) return;
            setStore(catalog.addons);
            setRepositories(catalog.repositories);
            warmAddons = {
              addons: current.addons,
              store: catalog.addons,
              repositories: catalog.repositories,
            };
          }
          if (isCurrent()) setLoading(false);
        }
      } catch (e) {
        if (isCurrent()) {
          setError(e instanceof Error ? e.message : 'Could not read your server.');
          setLoading(false);
        }
      }
    },
    [kind, demo, viewStore],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const perform = useCallback(
    async (operation: () => Promise<unknown>, success = 'Changes saved.') => {
      if (busyRef.current) return;
      busyRef.current = true;
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
        await load({ silent: true });
        onRefreshSnapshotRef.current?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The operation could not be completed.');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [load],
  );

  const toggleIgnoreRepair = useCallback(
    async (repair: RichRepairIssue, ignore: boolean) => {
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
    },
    [perform],
  );

  const checkUpdates = useCallback(async () => {
    if (checkingUpdatesRef.current) return;
    checkingUpdatesRef.current = true;
    setCheckingUpdates(true);
    setError('');
    setNotice('');
    try {
      const next = await nativeApi().request<UnifiedUpdatesResponse>({
        type: 'haus/updates/check',
      });
      setUpdates(next);
      if (warmIntegrations) warmIntegrations = { ...warmIntegrations, updates: next };
      setNotice('Update status refreshed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check for updates.');
    } finally {
      checkingUpdatesRef.current = false;
      setCheckingUpdates(false);
    }
  }, []);

  const installUpdate = useCallback(
    async (item: UnifiedUpdateItem) => {
      if (installingUpdateRef.current) return;
      installingUpdateRef.current = item.id;
      setInstallingUpdateId(item.id);
      setError('');
      setNotice('');
      try {
        await nativeApi().request({ type: 'haus/updates/install', update_id: item.id });
        await load({ silent: true });
        setNotice(`Updated ${item.title}.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not update ${item.title}.`);
      } finally {
        installingUpdateRef.current = null;
        setInstallingUpdateId(null);
      }
    },
    [load],
  );

  const installAllUpdates = useCallback(
    async (items: readonly UnifiedUpdateItem[]) => {
      if (installingUpdateRef.current || items.length === 0) return;
      installingUpdateRef.current = '__batch__';
      setInstallingUpdateId('__batch__');
      setError('');
      setNotice('');
      try {
        const hacsIds = items.filter((i) => i.id.startsWith('hacs:')).map((i) => i.id);
        const otherIds = items.filter((i) => !i.id.startsWith('hacs:')).map((i) => i.id);
        if (hacsIds.length > 0)
          await nativeApi().request({ type: 'haus/updates/batch', ids: hacsIds });
        for (const id of otherIds)
          await nativeApi().request({ type: 'haus/updates/install', update_id: id });
        await load({ silent: true });
        setNotice(`Updated ${items.length} items.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not complete batch update.');
      } finally {
        installingUpdateRef.current = null;
        setInstallingUpdateId(null);
      }
    },
    [load],
  );

  const addonAction = useCallback(
    (addon: AddonInfo, action: string) => {
      const plan = createAddonActionPlan(addon, action, addons);
      if (plan.immediate) void perform(plan.operation, plan.success);
      else setConfirm(plan.confirmation);
    },
    [addons, perform],
  );

  const refreshIntegrations = useCallback(async () => {
    void nativeApi()
      .request({ type: 'haus/discovery/scan' })
      .catch(() => undefined);
    await load({ silent: true });
  }, [load]);

  const handleProgressUpdate = useCallback((next: FlowProgress[]) => {
    setProgress((prev) => (sameFlowProgress(prev, next) ? prev : next));
    if (warmIntegrations) warmIntegrations = { ...warmIntegrations, progress: next };
  }, []);

  return {
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
  };
}
