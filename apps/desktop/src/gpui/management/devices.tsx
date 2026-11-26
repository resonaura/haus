/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useMemo, useState } from 'react';
import {
  INVENTORY_FILTERS,
  INVENTORY_STATUS_LABELS,
  countInventoryByFilter,
  filterInventoryDevices,
  scopeInventoryDevices,
  type InventoryFilterId,
} from '@haus/core/transport';
import type { Snapshot } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import { deviceArea, planDeviceMoves } from '@haus/ha/view/registry';
import {
  DeviceInventoryView,
  DeviceMoveModal,
  RegistryDeviceModal,
  type PortableDeviceMoveItem,
  type PortableInventoryFilterTab,
  type PortableInventoryRowItem,
} from '@haus/ui/components';
import type { homeDashboard } from '../home/model.js';

export function GpuiDevicesInventoryView({
  snapshot,
  home,
  registry,
  onOpenEntity,
  onSaved,
}: {
  readonly snapshot: Snapshot;
  readonly home: ReturnType<typeof homeDashboard>;
  readonly registry?: Pick<RegistryController, 'updateDevice' | 'moveDevices'>;
  readonly onOpenEntity?: (entityId: string) => void;
  readonly onSaved?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [filter, setFilter] = useState<InventoryFilterId>('all');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [managingId, setManagingId] = useState<string | undefined>(undefined);
  const [editName, setEditName] = useState('');
  const [editAreaId, setEditAreaId] = useState('none');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [movingIds, setMovingIds] = useState<string[] | undefined>(undefined);
  const [destination, setDestination] = useState('none');
  const [moveOverrides, setMoveOverrides] = useState(true);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState('');

  const canManage = Boolean(snapshot.user.is_admin && registry);

  const areaNameById = useMemo(
    () => new Map(snapshot.areas.map((item) => [item.area_id, item.name])),
    [snapshot.areas],
  );

  const areaOptions = useMemo(
    () => [
      { value: 'all', label: 'Every room' },
      ...snapshot.areas.map((item) => ({ value: item.area_id, label: item.name })),
      { value: 'unassigned', label: 'Unassigned' },
    ],
    [snapshot.areas],
  );

  const scoped = useMemo(
    () => scopeInventoryDevices(home.inventory, { area, query }),
    [area, home.inventory, query],
  );

  const filterTabs = useMemo<PortableInventoryFilterTab[]>(() => {
    const counts = countInventoryByFilter(scoped);
    return INVENTORY_FILTERS.map((tab) => ({
      id: tab.id,
      label: tab.label,
      count: counts[tab.id],
    }));
  }, [scoped]);

  const filtered = useMemo(() => filterInventoryDevices(scoped, filter), [filter, scoped]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const items = useMemo<PortableInventoryRowItem[]>(
    () =>
      filtered.map((item) => {
        const primaryEntityId = item.accessory?.primaryEntityId;
        const matched = home.devices.find(
          (device) =>
            device.accessory.deviceId === item.id ||
            (primaryEntityId !== undefined && device.accessory.primaryEntityId === primaryEntityId),
        );
        return {
          id: item.id,
          hausId: item.hausId,
          name: item.name,
          detail:
            [item.manufacturer, item.model].filter(Boolean).join(' · ') || 'Registered device',
          roomName: areaNameById.get(item.areaId ?? '') ?? 'Unassigned',
          category: item.category,
          status: item.status,
          statusLabel: INVENTORY_STATUS_LABELS[item.status],
          activeEntityCount: item.activeEntityCount,
          entityCount: item.entityCount,
          selected: selectedSet.has(item.id),
          deviceIcon: matched?.deviceIcon ?? {
            name: item.name,
            primaryEntityId,
            category: item.category,
            manufacturer: item.manufacturer,
            model: item.model,
          },
        };
      }),
    [areaNameById, filtered, home.devices, selectedSet],
  );

  const liveEntityCount = useMemo(
    () => home.inventory.reduce((sum, item) => sum + item.activeEntityCount, 0),
    [home.inventory],
  );

  const openManage = (deviceId: string) => {
    const device = snapshot.devices.find((item) => item.id === deviceId);
    if (!device) return;
    setManagingId(device.id);
    setEditName(device.name_by_user || device.name || '');
    setEditAreaId(device.area_id ?? 'none');
    setEditError('');
  };

  const managedDevice = managingId
    ? snapshot.devices.find((item) => item.id === managingId)
    : undefined;
  const managedInventoryItem = managingId
    ? home.inventory.find((item) => item.id === managingId)
    : undefined;

  const moveAreaOptions = useMemo(
    () => [
      ...snapshot.areas.map((item) => ({ value: item.area_id, label: item.name })),
      { value: 'none', label: 'Unassigned' },
    ],
    [snapshot.areas],
  );

  const hasOverrides = useMemo(
    () =>
      Boolean(
        movingIds?.some((id) =>
          snapshot.entities.some((entry) => entry.device_id === id && Boolean(entry.area_id)),
        ),
      ),
    [movingIds, snapshot.entities],
  );

  const movePreview = useMemo<{
    readonly items: PortableDeviceMoveItem[];
    readonly error?: string;
    readonly plan: ReturnType<typeof planDeviceMoves>;
  }>(() => {
    if (!movingIds?.length) return { items: [], plan: [] };
    try {
      const targetArea = destination === 'none' ? null : destination;
      const plan = planDeviceMoves(snapshot, movingIds, targetArea, moveOverrides);
      const previewItems: PortableDeviceMoveItem[] = plan.map((move) => {
        const device = snapshot.devices.find((item) => item.id === move.deviceId);
        const effectiveAreaId =
          move.fromEffectiveAreaId ?? (device ? deviceArea(device, snapshot.devices) : null);
        return {
          deviceId: move.deviceId,
          name: move.name,
          fromRoomName: areaNameById.get(effectiveAreaId ?? '') ?? 'Unassigned',
          toRoomName: areaNameById.get(move.toAreaId ?? '') ?? 'Unassigned',
          overrideCount: move.overrides.length,
        };
      });
      return { items: previewItems, plan };
    } catch (err: unknown) {
      return {
        items: [],
        plan: [],
        error: err instanceof Error ? err.message : 'Unable to plan device move.',
      };
    }
  }, [areaNameById, destination, moveOverrides, movingIds, snapshot]);

  return (
    <>
      <DeviceInventoryView
        totalCount={home.inventory.length}
        liveEntityCount={liveEntityCount}
        query={query}
        area={area}
        areaOptions={areaOptions}
        filters={filterTabs}
        activeFilter={filter}
        items={items}
        canManage={canManage}
        selecting={selecting}
        selectedCount={selectedIds.length}
        onQueryChange={setQuery}
        onAreaChange={setArea}
        onFilterChange={setFilter}
        onToggleSelecting={() => {
          setSelecting((prev) => !prev);
          setSelectedIds([]);
        }}
        onSelectAll={() =>
          setSelectedIds((prev) => [...new Set([...prev, ...items.map((item) => item.id)])])
        }
        onMoveSelected={() => {
          if (!selectedIds.length) return;
          setDestination(snapshot.areas[0]?.area_id ?? 'none');
          setMoveOverrides(true);
          setMoveError('');
          setMovingIds([...selectedIds]);
        }}
        onToggleItem={(id) =>
          setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
          )
        }
        onOpenItem={(id) => {
          const entry = home.inventory.find((item) => item.id === id);
          if (entry?.accessory && onOpenEntity) {
            onOpenEntity(entry.accessory.primaryEntityId);
          } else {
            openManage(id);
          }
        }}
        onManageItem={openManage}
        onClearFilters={() => {
          setQuery('');
          setArea('all');
          setFilter('all');
        }}
      />

      {managedDevice && (
        <RegistryDeviceModal
          subtitle={
            [managedDevice.manufacturer, managedDevice.model].filter(Boolean).join(' · ') ||
            'Your connected device'
          }
          hausId={managedInventoryItem?.hausId ?? managedDevice.id}
          backendDeviceId={managedDevice.id}
          name={editName}
          areaId={editAreaId}
          areaOptions={[
            {
              value: 'none',
              label: managedDevice.parent_device_id ? 'Follow parent room' : 'Unassigned',
            },
            ...snapshot.areas.map((item) => ({ value: item.area_id, label: item.name })),
          ]}
          canEdit={canManage}
          busy={editBusy}
          error={editError || undefined}
          onNameChange={setEditName}
          onAreaChange={setEditAreaId}
          onClose={() => {
            if (!editBusy) setManagingId(undefined);
          }}
          onSave={() => {
            if (!registry || !editName.trim()) return;
            setEditBusy(true);
            setEditError('');
            void registry
              .updateDevice(managedDevice.id, {
                name_by_user: editName.trim(),
                area_id: editAreaId === 'none' ? null : editAreaId,
              })
              .then(() => {
                setManagingId(undefined);
                onSaved?.();
              })
              .catch((err: unknown) => {
                setEditError(err instanceof Error ? err.message : 'Unable to save device.');
              })
              .finally(() => setEditBusy(false));
          }}
        />
      )}

      {movingIds && registry && (
        <DeviceMoveModal
          deviceCount={movingIds.length}
          destination={destination}
          areaOptions={moveAreaOptions}
          hasOverrides={hasOverrides}
          moveOverrides={moveOverrides}
          plan={movePreview.items}
          busy={moveBusy}
          error={moveError || movePreview.error}
          onDestinationChange={(value) => {
            setMoveError('');
            setDestination(value);
          }}
          onToggleOverrides={() => setMoveOverrides((prev) => !prev)}
          onClose={() => {
            if (!moveBusy) setMovingIds(undefined);
          }}
          onConfirm={() => {
            if (!movePreview.plan.length) return;
            setMoveBusy(true);
            setMoveError('');
            void registry
              .moveDevices(movePreview.plan)
              .then((results) => {
                const failed = results.filter((result) => result.error);
                if (failed.length) {
                  setMoveError(failed.map((result) => `${result.name}: ${result.error}`).join(' '));
                  return;
                }
                const movedSet = new Set(movingIds);
                setSelectedIds((prev) => prev.filter((id) => !movedSet.has(id)));
                setMovingIds(undefined);
                onSaved?.();
              })
              .catch((err: unknown) => {
                setMoveError(err instanceof Error ? err.message : 'Unable to move devices.');
              })
              .finally(() => setMoveBusy(false));
          }}
        />
      )}
    </>
  );
}
