/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useMemo, useState } from 'react';
import { Box, CheckboxInput, HausButton, SelectInput, Text } from '@haus/ui';
import { ArrowRight, Check, MoveRight } from 'lucide-react';
import { Dialog } from '@haus/ui/components';
import { deviceArea, planDeviceMoves, type DeviceMove } from '../../model/registry';
import type { Snapshot } from '../../model';
import type { MoveResult, RegistryController } from '../../ha/registry';

export function DeviceMoveDialog({
  ids,
  snapshot,
  registry,
  onClose,
  onMoved,
}: {
  ids: string[];
  snapshot: Snapshot;
  registry: RegistryController;
  onClose: () => void;
  onMoved: (ids: string[]) => void;
}) {
  const [destination, setDestination] = useState('');
  const [overrides, setOverrides] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [activePlan, setActivePlan] = useState<DeviceMove[]>([]);
  const [error, setError] = useState('');
  const [results, setResults] = useState<MoveResult[]>();
  const remaining = ids.filter(
    (id) => !results?.some((result) => result.deviceId === id && !result.error),
  );
  const prepared = useMemo(() => {
    try {
      return {
        plan: destination
          ? planDeviceMoves(
              snapshot,
              remaining,
              destination === 'none' ? null : destination,
              overrides,
            )
          : [],
        error: '',
      };
    } catch (reason) {
      return { plan: [], error: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [snapshot, destination, overrides, remaining.join(',')]);
  const plan = prepared.plan;
  const previewPlan = busy ? activePlan : plan;
  const overrideCount = snapshot.entities.filter(
    (entry) => entry.device_id && remaining.includes(entry.device_id) && entry.area_id,
  ).length;
  const roomName = (id: string | null) =>
    snapshot.areas.find((area) => area.area_id === id)?.name ?? 'Unassigned';
  const succeeded = results?.filter((result) => !result.error).length ?? 0;
  return (
    <Dialog
      title="Move devices"
      className="device-move-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text semantic="p" className="registry-help">
        Give {ids.length === 1 ? 'this device' : `${ids.length} devices`} a new place in your home.
        Review the changes before applying them.
      </Text>
      <Text semantic="label" className="management-field">
        <Text>Destination room</Text>
        <SelectInput
          ariaLabel="Destination room"
          value={destination}
          disabled={busy}
          onChange={(nextValue) => {
            setDestination(nextValue);
            setError('');
          }}
          options={[
            { value: '', label: 'Choose a room' },
            ...snapshot.areas.map((area) => ({ value: area.area_id, label: area.name })),
            { value: 'none', label: 'Unassigned · parts follow their parent' },
          ]}
        />
      </Text>
      {overrideCount > 0 && (
        <Text semantic="label" className="registry-check">
          <CheckboxInput checked={overrides} disabled={busy} onChange={setOverrides} />
          <Text>
            Move individually assigned controls too
            <Text semantic="small">
              {overrideCount} {overrideCount === 1 ? 'control has its' : 'controls have their'} own
              room. Keep these assignments unless you choose to move them.
            </Text>
          </Text>
        </Text>
      )}
      <Box className="device-move-preview" ariaLabel="Move preview">
        {previewPlan.map((item) => {
          const device = snapshot.devices.find((device) => device.id === item.deviceId);
          const after = snapshot.devices.map((device) =>
            remaining.includes(device.id) ? { ...device, area_id: item.toAreaId } : device,
          );
          return (
            <Box key={item.deviceId}>
              <Text semantic="strong">{item.name}</Text>
              <Text>
                {roomName(item.fromEffectiveAreaId)}
                <ArrowRight size={13} />
                {roomName(
                  device ? deviceArea({ ...device, area_id: item.toAreaId }, after) : item.toAreaId,
                )}
              </Text>
              {item.overrides.length > 0 && (
                <Text semantic="small">
                  {item.overrides.length} controls will follow this device
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      {destination && !plan.length && !results && !prepared.error && (
        <Text semantic="p" className="registry-help">
          These devices already use this room assignment.
        </Text>
      )}
      {results && (
        <Box className="registry-result" role="status">
          {succeeded > 0 && (
            <Text semantic="p">
              <Check size={16} />
              {succeeded} {succeeded === 1 ? 'device moved' : 'devices moved'}.
            </Text>
          )}
          {results
            .filter((result) => result.error)
            .map((result) => (
              <Text semantic="p" className="form-error" key={result.deviceId}>
                <Text semantic="strong">{result.name}</Text>: {result.error}
              </Text>
            ))}
        </Box>
      )}
      {prepared.error && (
        <Text semantic="p" role="alert" className="form-error">
          {prepared.error}
        </Text>
      )}
      {error && (
        <Text semantic="p" role="alert" className="form-error">
          {error}
        </Text>
      )}
      <Box className="registry-dialog-actions">
        <Text role="status">{busy ? `Moving ${done} of ${activePlan.length}…` : ''}</Text>
        <HausButton variant="ghost" isDisabled={busy} onPress={onClose}>
          {results ? 'Done' : 'Cancel'}
        </HausButton>
        {(!results || results.some((result) => result.error)) && (
          <HausButton
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
                  setResults((previous) => [
                    ...(previous?.filter(
                      (result) => !next.some((item) => item.deviceId === result.deviceId),
                    ) ?? []),
                    ...next,
                  ]);
                  onMoved(next.filter((result) => !result.error).map((result) => result.deviceId));
                })
                .catch((reason) => setError(reason.message))
                .finally(() => setBusy(false));
            }}
          >
            <MoveRight size={16} />
            {results
              ? 'Retry remaining'
              : !plan.length
                ? 'Move devices'
                : `Move ${plan.length === 1 ? 'device' : `${plan.length} devices`}`}
          </HausButton>
        )}
      </Box>
    </Dialog>
  );
}
