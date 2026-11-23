/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { ExternalLink, FolderGit2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { nativeApi } from '../../ha/management';
import { appRequest, record } from './api';

export interface AddonRepositorySummary {
  readonly id: string;
  readonly url: string;
  readonly branch?: string;
  readonly name: string;
  readonly maintainer?: string;
  readonly infoUrl?: string;
  readonly addonIds: readonly string[];
  readonly updatedAt: string;
}

export function parseAddonRepositories(raw: unknown): AddonRepositorySummary[] {
  if (!record(raw) || !Array.isArray(raw.repositories)) return [];
  const out: AddonRepositorySummary[] = [];
  for (const item of raw.repositories) {
    if (!record(item) || typeof item.id !== 'string' || typeof item.url !== 'string') continue;
    const addonIds = Array.isArray(item.addonIds)
      ? item.addonIds.filter((v): v is string => typeof v === 'string')
      : [];
    out.push({
      id: item.id,
      url: item.url,
      ...(typeof item.branch === 'string' ? { branch: item.branch } : {}),
      name: typeof item.name === 'string' && item.name ? item.name : item.url,
      ...(typeof item.maintainer === 'string' ? { maintainer: item.maintainer } : {}),
      ...(typeof item.infoUrl === 'string' ? { infoUrl: item.infoUrl } : {}),
      addonIds,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    });
  }
  return out;
}

export function formatAddonRepositoryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  if (raw.includes('addon_repository_is_hacs_repo')) {
    return 'This is a HACS integration repository, not a Home Assistant Add-on repository. Add it under Integrations → Custom repository or Community (HACS).';
  }
  if (raw.includes('invalid_addon_repository_missing_repository_yaml')) {
    return 'Not a valid Home Assistant Add-on repository: root repository.yaml or repository.json was not found.';
  }
  if (raw.includes('addon_repository_already_exists')) {
    return 'This add-on repository is already added.';
  }
  if (raw.includes('addon_repository_in_use:')) {
    const slugs = raw.split('addon_repository_in_use:')[1]?.trim() ?? '';
    return `Cannot remove this repository while its add-ons are installed (${slugs}). Uninstall them first.`;
  }
  if (
    raw.includes('unsupported_addon_repository_host') ||
    raw.includes('invalid_addon_repository_url')
  ) {
    return 'Enter a valid GitHub repository URL (e.g. https://github.com/owner/repository or https://github.com/owner/repository#branch).';
  }
  if (raw.includes('addon_repository_not_found')) {
    return 'Repository was not found on GitHub. Check the URL and ensure the repository is public.';
  }
  if (raw.includes('github_rate_limited')) {
    return 'GitHub API rate limit reached. Please wait a minute and try again.';
  }
  return raw || 'Could not update custom add-on repositories.';
}

export function CustomRepositoriesDialog({
  admin,
  onClose,
  onChanged,
}: {
  admin: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [repositories, setRepositories] = useState<AddonRepositorySummary[]>([]);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await appRequest('GET', 'apps/repositories');
      setRepositories(parseAddonRepositories(res));
      setError('');
    } catch (reason) {
      setError(formatAddonRepositoryError(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await appRequest('POST', 'apps/repositories', { url: url.trim() });
      setUrl('');
      await load();
      await onChanged();
      setNotice('Custom add-on repository added and scanned.');
    } catch (reason) {
      setError(formatAddonRepositoryError(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleReload = async (id?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const path = id ? `apps/repositories/${id}/reload` : 'apps/repositories/reload';
      await appRequest('POST', path, {});
      await load();
      await onChanged();
      setNotice(id ? 'Repository reloaded.' : 'All custom repositories reloaded.');
    } catch (reason) {
      setError(formatAddonRepositoryError(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (repo: AddonRepositorySummary) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await appRequest('POST', `apps/repositories/${repo.id}/remove`, {});
      await load();
      await onChanged();
      setNotice(`Removed ${repo.name}.`);
    } catch (reason) {
      setError(formatAddonRepositoryError(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add-on Repositories"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="flow-description">
        Add Home Assistant Supervisor-compatible add-on repositories (containing{' '}
        <code>repository.yaml</code> and add-on <code>config.yaml</code> manifests). Append{' '}
        <code>#branch</code> to track a specific branch.
      </p>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="management-notice">
          {notice}
        </p>
      )}

      {admin && (
        <form className="management-action-row" onSubmit={(e) => void handleAdd(e)}>
          <label className="management-field" style={{ flex: 1 }}>
            <span>Repository URL</span>
            <input
              value={url}
              required
              disabled={busy}
              placeholder="https://github.com/owner/addon-repository"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" isPending={busy} isDisabled={busy}>
            <Plus size={15} />
            Add
          </Button>
        </form>
      )}

      <div className="management-action-row">
        <strong style={{ flex: 1 }}>Custom repositories ({repositories.length})</strong>
        {admin && repositories.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            isDisabled={busy || loading}
            onPress={() => void handleReload()}
          >
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            Reload all
          </Button>
        )}
      </div>

      {loading && <p className="management-hint">Loading custom repositories…</p>}
      {!loading && repositories.length === 0 && (
        <p className="management-hint">
          No custom add-on repositories added yet. Paste a GitHub URL above to add one.
        </p>
      )}

      <div className="addon-list">
        {repositories.map((repo) => (
          <article key={repo.id} className="addon-card">
            <span className="addon-glyph">
              <FolderGit2 size={22} />
            </span>
            <div className="addon-copy">
              <div>
                <h3>{repo.name}</h3>
                <div className="native-app-badges">
                  <span className="status-pill">
                    {repo.addonIds.length} {repo.addonIds.length === 1 ? 'add-on' : 'add-ons'}
                  </span>
                  {repo.branch && <span className="status-pill">#{repo.branch}</span>}
                </div>
              </div>
              <p>{repo.url}</p>
              {repo.maintainer && <small>Maintainer: {repo.maintainer}</small>}
            </div>
            <div className="addon-actions">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Open ${repo.name}`}
                onPress={() =>
                  void nativeApi()
                    .openExternal(repo.infoUrl || repo.url.replace(/#.*$/, ''))
                    .catch(() => {})
                }
              >
                <ExternalLink size={14} />
              </Button>
              {admin && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={busy}
                    aria-label={`Reload ${repo.name}`}
                    onPress={() => void handleReload(repo.id)}
                  >
                    <RefreshCw size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    isDisabled={busy}
                    aria-label={`Remove ${repo.name}`}
                    onPress={() => void handleRemove(repo)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </Dialog>
  );
}
