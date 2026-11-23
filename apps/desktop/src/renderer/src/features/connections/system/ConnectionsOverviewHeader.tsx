/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { Box as UiBox, HausButton, Heading, Pressable, Text, TextInput } from '@haus/ui';
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

export const ConnectionsOverviewHeader = memo(function ConnectionsOverviewHeader({
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
  formatDomain = (domain) => domain,
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
  formatDomain?: (domain: string) => string;
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

  const handleFixRepair = useCallback(
    (repair: RichRepairIssue) =>
      onOpenFlow({
        domain: repair.domain,
        title: formatDomain(repair.domain),
        repair: {
          domain: repair.domain,
          issue_id: repair.issue_id,
          translation_key: repair.translation_key,
        },
      }),
    [formatDomain, onOpenFlow],
  );

  const filterTabs = useMemo(() => {
    if (kind === 'integrations') {
      let loadedCount = 0;
      let disabledCount = 0;
      for (const entry of entries) {
        if (entry.state === 'loaded') loadedCount += 1;
        if (entry.disabled_by) disabledCount += 1;
      }
      return [
        { id: 'all', label: 'All', count: entries.length },
        { id: 'discovered', label: 'Discovered', count: discoveredCount },
        { id: 'loaded', label: 'Connected', count: loadedCount },
        { id: 'issues', label: 'Needs attention', count: progressIssuesCount },
        { id: 'disabled', label: 'Disabled', count: disabledCount },
      ];
    }
    let startedCount = 0;
    let stoppedCount = 0;
    let updatesCount = 0;
    for (const addon of addons) {
      if (addon.state === 'started') startedCount += 1;
      else if (addon.state === 'stopped') stoppedCount += 1;
      if (addon.update_available) updatesCount += 1;
    }
    return [
      { id: 'all', label: 'Installed', count: addons.length },
      { id: 'started', label: 'Running', count: startedCount },
      { id: 'stopped', label: 'Stopped', count: stoppedCount },
      { id: 'updates', label: 'Updates', count: updatesCount },
    ];
  }, [kind, entries, addons, discoveredCount, progressIssuesCount]);

  return (
    <>
      <DiscoveryProgressPoller
        active={kind === 'integrations' && !demo}
        onProgress={onProgressUpdate}
      />
      <UiBox className="management-intro">
        <Text className="management-intro-icon">
          {kind === 'integrations' ? <Cable size={25} /> : <Box size={25} />}
        </Text>
        <UiBox>
          <Text semantic="strong">
            {kind === 'integrations'
              ? 'Everything speaks the same language.'
              : viewStore
                ? 'More possibilities for your home.'
                : 'The services behind your home.'}
          </Text>
          <Text semantic="p">
            {kind === 'integrations'
              ? 'Connect, configure and manage your integrations here.'
              : 'Install, configure and maintain the services on your server.'}
          </Text>
        </UiBox>
        <UiBox className="management-actions">
          <HausButton
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
          </HausButton>
          {kind === 'integrations' && admin && !demo && (
            <>
              <HausButton variant="secondary" isDisabled={busy} onPress={onOpenUpdates}>
                <ArrowUpCircle size={16} />
                {updates && updates.availableCount > 0
                  ? `Updates (${updates.availableCount})`
                  : 'Updates'}
              </HausButton>
              {hasHacs && (
                <HausButton variant="secondary" isDisabled={busy} onPress={onOpenHacs}>
                  <Box size={16} />
                  Community · HACS
                </HausButton>
              )}
              <HausButton
                variant="secondary"
                isDisabled={busy}
                onPress={() => setHaImportOpen(true)}
              >
                <FileUp size={16} />
                Import HA data
              </HausButton>
            </>
          )}
        </UiBox>
      </UiBox>

      {kind === 'integrations' && !loading && !demo && (
        <SystemSummaryCards
          issues={issues}
          updates={updates}
          formatDomain={formatDomain}
          onOpenRepairs={onOpenRepairs}
          onFixRepair={handleFixRepair}
          onOpenUpdates={onOpenUpdates}
        />
      )}

      <UiBox className="management-toolbar">
        <Text semantic="label" className="management-search">
          <Search size={17} />
          <TextInput
            ariaLabel={`Search ${kind}`}
            placeholder={`Search ${viewStore ? 'add-on store' : kind}…`}
            value={query}
            onChange={onChangeQuery}
          />
        </Text>
        {viewStore && (
          <HausButton variant="ghost" onPress={onOpenRepoDialog}>
            Repositories
          </HausButton>
        )}
        <Pressable className="refresh-button" disabled={loading || busy} onPress={onRefresh}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh
        </Pressable>
      </UiBox>

      {!viewStore && (
        <UiBox className="filter-tabs">
          {filterTabs.map((f) => (
            <Pressable
              key={f.id}
              className={filter === f.id ? 'selected' : ''}
              ariaPressed={filter === f.id}
              onPress={() => onChangeFilter(f.id)}
            >
              {f.label}
              <Text>{f.count}</Text>
            </Pressable>
          ))}
        </UiBox>
      )}

      {error && (
        <UiBox role="alert" className="management-error">
          <Text semantic="strong">Could not complete the request</Text>
          <Text semantic="p">{error}</Text>
          <Pressable className="text-link" onPress={onRefresh}>
            Try again
            <RefreshCw size={14} />
          </Pressable>
        </UiBox>
      )}
      {notice && (
        <Text semantic="p" role="status" className="management-notice">
          {notice}
        </Text>
      )}
      {busy && (
        <Text semantic="p" role="status" className="management-busy">
          <LoaderCircle size={14} className="spin" />
          Applying changes on your server…
        </Text>
      )}
      {loading && (
        <UiBox role="status" className="management-loading">
          <LoaderCircle className="spin" size={23} />
          Reading your server…
        </UiBox>
      )}
      {demo && (
        <UiBox className="management-empty">
          <Server size={30} />
          <Heading level={3}>Connect your home</Heading>
          <Text semantic="p">Your live integrations and apps will appear here.</Text>
          <HausButton onPress={onAdd}>Connect Haus Hub</HausButton>
        </UiBox>
      )}
      {haImportOpen && (
        <HaImportDialog
          busy={busy}
          formatDomain={formatDomain}
          onClose={() => setHaImportOpen(false)}
          onImport={(entry) => nativeApi().request({ type: 'ha/config_entries/import', entry })}
          onComplete={onRefresh}
        />
      )}
    </>
  );
});
