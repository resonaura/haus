/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MonitorSmartphone,
  MoreVertical,
  Pencil,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Trash2,
  Power,
} from 'lucide-react';
import type { Device, Snapshot } from '../../../model';
import {
  humanize,
  nativeApi,
  rest,
  type FlowProgress,
  type IntegrationEntry,
} from '../../../ha/management';
import { entryNeedsAttention } from '../integration-health';
import type { FlowTarget } from '../IntegrationFlow';
import type { Confirmation } from '../ManagementFeedback';
import { deviceEntityCount, entryDevicesForEntry } from '../system/types';
import { tuyaPendingCopy, type TuyaPendingCamera } from '../flow/tuya-camera-pending';

export function IntegrationEntryCard({
  entry,
  snapshot,
  progress,
  searchQuery,
  busy,
  pendingTuyaByDevice,
  onFlow,
  onChange,
  onConfirm,
  onEditDevice,
  onOpenDevice,
  onFinishTuyaSetup,
}: {
  entry: IntegrationEntry;
  snapshot: Snapshot;
  progress: readonly FlowProgress[];
  searchQuery: string;
  busy: boolean;
  pendingTuyaByDevice?: ReadonlyMap<string, TuyaPendingCamera>;
  onFlow: (target: FlowTarget) => void;
  onChange: (operation: () => Promise<unknown>, success?: string) => Promise<void>;
  onConfirm: (confirmation: Confirmation) => void;
  onEditDevice: (device: Device) => void;
  onOpenDevice?: (deviceId: string) => void;
  onFinishTuyaSetup?: (pending: TuyaPendingCamera) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const admin = snapshot.user.is_admin;
  const attention = entryNeedsAttention(entry, [...progress]);
  const failed =
    !entry.disabled_by &&
    (['setup_error', 'migration_error', 'setup_retry', 'failed_unload'].includes(entry.state) ||
      Boolean(entry.reason));

  const linkedDevices = entryDevicesForEntry(entry, snapshot);
  const hasPendingTuya =
    entry.domain === 'tuya' && linkedDevices.some((dev) => pendingTuyaByDevice?.has(dev.id));
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleDevices = normalizedQuery
    ? linkedDevices.filter((dev) => {
        const name = (dev.name_by_user || dev.name || dev.id).toLowerCase();
        const model = String(dev.model ?? '').toLowerCase();
        return name.includes(normalizedQuery) || model.includes(normalizedQuery);
      })
    : linkedDevices;

  const entryMatchesQuery =
    !normalizedQuery ||
    entry.title.toLowerCase().includes(normalizedQuery) ||
    visibleDevices.length > 0;

  if (!entryMatchesQuery) return null;

  const areaNameFor = (areaId?: string | null) =>
    areaId ? snapshot.areas.find((a) => a.area_id === areaId)?.name : undefined;

  return (
    <article className={`integration-entry-card ${failed ? 'is-error' : ''}`}>
      <div className="integration-entry-head">
        <button
          type="button"
          className="integration-entry-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <span className="integration-entry-title">{entry.title}</span>
          {entry.disabled_by && <span className="status-badge">Disabled</span>}
          {!entry.disabled_by && !failed && (attention || hasPendingTuya) && (
            <span className="attention-pill">{attention ? 'Attention' : 'Setup incomplete'}</span>
          )}
        </button>

        {admin && (
          <div className="integration-entry-icons" ref={menuRef}>
            {entry.supports_options !== false && (
              <button
                type="button"
                className="icon-action-btn"
                title="Configure options"
                aria-label={`Options for ${entry.title}`}
                disabled={busy}
                onClick={() =>
                  onFlow({ domain: entry.domain, entryId: entry.entry_id, kind: 'options' })
                }
              >
                <Settings size={17} />
              </button>
            )}
            <button
              type="button"
              className="icon-action-btn"
              title="Entry actions"
              aria-label={`Actions for ${entry.title}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <MoreVertical size={17} />
            </button>

            {menuOpen && (
              <div className="entry-overflow-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onFlow({
                      domain: entry.domain,
                      entryId: entry.entry_id,
                      reconfigure: true,
                    });
                  }}
                >
                  <SlidersHorizontal size={14} />
                  Reconfigure
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onChange(
                      () =>
                        rest(
                          'POST',
                          `config/config_entries/entry/${encodeURIComponent(entry.entry_id)}/reload`,
                        ),
                      'Integration reloaded.',
                    );
                  }}
                >
                  <RefreshCw size={14} />
                  Reload
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onChange(
                      () =>
                        nativeApi().request({
                          type: 'config_entries/disable',
                          entry_id: entry.entry_id,
                          disabled_by: entry.disabled_by ? null : 'user',
                        }),
                      entry.disabled_by ? 'Integration enabled.' : 'Integration disabled.',
                    );
                  }}
                >
                  <Power size={14} />
                  {entry.disabled_by ? 'Enable' : 'Disable'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onConfirm({
                      title: `Delete ${entry.title}`,
                      description: 'This removes the integration entry and its saved credentials.',
                      label: 'Delete',
                      danger: true,
                      action: () =>
                        rest(
                          'DELETE',
                          `config/config_entries/entry/${encodeURIComponent(entry.entry_id)}`,
                        ),
                    });
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {failed && (
        <div className="integration-entry-error" role="alert">
          <AlertCircle size={17} />
          <span>
            <strong>Failed to set up:</strong> {entry.reason || humanize(entry.state)}
          </span>
        </div>
      )}

      {expanded && (
        <div className="integration-entry-devices">
          {visibleDevices.length === 0 ? (
            <p className="integration-entry-empty">
              {normalizedQuery
                ? 'No matching devices in this entry.'
                : 'No devices reported by this entry yet.'}
            </p>
          ) : (
            visibleDevices.map((device) => {
              const displayName = device.name_by_user || device.name || device.id;
              const areaName = areaNameFor(device.area_id);
              const entitiesCount = deviceEntityCount(device.id, snapshot);
              const metaParts = [
                device.model || undefined,
                areaName || undefined,
                `${entitiesCount} ${entitiesCount === 1 ? 'entity' : 'entities'}`,
              ].filter(Boolean);
              const pendingCamera = !entry.disabled_by
                ? pendingTuyaByDevice?.get(device.id)
                : undefined;
              const pendingCopy = pendingCamera ? tuyaPendingCopy(pendingCamera.reason) : undefined;

              return (
                <div
                  key={device.id}
                  className={`integration-device-row ${pendingCamera ? 'is-setup-incomplete' : ''}`}
                >
                  <button
                    type="button"
                    className="integration-device-main"
                    onClick={() => (onOpenDevice ? onOpenDevice(device.id) : onEditDevice(device))}
                  >
                    <span className="integration-device-icon">
                      <MonitorSmartphone size={18} />
                    </span>
                    <span className="integration-device-copy">
                      <strong>{displayName}</strong>
                      <small>{metaParts.join(' · ')}</small>
                      {pendingCopy && (
                        <span className="integration-device-warning" title={pendingCopy.detail}>
                          <AlertTriangle size={12} />
                          {pendingCopy.badge}
                        </span>
                      )}
                    </span>
                    <ChevronRight size={16} className="integration-device-arrow" />
                  </button>
                  {(admin || (pendingCamera && onFinishTuyaSetup)) && (
                    <div className="integration-device-actions">
                      {admin && pendingCamera && pendingCopy && onFinishTuyaSetup && (
                        <Button
                          size="sm"
                          className="finish-setup-pill"
                          onPress={() => onFinishTuyaSetup(pendingCamera)}
                        >
                          {pendingCopy.action}
                        </Button>
                      )}
                      {admin && (
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`Edit ${displayName}`}
                          title="Edit name or area"
                          onClick={() => onEditDevice(device)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </article>
  );
}
