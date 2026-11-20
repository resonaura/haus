/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import {
  ArrowUpCircle,
  Box,
  Cable,
  FileUp,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import {
  humanize,
  nativeApi,
  type AddonInfo,
  type FlowProgress,
  type IntegrationEntry,
} from '../../../ha/management';
import { HaImportDialog } from '../import/dialog';
import type { FlowTarget } from '../IntegrationFlow';
import { SystemSummaryCards } from './SystemSummaryCards';
import { DiscoveryProgressPoller } from './progress-poller';
import type { RichRepairIssue, UnifiedUpdatesResponse } from './types';

export function ConnectionsOverviewHeader({
  kind,
  demo,
  admin,
  loading,
  busy,
  viewStore,
  query,
  filter,
  error,
  notice,
  entries,
  addons,
  progressIssuesCount,
  discoveredCount = 0,
  issues,
  updates,
  hasHacs,
  onChangeQuery,
  onChangeFilter,
  onToggleStore,
  onOpenRepoDialog,
  onRefresh,
  onOpenHacs,
  onOpenFlow,
  onOpenRepairs,
  onOpenUpdates,
  onProgressUpdate,
  onAdd,
}: {
  kind: 'integrations' | 'addons';
  demo: boolean;
  admin: boolean;
  loading: boolean;
  busy: boolean;
  viewStore: boolean;
  query: string;
  filter: string;
  error: string;
  notice: string;
  entries: readonly IntegrationEntry[];
  addons: readonly AddonInfo[];
  progressIssuesCount: number;
  discoveredCount?: number;
  issues: readonly RichRepairIssue[];
  updates: UnifiedUpdatesResponse | null;
  hasHacs: boolean;
  onChangeQuery: (value: string) => void;
  onChangeFilter: (value: string) => void;
  onToggleStore: () => void;
  onOpenRepoDialog: () => void;
  onRefresh: () => void;
  onOpenHacs: () => void;
  onOpenFlow: (target: FlowTarget) => void;
  onOpenRepairs: () => void;
  onOpenUpdates: () => void;
  onProgressUpdate: (progress: FlowProgress[]) => void;
  onAdd: () => void;
}) {
  const [haImportOpen, setHaImportOpen] = useState(false);

  return (
    <>
      <DiscoveryProgressPoller
        active={kind === 'integrations' && !demo}
        onProgress={onProgressUpdate}
      />
      <div className="management-intro">
        <span className="management-intro-icon">
          {kind === 'integrations' ? <Cable size={25} /> : <Box size={25} />}
        </span>
        <div>
          <strong>
            {kind === 'integrations'
              ? 'Everything speaks the same language.'
              : viewStore
                ? 'More possibilities for your home.'
                : 'The services behind your home.'}
          </strong>
          <p>
            {kind === 'integrations'
              ? 'Connect, configure and manage your integrations here.'
              : 'Install, configure and maintain the services on your server.'}
          </p>
        </div>
        <div className="management-actions">
          <Button
            variant="secondary"
            isDisabled={!admin || demo}
            onPress={() => (kind === 'integrations' ? onOpenFlow({}) : onToggleStore())}
          >
            <Plus size={16} />
            {kind === 'integrations'
              ? 'Add integration'
              : viewStore
                ? 'Installed add-ons'
                : 'Add-on store'}
          </Button>
          {kind === 'integrations' && admin && !demo && (
            <>
              <Button variant="secondary" isDisabled={busy} onPress={onOpenUpdates}>
                <ArrowUpCircle size={16} />
                {updates && updates.availableCount > 0
                  ? `Updates (${updates.availableCount})`
                  : 'Updates'}
              </Button>
              {hasHacs && (
                <Button variant="secondary" isDisabled={busy} onPress={onOpenHacs}>
                  <Box size={16} />
                  Community · HACS
                </Button>
              )}
              <Button variant="secondary" isDisabled={busy} onPress={() => setHaImportOpen(true)}>
                <FileUp size={16} />
                Import HA data
              </Button>
            </>
          )}
        </div>
      </div>

      {kind === 'integrations' && !loading && !demo && (
        <SystemSummaryCards
          issues={issues}
          updates={updates}
          onOpenRepairs={onOpenRepairs}
          onFixRepair={(repair) =>
            onOpenFlow({
              domain: repair.domain,
              repair: {
                domain: repair.domain,
                issue_id: repair.issue_id,
                translation_key: repair.translation_key,
              },
            })
          }
          onOpenUpdates={onOpenUpdates}
        />
      )}

      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label={`Search ${kind}`}
            placeholder={`Search ${viewStore ? 'add-on store' : kind}…`}
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
          />
        </label>
        {viewStore && (
          <Button variant="ghost" onPress={onOpenRepoDialog}>
            Repositories
          </Button>
        )}
        <button className="refresh-button" disabled={loading || busy} onClick={onRefresh}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {!viewStore && (
        <div className="filter-tabs">
          {(kind === 'integrations'
            ? [
                { id: 'all', label: 'All', count: entries.length },
                { id: 'discovered', label: 'Discovered', count: discoveredCount },
                {
                  id: 'loaded',
                  label: 'Connected',
                  count: entries.filter((e) => e.state === 'loaded').length,
                },
                { id: 'issues', label: 'Needs attention', count: progressIssuesCount },
                {
                  id: 'disabled',
                  label: 'Disabled',
                  count: entries.filter((e) => e.disabled_by).length,
                },
              ]
            : [
                { id: 'all', label: 'Installed', count: addons.length },
                {
                  id: 'started',
                  label: 'Running',
                  count: addons.filter((a) => a.state === 'started').length,
                },
                {
                  id: 'stopped',
                  label: 'Stopped',
                  count: addons.filter((a) => a.state === 'stopped').length,
                },
                {
                  id: 'updates',
                  label: 'Updates',
                  count: addons.filter((a) => a.update_available).length,
                },
              ]
          ).map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? 'selected' : ''}
              aria-pressed={filter === f.id}
              onClick={() => onChangeFilter(f.id)}
            >
              {f.label}
              <span>{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="management-error">
          <strong>Could not complete the request</strong>
          <p>{error}</p>
          <button className="text-link" onClick={onRefresh}>
            Try again
            <RefreshCw size={14} />
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="management-notice">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status" className="management-busy">
          <LoaderCircle size={14} className="spin" />
          Applying changes on your server…
        </p>
      )}
      {loading && (
        <div role="status" className="management-loading">
          <LoaderCircle className="spin" size={23} />
          Reading your server…
        </div>
      )}
      {demo && (
        <div className="management-empty">
          <Server size={30} />
          <h3>Connect your home</h3>
          <p>Your live integrations and add-ons will appear here.</p>
          <Button onPress={onAdd}>Connect Home Assistant</Button>
        </div>
      )}
      {haImportOpen && (
        <HaImportDialog
          busy={busy}
          formatDomain={humanize}
          onClose={() => setHaImportOpen(false)}
          onImport={(entry) => nativeApi().request({ type: 'ha/config_entries/import', entry })}
          onComplete={onRefresh}
        />
      )}
    </>
  );
}
