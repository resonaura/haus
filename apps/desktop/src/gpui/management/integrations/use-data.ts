/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildDemoIntegrationsState,
  filterUpdates,
  integrationFamilyKey,
  type DiscoveredFlowItem,
  type IntegrationDomainMetaRecord,
  type IntegrationEntryRecord,
  type ManagementPort,
  type RepairIssueRecord,
  type UnifiedUpdateRecord,
  type UnifiedUpdatesSummary,
} from '@haus/core/transport';
import type { PortableDiscoveredFlow } from '@haus/ui/components';
import type { GpuiRpcRequest } from '../integrations.js';
import { applyDemoUpdateInstall, parseAllFlowProgress } from './helpers.js';

export function useGpuiIntegrationsData({
  demo,
  management,
  requestRpc,
  refreshSignal = 0,
  onSaved,
}: {
  readonly demo?: boolean;
  readonly management?: ManagementPort;
  readonly requestRpc?: GpuiRpcRequest;
  readonly refreshSignal?: number;
  readonly onSaved?: () => void;
}) {
  const demoInitial = useMemo(() => (demo ? buildDemoIntegrationsState() : undefined), [demo]);
  const [entries, setEntries] = useState<readonly IntegrationEntryRecord[]>(
    () => demoInitial?.entries ?? [],
  );
  const [metaByDomain, setMetaByDomain] = useState<
    ReadonlyMap<string, IntegrationDomainMetaRecord>
  >(() => demoInitial?.metaByDomain ?? new Map());
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>(
    () => demoInitial?.titles ?? {},
  );
  const [progressFlows, setProgressFlows] = useState<readonly DiscoveredFlowItem[]>(
    () => demoInitial?.progress ?? [],
  );
  const [issues, setIssues] = useState<readonly RepairIssueRecord[]>(
    () => demoInitial?.issues ?? [],
  );
  const [updates, setUpdates] = useState<UnifiedUpdatesSummary | null>(
    () => demoInitial?.updates ?? null,
  );
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
      setProgressFlows(next.progress);
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
        .then((flows) => setProgressFlows(parseAllFlowProgress(flows)))
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

  useEffect(() => {
    if (refreshSignal > 0 && !demo) void load();
  }, [demo, load, refreshSignal]);

  const toggleIgnoreRepair = useCallback(
    (issue: RepairIssueRecord, ignore: boolean) => {
      if (demo) {
        setIssues((prev) =>
          prev.map((item) =>
            item.domain === issue.domain && item.issue_id === issue.issue_id
              ? { ...item, ignored: ignore }
              : item,
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
    },
    [demo, load, requestRpc],
  );

  const reloadEntry = (entryId: string) => {
    if (demo) {
      setNotice('Reloaded integration instance.');
      return;
    }
    if (!requestRpc && !management) return;
    setBusy(true);
    setError('');
    const req = management
      ? management.management({
          method: 'POST',
          path: `config/config_entries/entry/${encodeURIComponent(entryId)}/reload`,
        })
      : requestRpc!({ type: 'config_entries/reload', entry_id: entryId });
    void req
      .then(() => {
        setNotice('Integration reloaded.');
        onSaved?.();
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Reload failed.'))
      .finally(() => setBusy(false));
  };

  const toggleDisabled = (entryId: string, disabled: boolean) => {
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

  const deleteEntry = (entryId: string, onDomainEmpty?: (domain: string) => void) => {
    if (demo) {
      setEntries((prev) => {
        const target = prev.find((item) => item.entry_id === entryId);
        const next = prev.filter((item) => item.entry_id !== entryId);
        if (
          target &&
          !next.some(
            (item) => integrationFamilyKey(item.domain) === integrationFamilyKey(target.domain),
          )
        ) {
          onDomainEmpty?.(integrationFamilyKey(target.domain));
        }
        return next;
      });
      setNotice('Integration entry removed.');
      return;
    }
    if (!management) {
      setError('Connect your Hub to remove integration entries.');
      return;
    }
    setBusy(true);
    setError('');
    void management
      .management({
        method: 'DELETE',
        path: `config/config_entries/entry/${encodeURIComponent(entryId)}`,
      })
      .then(() => {
        setNotice('Integration entry removed.');
        onSaved?.();
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed.'))
      .finally(() => setBusy(false));
  };

  const checkUpdates = () => {
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
  };

  const installUpdate = (item: UnifiedUpdateRecord) => {
    if (demo) {
      setUpdates((prev) => applyDemoUpdateInstall(prev, item));
      setNotice(`Updated ${item.title} to ${item.latestVersion}.`);
      return;
    }
    if (!requestRpc) return;
    setInstallingId(item.id);
    void requestRpc({ type: 'haus/updates/install', update_id: item.id })
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Install failed.'))
      .finally(() => setInstallingId(null));
  };

  const installAllUpdates = (items: readonly UnifiedUpdateRecord[]) => {
    const targets = filterUpdates(items, 'available');
    if (!targets.length || demo || !requestRpc) return;
    setInstallingId('__batch__');
    void Promise.all(
      targets.map((u) => requestRpc({ type: 'haus/updates/install', update_id: u.id })),
    )
      .then(() => load())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Batch failed.'))
      .finally(() => setInstallingId(null));
  };

  const ignoreDiscovered = (item: PortableDiscoveredFlow) => {
    if (demo) {
      setProgressFlows((prev) => prev.filter((flow) => flow.flow_id !== item.flowId));
      setNotice(`Ignored ${item.deviceLabel}.`);
      return;
    }
    if (!requestRpc) return;
    setBusy(true);
    void requestRpc({ type: 'config_entries/ignore_flow', flow_id: item.flowId })
      .then(() => {
        setNotice('Discovery ignored.');
        return load();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not ignore.'))
      .finally(() => setBusy(false));
  };

  return {
    entries,
    metaByDomain,
    titles,
    progressFlows,
    issues,
    updates,
    loading,
    busy,
    checkingUpdates,
    installingId,
    error,
    notice,
    setError,
    setNotice,
    load,
    toggleIgnoreRepair,
    reloadEntry,
    toggleDisabled,
    deleteEntry,
    checkUpdates,
    installUpdate,
    installAllUpdates,
    ignoreDiscovered,
  };
}
