/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowLeft, Search } from 'lucide-react';
import { type FlowProgress, type IntegrationEntry } from '../../ha/management';
import type { Device, Snapshot } from '../../model';
import type { FlowTarget } from './IntegrationFlow';
import { ManagementFeedback, type Confirmation } from './ManagementFeedback';
import { DeviceQuickEditDialog } from './details/DeviceQuickEditDialog';
import { IntegrationAttentionList } from './details/IntegrationAttentionList';
import { IntegrationEntryCard } from './details/IntegrationEntryCard';
import { IntegrationHeader } from './details/IntegrationHeader';
import {
  computeIntegrationStats,
  entryDevicesForEntry,
  type IntegrationDomainMeta,
  type RichRepairIssue,
} from './system/types';

export function IntegrationDetails({
  domain,
  name,
  meta,
  entries,
  snapshot,
  busy,
  onClose,
  onFlow,
  onChange,
  onConfirm,
  onOpenDevice,
  onRefreshSnapshot,
  feedback,
  progress,
  issues,
}: {
  domain?: string;
  name: string;
  meta?: IntegrationDomainMeta;
  progress: FlowProgress[];
  issues: RichRepairIssue[];
  entries: IntegrationEntry[];
  snapshot: Snapshot;
  busy: boolean;
  onClose: () => void;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  onOpenDevice?: (deviceId: string) => void;
  onRefreshSnapshot?: () => void;
  feedback: { error: string; notice: string };
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const entriesRef = useRef<HTMLDivElement>(null);

  const admin = snapshot.user.is_admin;
  const effectiveDomain = domain ?? entries[0]?.domain ?? meta?.domain ?? '';
  const stats = useMemo(
    () => computeIntegrationStats(effectiveDomain, entries, snapshot, meta),
    [effectiveDomain, entries, snapshot, meta],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasMatches = useMemo(() => {
    if (!normalizedQuery) return entries.length > 0;
    return entries.some((entry) => {
      if (entry.title.toLowerCase().includes(normalizedQuery)) return true;
      return entryDevicesForEntry(entry, snapshot).some((dev) => {
        const label = (dev.name_by_user || dev.name || dev.id).toLowerCase();
        const model = String(dev.model ?? '').toLowerCase();
        return label.includes(normalizedQuery) || model.includes(normalizedQuery);
      });
    });
  }, [entries, normalizedQuery, snapshot]);

  return (
    <div className="connection-detail-page">
      <Button variant="ghost" className="connection-back" onPress={onClose}>
        <ArrowLeft size={17} />
        Integrations
      </Button>

      <IntegrationHeader
        domain={effectiveDomain}
        name={name}
        meta={meta}
        deviceCount={stats.deviceCount}
        entityCount={stats.entityCount}
        canAdd={admin && Boolean(effectiveDomain)}
        onAdd={() => onFlow({ domain: effectiveDomain })}
        onFocusEntries={() =>
          entriesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      />

      <ManagementFeedback {...feedback} />

      <label className="management-search integration-detail-search">
        <Search size={16} />
        <input
          type="search"
          aria-label="Search integration entries or devices"
          placeholder="Search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </label>

      <IntegrationAttentionList
        name={name}
        entries={entries}
        progress={progress}
        issues={issues}
        admin={admin}
        onFlow={onFlow}
      />

      <div ref={entriesRef}>
        <h3 className="integration-section-label">
          {entries.length === 1 && !normalizedQuery ? 'Devices' : 'Integration entries'}
        </h3>
        <div className="integration-entries-stack">
          {entries.map((entry) => (
            <IntegrationEntryCard
              key={entry.entry_id}
              entry={entry}
              snapshot={snapshot}
              progress={progress}
              searchQuery={searchQuery}
              busy={busy}
              onFlow={onFlow}
              onChange={onChange}
              onConfirm={onConfirm}
              onEditDevice={setEditingDevice}
              onOpenDevice={onOpenDevice}
            />
          ))}
          {normalizedQuery && !hasMatches && (
            <p className="integration-entry-empty">
              No entries or devices match &ldquo;{searchQuery.trim()}&rdquo;.
            </p>
          )}
        </div>
      </div>

      {editingDevice && (
        <DeviceQuickEditDialog
          device={editingDevice}
          snapshot={snapshot}
          onClose={() => setEditingDevice(null)}
          onSaved={() => {
            setEditingDevice(null);
            onRefreshSnapshot?.();
            void onChange(async () => undefined, 'Device settings saved.');
          }}
        />
      )}
    </div>
  );
}
