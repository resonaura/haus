/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Button } from '@heroui/react';
import { Box, Cable, LoaderCircle, Plus, RefreshCw, Search, Server } from 'lucide-react';
import type { AddonInfo, IntegrationEntry } from '../../../ha/management';
import type { FlowTarget } from '../IntegrationFlow';
import { SystemSummaryCards } from './SystemSummaryCards';
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
  onAdd: () => void;
}) {
  return (
    <>
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

      {kind === 'integrations' && admin && hasHacs && (
        <Button variant="secondary" className="hacs-entry" onPress={onOpenHacs}>
          <Box size={17} />
          Community · HACS
        </Button>
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
    </>
  );
}
