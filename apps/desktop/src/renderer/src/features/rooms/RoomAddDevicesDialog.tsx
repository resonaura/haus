/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Check, Plus, Search, X } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { planDeviceMoves, type DeviceMove } from '../../model/registry';
import { buildRoomDeviceCandidates } from './room-candidates';
import type { Area, Snapshot } from '../../model';
import type { MoveResult, RegistryController } from '../../ha/registry';
import './styles/_room-add-devices.scss';

export function RoomAddDevicesDialog({
  room,
  snapshot,
  registry,
  onClose,
  onAdded,
}: {
  room: Area;
  snapshot: Snapshot;
  registry: RegistryController;
  onClose: () => void;
  onAdded: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [overrides, setOverrides] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [activePlan, setActivePlan] = useState<DeviceMove[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<MoveResult[]>();

  const candidates = useMemo(
    () => buildRoomDeviceCandidates(snapshot, room.area_id, query),
    [snapshot, room.area_id, query],
  );
  const remaining = selected.filter(
    (id) => !results?.some((result) => result.deviceId === id && !result.error),
  );
  const prepared = useMemo(() => {
    try {
      return {
        plan: remaining.length ? planDeviceMoves(snapshot, remaining, room.area_id, overrides) : [],
        error: '',
      };
    } catch (reason) {
      return { plan: [], error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [snapshot, room.area_id, overrides, remaining.join(',')]);

  const plan = prepared.plan;
  const overrideCount = snapshot.entities.filter(
    (entry) => entry.device_id && remaining.includes(entry.device_id) && entry.area_id,
  ).length;
  const unassignedIds = candidates.filter((item) => item.currentAreaId === null).map((d) => d.id);
  const succeeded = results?.filter((result) => !result.error).length ?? 0;

  const toggle = (id: string) => {
    setError('');
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <Dialog
      title={`Add devices to ${room.name}`}
      className="device-move-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        Choose unassigned devices or move devices from another room into {room.name}.
      </p>
      <label className="management-search">
        <Search size={16} />
        <input
          aria-label="Search devices to add"
          placeholder="Search name, brand or room"
          value={query}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </label>
      <div className="room-candidate-actions">
        <span>{selected.length} selected</span>
        {unassignedIds.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onPress={() => setSelected((prev) => [...new Set([...prev, ...unassignedIds])])}
          >
            Select unassigned ({unassignedIds.length})
          </Button>
        )}
        {selected.length > 0 && (
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setSelected([])}>
            Clear
          </Button>
        )}
      </div>
      <div className="room-candidate-list" role="group" aria-label="Available devices">
        {candidates.map((item) => (
          <label className="room-candidate-row" key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              disabled={busy}
              onChange={() => toggle(item.id)}
            />
            <span className="room-candidate-info">
              <strong>{item.name}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            <span
              className={`room-candidate-badge ${item.currentAreaId === null ? 'is-unassigned' : ''}`}
            >
              {item.currentRoomName}
            </span>
          </label>
        ))}
        {!candidates.length && (
          <p className="registry-help">
            {query
              ? 'No matching devices outside this room.'
              : 'All registered devices are already in this room.'}
          </p>
        )}
      </div>
      {overrideCount > 0 && (
        <label className="registry-check">
          <input
            type="checkbox"
            checked={overrides}
            disabled={busy}
            onChange={(event) => setOverrides(event.target.checked)}
          />
          <span>
            Move individually assigned controls too
            <small>
              {overrideCount} {overrideCount === 1 ? 'control has its' : 'controls have their'} own
              room assignment.
            </small>
          </span>
        </label>
      )}
      {results && (
        <div className="registry-result" role="status">
          {succeeded > 0 && (
            <p>
              <Check size={16} />
              {succeeded} {succeeded === 1 ? 'device added' : 'devices added'} to {room.name}.
            </p>
          )}
          {results
            .filter((result) => result.error)
            .map((result) => (
              <p className="form-error" key={result.deviceId}>
                <strong>{result.name}</strong>: {result.error}
              </p>
            ))}
        </div>
      )}
      {(prepared.error || error) && (
        <p role="alert" className="form-error">
          {prepared.error || error}
        </p>
      )}
      <div className="registry-dialog-actions">
        <span role="status">{busy ? `Adding ${done} of ${activePlan.length}…` : ''}</span>
        <Button variant="ghost" isDisabled={busy} onPress={onClose}>
          {results && !results.some((r) => r.error) ? 'Done' : 'Cancel'}
        </Button>
        {(!results || results.some((result) => result.error)) && (
          <Button
            isPending={busy}
            isDisabled={busy || !plan.length}
            onPress={() => {
              setBusy(true);
              setDone(0);
              setError('');
              const currentPlan = plan;
              setActivePlan(currentPlan);
              void registry
                .moveDevices(currentPlan, (count) => setDone(count))
                .then((next) => {
                  const movedIds = next.filter((r) => !r.error).map((r) => r.deviceId);
                  setResults(next);
                  if (movedIds.length) onAdded(movedIds);
                  if (next.every((r) => !r.error)) onClose();
                })
                .catch((reason) =>
                  setError(reason instanceof Error ? reason.message : String(reason)),
                )
                .finally(() => setBusy(false));
            }}
          >
            <Plus size={16} />
            {plan.length
              ? `Add ${plan.length === 1 ? 'device' : `${plan.length} devices`}`
              : 'Add devices'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
