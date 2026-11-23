/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, HausButton, Pressable, Text } from '@haus/ui';
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
import { resolveDeviceHausId, type Device, type Snapshot } from '../../../model';
import { HausIdCode } from '../../../components/ui/haus-id';
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
        const hausId = resolveDeviceHausId(dev, snapshot).toLowerCase();
        return (
          name.includes(normalizedQuery) ||
          model.includes(normalizedQuery) ||
          hausId.includes(normalizedQuery) ||
          dev.id.toLowerCase().includes(normalizedQuery)
        );
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
    <Box semantic="article" className={`integration-entry-card ${failed ? 'is-error' : ''}`}>
      <Box className="integration-entry-head">
        <Pressable
          className="integration-entry-toggle"
          ariaExpanded={expanded}
          onPress={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <Text className="integration-entry-title">{entry.title}</Text>
          {entry.disabled_by && <Text className="status-badge">Disabled</Text>}
          {!entry.disabled_by && !failed && (attention || hasPendingTuya) && (
            <Text className="attention-pill">{attention ? 'Attention' : 'Setup incomplete'}</Text>
          )}
        </Pressable>

        {admin && (
          <Box
            className="integration-entry-icons"
            boxRef={(node) => {
              menuRef.current = node instanceof HTMLDivElement ? node : null;
            }}
          >
            {entry.supports_options !== false && (
              <Pressable
                className="icon-action-btn"
                title="Configure options"
                ariaLabel={`Options for ${entry.title}`}
                disabled={busy}
                onPress={() =>
                  onFlow({ domain: entry.domain, entryId: entry.entry_id, kind: 'options' })
                }
              >
                <Settings size={17} />
              </Pressable>
            )}
            <Pressable
              className="icon-action-btn"
              title="Entry actions"
              ariaLabel={`Actions for ${entry.title}`}
              ariaExpanded={menuOpen}
              onPress={() => setMenuOpen((prev) => !prev)}
            >
              <MoreVertical size={17} />
            </Pressable>

            {menuOpen && (
              <Box className="entry-overflow-menu" role="menu">
                <Pressable
                  role="menuitem"
                  onPress={() => {
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
                </Pressable>
                <Pressable
                  role="menuitem"
                  onPress={() => {
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
                </Pressable>
                <Pressable
                  role="menuitem"
                  onPress={() => {
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
                </Pressable>
                <Pressable
                  role="menuitem"
                  className="is-danger"
                  onPress={() => {
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
                </Pressable>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {failed && (
        <Box className="integration-entry-error" role="alert">
          <AlertCircle size={17} />
          <Text>
            <Text semantic="strong">Failed to set up:</Text> {entry.reason || humanize(entry.state)}
          </Text>
        </Box>
      )}

      {expanded && (
        <Box className="integration-entry-devices">
          {visibleDevices.length === 0 ? (
            <Text semantic="p" className="integration-entry-empty">
              {normalizedQuery
                ? 'No matching devices in this entry.'
                : 'No devices reported by this entry yet.'}
            </Text>
          ) : (
            visibleDevices.map((device) => {
              const displayName = device.name_by_user || device.name || device.id;
              const hausId = resolveDeviceHausId(device, snapshot);
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
                <Box
                  key={device.id}
                  className={`integration-device-row ${pendingCamera ? 'is-setup-incomplete' : ''}`}
                >
                  <Pressable
                    className="integration-device-main"
                    onPress={() => (onOpenDevice ? onOpenDevice(device.id) : onEditDevice(device))}
                  >
                    <Text className="integration-device-icon">
                      <MonitorSmartphone size={18} />
                    </Text>
                    <Text className="integration-device-copy">
                      <Text semantic="strong">{displayName}</Text>
                      <Text semantic="small">{metaParts.join(' · ')}</Text>
                      <Text semantic="small" className="haus-id-inline">
                        <HausIdCode value={hausId} />
                      </Text>
                      {pendingCopy && (
                        <Text className="integration-device-warning" title={pendingCopy.detail}>
                          <AlertTriangle size={12} />
                          {pendingCopy.badge}
                        </Text>
                      )}
                    </Text>
                    <ChevronRight size={16} className="integration-device-arrow" />
                  </Pressable>
                  {(admin || (pendingCamera && onFinishTuyaSetup)) && (
                    <Box className="integration-device-actions">
                      {admin && pendingCamera && pendingCopy && onFinishTuyaSetup && (
                        <HausButton
                          size="sm"
                          className="finish-setup-pill"
                          onPress={() => onFinishTuyaSetup(pendingCamera)}
                        >
                          {pendingCopy.action}
                        </HausButton>
                      )}
                      {admin && (
                        <Pressable
                          className="icon-action-btn"
                          ariaLabel={`Edit ${displayName}`}
                          title="Edit name or area"
                          onPress={() => onEditDevice(device)}
                        >
                          <Pencil size={15} />
                        </Pressable>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })
          )}
        </Box>
      )}
    </Box>
  );
}
