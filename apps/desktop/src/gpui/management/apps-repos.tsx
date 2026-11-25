/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useCallback, useEffect, useState } from 'react';
import {
  buildDemoAppRepositories,
  type AddonRepositorySummary,
  type ManagementPort,
} from '@haus/core/transport';
import { AppRepositoriesModal } from '@haus/ui/components';
import {
  addDemoAddonRepository,
  addHubAddonRepository,
  listHubAddonRepositories,
  reloadHubAddonRepositories,
  removeDemoAddonRepository,
  removeHubAddonRepository,
} from './apps-config.js';

export function GpuiAppRepositoriesModal({
  open,
  canManage,
  demo,
  installedIds,
  management,
  onOpenExternal,
  onCatalogChanged,
  onClose,
}: {
  readonly open: boolean;
  readonly canManage: boolean;
  readonly demo?: boolean;
  readonly installedIds: ReadonlySet<string>;
  readonly management?: ManagementPort;
  readonly onOpenExternal?: (url: string) => void;
  readonly onCatalogChanged: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const [repos, setRepos] = useState<readonly AddonRepositorySummary[]>(() =>
    demo ? buildDemoAppRepositories() : [],
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRepositories = useCallback(async () => {
    if (demo || !management) return;
    setLoading(true);
    setError('');
    try {
      setRepos(await listHubAddonRepositories(management));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load custom repositories.');
    } finally {
      setLoading(false);
    }
  }, [demo, management]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setNotice('');
    if (!demo) void loadRepositories();
  }, [demo, loadRepositories, open]);

  if (!open) return null;

  const runMutation = (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    void fn()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Repository update failed.'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <AppRepositoriesModal
      repositories={repos}
      canManage={canManage}
      loading={loading}
      busy={busy}
      error={error || undefined}
      notice={notice || undefined}
      onAdd={(url) => {
        if (demo) {
          setError('');
          setNotice('');
          try {
            const next = addDemoAddonRepository(repos, url);
            setRepos(next);
            setNotice('Custom add-on repository added and scanned.');
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not add repository.');
          }
          return;
        }
        if (!management) return;
        runMutation(async () => {
          await addHubAddonRepository(management, url);
          await loadRepositories();
          await onCatalogChanged();
          setNotice('Custom add-on repository added and scanned.');
        });
      }}
      onReloadAll={() => {
        if (demo) {
          setNotice('All custom repositories reloaded.');
          return;
        }
        if (!management) return;
        runMutation(async () => {
          await reloadHubAddonRepositories(management);
          await loadRepositories();
          await onCatalogChanged();
          setNotice('All custom repositories reloaded.');
        });
      }}
      onReload={(id) => {
        if (demo) {
          setNotice('Repository reloaded.');
          return;
        }
        if (!management) return;
        runMutation(async () => {
          await reloadHubAddonRepositories(management, id);
          await loadRepositories();
          await onCatalogChanged();
          setNotice('Repository reloaded.');
        });
      }}
      onRemove={(repo) => {
        if (demo) {
          setError('');
          setNotice('');
          try {
            const next = removeDemoAddonRepository(repos, repo, installedIds);
            setRepos(next);
            setNotice(`Removed ${repo.name}.`);
          } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not remove repository.');
          }
          return;
        }
        if (!management) return;
        runMutation(async () => {
          await removeHubAddonRepository(management, repo.id);
          await loadRepositories();
          await onCatalogChanged();
          setNotice(`Removed ${repo.name}.`);
        });
      }}
      onOpenExternal={onOpenExternal}
      onClose={onClose}
    />
  );
}
