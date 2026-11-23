/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, HausButton, Heading, Pressable, SelectInput, Text, TextInput } from '@haus/ui';
import {
  AlertTriangle,
  Plus,
  Radio,
  Search,
  Server,
  X,
  CheckSquare,
  MoveRight,
} from 'lucide-react';
import type { HausAccessory, Snapshot } from '../../model';
import { buildInventory } from '../../model/inventory';
import { InventoryRow } from './InventoryRow';
import { DeviceMoveDialog } from './DeviceMoveDialog';
import { RegistryDeviceDialog } from './RegistryDeviceDialog';
import { TuyaCameraResumeModal } from './flow/TuyaCameraResumeModal';
import {
  tuyaPendingCopy,
  usePendingTuyaCameras,
  type TuyaPendingCamera,
} from './flow/tuya-camera-pending';
import type { RegistryController } from '../../ha/registry';

export function DeviceInventory({
  snapshot,
  accessories,
  onOpen,
  onAdd,
  registry,
  notify,
  initialArea,
}: {
  snapshot: Snapshot;
  accessories: HausAccessory[];
  onOpen: (a: HausAccessory) => void;
  onAdd: () => void;
  registry: RegistryController;
  notify: (message: string) => void;
  initialArea?: string;
}) {
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [moving, setMoving] = useState<string[]>();
  const [managing, setManaging] = useState<string>();
  const [filter, setFilter] = useState('all');
  const [area, setArea] = useState(initialArea ?? 'all');
  const [finishCameraTarget, setFinishCameraTarget] = useState<TuyaPendingCamera | null>(null);
  const {
    pending: pendingTuya,
    byDevice: pendingTuyaByDevice,
    refresh: refreshPendingTuya,
  } = usePendingTuyaCameras(snapshot);
  useEffect(() => {
    if (filter === 'needs_setup' && pendingTuya.length === 0) setFilter('all');
  }, [filter, pendingTuya.length]);
  const inventory = useMemo(() => buildInventory(snapshot, accessories), [snapshot, accessories]);
  const filters = [
    { id: 'all', label: 'All devices' },
    ...(pendingTuya.length > 0 ? [{ id: 'needs_setup', label: 'Needs setup' }] : []),
    { id: 'network', label: 'Network' },
    { id: 'printers', label: 'Printers' },
    { id: 'unavailable', label: 'Unavailable' },
    { id: 'no_entities', label: 'No live entities' },
  ];
  const matchesFilter = (device: (typeof inventory)[number], activeFilter: string) =>
    activeFilter === 'all' ||
    (activeFilter === 'needs_setup' && pendingTuyaByDevice.has(device.id)) ||
    device.category === activeFilter ||
    device.status === activeFilter;
  const scoped = inventory.filter(
    (device) =>
      (area === 'all' || (device.areaId ?? 'unassigned') === area) &&
      `${device.name} ${device.manufacturer} ${device.model} ${device.hausId} ${device.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const items = scoped.filter((device) => matchesFilter(device, filter));
  const managed = snapshot.devices.find((device) => device.id === managing);
  const firstPending = pendingTuya[0];
  const firstPendingCopy = firstPending ? tuyaPendingCopy(firstPending.reason) : undefined;
  return (
    <Box className="inventory-page">
      <Box className="inventory-summary">
        <Text>
          <Server size={19} />
          <Text semantic="strong">{inventory.length}</Text> registered devices
        </Text>
        <Text>
          <Radio size={17} />
          <Text semantic="strong">{snapshot.states.length}</Text> live entities
        </Text>
        <Text className="inventory-note">Includes hidden, disabled and diagnostic devices</Text>
      </Box>
      <Box className="management-toolbar">
        <Text semantic="label" className="management-search">
          <Search size={17} />
          <TextInput
            ariaLabel="Search all devices"
            placeholder="Search name, brand or model"
            value={query}
            onChange={setQuery}
          />
          {query && (
            <Pressable ariaLabel="Clear device search" onPress={() => setQuery('')}>
              <X size={15} />
            </Pressable>
          )}
        </Text>
        <SelectInput
          ariaLabel="Filter devices by room"
          value={area}
          onChange={setArea}
          options={[
            { value: 'all', label: 'Every room' },
            ...snapshot.areas.map((a) => ({ value: a.area_id, label: a.name })),
            { value: 'unassigned', label: 'Unassigned' },
          ]}
        />
      </Box>
      {snapshot.user.is_admin && (
        <Box className="inventory-selection-bar">
          <HausButton
            variant="ghost"
            onPress={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          >
            <CheckSquare size={16} />
            {selecting ? 'Cancel selection' : 'Select devices'}
          </HausButton>
          {selecting && (
            <>
              <HausButton
                variant="ghost"
                isDisabled={!items.length}
                onPress={() =>
                  setSelected((previous) => [
                    ...new Set([...previous, ...items.map((item) => item.id)]),
                  ])
                }
              >
                Select all shown
              </HausButton>
              <Text role="status">
                {selected.length} selected
                {selected.some((id) => !items.some((item) => item.id === id))
                  ? ' · includes filtered devices'
                  : ''}
              </Text>
              <HausButton
                variant="secondary"
                isDisabled={!selected.length}
                onPress={() => setMoving([...selected])}
              >
                <MoveRight size={16} />
                Move to room
              </HausButton>
            </>
          )}
        </Box>
      )}
      <Box className="filter-tabs" ariaLabel="Device filters">
        {filters.map((item) => (
          <Pressable
            key={item.id}
            ariaPressed={filter === item.id}
            className={filter === item.id ? 'selected' : ''}
            onPress={() => setFilter(item.id)}
          >
            {item.label}
            <Text>{scoped.filter((d) => matchesFilter(d, item.id)).length}</Text>
          </Pressable>
        ))}
      </Box>
      {firstPending && firstPendingCopy && (
        <Box className="inventory-tuya-banner" role="region" ariaLabel="Pending Tuya camera setup">
          <Box className="inventory-tuya-banner-copy">
            <AlertTriangle size={18} />
            <Box>
              <Text semantic="strong">
                {firstPending.reason === 'bridge_session_expired'
                  ? pendingTuya.length === 1
                    ? `${firstPending.deviceName} · Tuya session expired`
                    : `${pendingTuya.length} Tuya cameras need QR reconnect`
                  : pendingTuya.length === 1
                    ? `You have 1 camera in Tuya (${firstPending.deviceName}) — finish setup`
                    : `You have ${pendingTuya.length} cameras in Tuya — finish setup`}
              </Text>
              <Text>{firstPendingCopy.detail}</Text>
            </Box>
          </Box>
          {snapshot.user.is_admin && (
            <HausButton
              size="sm"
              className="attention-reconfigure-pill"
              onPress={() => setFinishCameraTarget(firstPending)}
            >
              {firstPendingCopy.action}
            </HausButton>
          )}
        </Box>
      )}
      <Box className="inventory-table" role="table" ariaLabel="Registered devices">
        <Box className="inventory-table-head" role="row">
          <Text role="columnheader">DEVICE</Text>
          <Text role="columnheader">ROOM</Text>
          <Text role="columnheader">DATA STATUS</Text>
          <Text role="columnheader">ENTITIES</Text>
          <Text />
        </Box>
        {items.map((device) => (
          <InventoryRow
            key={device.id}
            device={device}
            room={snapshot.areas.find((area) => area.area_id === device.areaId)?.name}
            selecting={selecting}
            selected={selected.includes(device.id)}
            pendingTuya={pendingTuyaByDevice.get(device.id)}
            canManage={snapshot.user.is_admin}
            onSelect={() =>
              setSelected((previous) =>
                previous.includes(device.id)
                  ? previous.filter((id) => id !== device.id)
                  : [...previous, device.id],
              )
            }
            onOpen={() => (device.accessory ? onOpen(device.accessory) : setManaging(device.id))}
            onManage={() => setManaging(device.id)}
            onFinishTuyaSetup={(pending) => setFinishCameraTarget(pending)}
          />
        ))}
        {!items.length && (
          <Box className="management-empty">
            <Search size={27} />
            <Heading level={3}>No devices match</Heading>
            <Text semantic="p">Try another name, room or filter.</Text>
            <HausButton
              variant="secondary"
              onPress={() => {
                setQuery('');
                setArea('all');
                setFilter('all');
              }}
            >
              Clear filters
            </HausButton>
          </Box>
        )}
      </Box>
      {moving && (
        <DeviceMoveDialog
          ids={moving}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setMoving(undefined)}
          onMoved={(ids) => {
            setSelected((previous) => previous.filter((id) => !ids.includes(id)));
          }}
        />
      )}
      {managed && (
        <RegistryDeviceDialog
          key={managed.id}
          device={managed}
          snapshot={snapshot}
          registry={registry}
          pendingTuya={pendingTuyaByDevice.get(managed.id)}
          onFinishTuyaSetup={(pending) => {
            setManaging(undefined);
            setFinishCameraTarget(pending);
          }}
          onClose={() => setManaging(undefined)}
          onSaved={() => {
            setManaging(undefined);
            notify('Device updated.');
          }}
        />
      )}
      {finishCameraTarget && (
        <TuyaCameraResumeModal
          target={finishCameraTarget}
          onCompleted={() => {
            refreshPendingTuya();
            notify('Tuya camera setup updated.');
          }}
          onClose={() => setFinishCameraTarget(null)}
        />
      )}
      <Box className="management-bottom">
        <Text>
          {items.length} of {inventory.length} devices · Live entities / registered entities
        </Text>
        <Pressable className="text-link" onPress={onAdd}>
          Add a device <Plus size={15} />
        </Pressable>
      </Box>
    </Box>
  );
}
