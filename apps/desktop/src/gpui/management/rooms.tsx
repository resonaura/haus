/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  buildRoomDeviceCandidates,
  mergeRoomIcons,
  ROOM_ICON_OPTIONS,
} from '@haus/core/transport';
import type { Area, Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import type { Preferences } from '@haus/ha/view/preferences';
import { deviceArea, planDeviceMoves } from '@haus/ha/view/registry';
import {
  RoomAddDevicesModal,
  RoomDeleteModal,
  RoomNameEditor,
  RoomsManagerView,
  UI_ICONS,
  type PortableRoomCardItem,
  type PortableRoomIconChoice,
  type UiIconName,
} from '@haus/ui/components';
import { roomIcon } from '../home/navigation.js';

function asIconName(name: string): UiIconName {
  return Object.hasOwn(UI_ICONS, name) ? (name as UiIconName) : 'house';
}

const iconChoices: readonly PortableRoomIconChoice[] = ROOM_ICON_OPTIONS.map((item) => ({
  id: item.id,
  label: item.label,
  iconName: asIconName(item.icon),
}));

export function GpuiRoomsView({
  snapshot,
  preferences,
  columns,
  registry,
  onPreferencesPatch,
  onOpenRoom,
  onOpenDevices,
}: {
  readonly snapshot: Snapshot;
  readonly preferences: Preferences;
  readonly columns: number;
  readonly registry?: Pick<RegistryController, 'saveRoom' | 'deleteRoom' | 'moveDevices'>;
  readonly onPreferencesPatch?: (patch: Partial<Preferences>) => void;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onOpenDevices: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Area | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Area | undefined>(undefined);
  const [addingDevices, setAddingDevices] = useState<Area | undefined>(undefined);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const canManage = Boolean(snapshot.user.is_admin && registry);
  const mergedIcons = useMemo(
    () => mergeRoomIcons(snapshot.areas, preferences.roomIcons),
    [preferences.roomIcons, snapshot.areas],
  );

  const deviceAreaById = useMemo(
    () => (device: { readonly id: string }) => {
      const full = snapshot.devices.find((d) => d.id === device.id);
      return full ? deviceArea(full, snapshot.devices) : null;
    },
    [snapshot.devices],
  );

  const unassignedCount = useMemo(
    () => snapshot.devices.filter((device) => !deviceArea(device, snapshot.devices)).length,
    [snapshot.devices],
  );

  const rooms = useMemo<PortableRoomCardItem[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    return snapshot.areas
      .filter((area) => area.name.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((area) => {
        const iconId = mergedIcons[area.area_id] ?? 'auto';
        const deviceCount = snapshot.devices.filter(
          (device) => deviceArea(device, snapshot.devices) === area.area_id,
        ).length;
        return {
          id: area.area_id,
          name: area.name,
          iconId,
          iconName: roomIcon(area.name, iconId),
          deviceCount,
        };
      });
  }, [mergedIcons, query, snapshot.areas, snapshot.devices]);

  const candidates = useMemo(() => {
    if (!addingDevices) return [];
    return buildRoomDeviceCandidates(
      snapshot.devices,
      snapshot.areas,
      deviceAreaById,
      addingDevices.area_id,
      candidateQuery,
    ).map((item) => ({
      ...item,
      selected: selectedDeviceIds.has(item.id),
    }));
  }, [addingDevices, candidateQuery, deviceAreaById, selectedDeviceIds, snapshot.areas, snapshot.devices]);

  const roomById = (roomId: string) => snapshot.areas.find((a) => a.area_id === roomId);

  return (
    <>
      <RoomsManagerView
        rooms={rooms}
        iconOptions={iconChoices}
        columns={columns}
        query={query}
        unassignedCount={unassignedCount}
        canManage={canManage}
        hasAnyRooms={snapshot.areas.length > 0}
        onQueryChange={setQuery}
        onCreateRoom={() => setEditing(null)}
        onOpenDevices={onOpenDevices}
        onOpenRoom={onOpenRoom}
        onChangeIcon={(roomId, iconId) =>
          onPreferencesPatch?.({ roomIcons: { ...preferences.roomIcons, [roomId]: iconId } })
        }
        onAddDevices={(roomId) => {
          const target = roomById(roomId);
          if (!target) return;
          setCandidateQuery('');
          setSelectedDeviceIds(new Set());
          setModalError('');
          setAddingDevices(target);
        }}
        onEditRoom={(roomId) => {
          const target = roomById(roomId);
          if (target) setEditing(target);
        }}
        onDeleteRoom={(roomId) => {
          const target = roomById(roomId);
          if (!target) return;
          setModalError('');
          setDeleting(target);
        }}
      />

      {editing !== undefined && registry && (
        <RoomNameEditor
          initialName={editing?.name}
          portable
          onClose={() => setEditing(undefined)}
          onSave={async (name) => {
            const saved = await registry.saveRoom(name, editing?.area_id);
            setEditing(undefined);
            if (!editing) onOpenRoom(saved.area_id);
          }}
        />
      )}

      {addingDevices && registry && (
        <RoomAddDevicesModal
          roomName={addingDevices.name}
          query={candidateQuery}
          candidates={candidates}
          selectedCount={selectedDeviceIds.size}
          busy={busy}
          error={modalError}
          onQueryChange={setCandidateQuery}
          onToggleCandidate={(id) =>
            setSelectedDeviceIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onClose={() => setAddingDevices(undefined)}
          onConfirm={() => {
            if (!selectedDeviceIds.size) return;
            setBusy(true);
            setModalError('');
            let plan: ReturnType<typeof planDeviceMoves>;
            try {
              plan = planDeviceMoves(snapshot, [...selectedDeviceIds], addingDevices.area_id, true);
            } catch (err: unknown) {
              setBusy(false);
              setModalError(err instanceof Error ? err.message : 'Could not move devices.');
              return;
            }
            if (!plan.length) {
              setBusy(false);
              setAddingDevices(undefined);
              return;
            }
            void registry
              .moveDevices(plan)
              .then((results) => {
                const failed = results.filter((r) => r.error);
                if (failed.length) {
                  setModalError(failed.map((f) => `${f.name}: ${f.error}`).join(' '));
                  return;
                }
                setAddingDevices(undefined);
              })
              .catch((err: unknown) =>
                setModalError(err instanceof Error ? err.message : 'Could not move devices.'),
              )
              .finally(() => setBusy(false));
          }}
        />
      )}

      {deleting && registry && (
        <RoomDeleteModal
          roomName={deleting.name}
          busy={busy}
          error={modalError}
          onClose={() => setDeleting(undefined)}
          onConfirm={() => {
            setBusy(true);
            setModalError('');
            void registry
              .deleteRoom(deleting.area_id)
              .then(() => setDeleting(undefined))
              .catch((err: unknown) =>
                setModalError(err instanceof Error ? err.message : 'Could not remove room.'),
              )
              .finally(() => setBusy(false));
          }}
        />
      )}
    </>
  );
}
