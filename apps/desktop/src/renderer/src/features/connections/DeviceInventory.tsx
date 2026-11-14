/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
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
      `${device.name} ${device.manufacturer} ${device.model}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const items = scoped.filter((device) => matchesFilter(device, filter));
  const managed = snapshot.devices.find((device) => device.id === managing);
  const firstPending = pendingTuya[0];
  const firstPendingCopy = firstPending ? tuyaPendingCopy(firstPending.reason) : undefined;
  return (
    <div className="inventory-page">
      <div className="inventory-summary">
        <span>
          <Server size={19} />
          <strong>{inventory.length}</strong> registered devices
        </span>
        <span>
          <Radio size={17} />
          <strong>{snapshot.states.length}</strong> live entities
        </span>
        <span className="inventory-note">Includes hidden, disabled and diagnostic devices</span>
      </div>
      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label="Search all devices"
            placeholder="Search name, brand or model"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear device search" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </label>
        <select
          aria-label="Filter devices by room"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option value="all">Every room</option>
          {snapshot.areas.map((a) => (
            <option key={a.area_id} value={a.area_id}>
              {a.name}
            </option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>
      </div>
      {snapshot.user.is_admin && (
        <div className="inventory-selection-bar">
          <Button
            variant="ghost"
            onPress={() => {
              setSelecting(!selecting);
              setSelected([]);
            }}
          >
            <CheckSquare size={16} />
            {selecting ? 'Cancel selection' : 'Select devices'}
          </Button>
          {selecting && (
            <>
              <Button
                variant="ghost"
                isDisabled={!items.length}
                onPress={() =>
                  setSelected((previous) => [
                    ...new Set([...previous, ...items.map((item) => item.id)]),
                  ])
                }
              >
                Select all shown
              </Button>
              <span role="status">
                {selected.length} selected
                {selected.some((id) => !items.some((item) => item.id === id))
                  ? ' · includes filtered devices'
                  : ''}
              </span>
              <Button
                variant="secondary"
                isDisabled={!selected.length}
                onPress={() => setMoving([...selected])}
              >
                <MoveRight size={16} />
                Move to room
              </Button>
            </>
          )}
        </div>
      )}
      <div className="filter-tabs" aria-label="Device filters">
        {filters.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            className={filter === item.id ? 'selected' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>{scoped.filter((d) => matchesFilter(d, item.id)).length}</span>
          </button>
        ))}
      </div>
      {firstPending && firstPendingCopy && (
        <div className="inventory-tuya-banner" role="region" aria-label="Pending Tuya camera setup">
          <div className="inventory-tuya-banner-copy">
            <AlertTriangle size={18} />
            <div>
              <strong>
                {pendingTuya.length === 1
                  ? `${firstPending.deviceName} needs camera setup`
                  : `${pendingTuya.length} Tuya cameras need setup completion`}
              </strong>
              <span>{firstPendingCopy.detail}</span>
            </div>
          </div>
          {snapshot.user.is_admin && (
            <Button
              size="sm"
              className="attention-reconfigure-pill"
              onPress={() => setFinishCameraTarget(firstPending)}
            >
              Finish setup
            </Button>
          )}
        </div>
      )}
      <div className="inventory-table" role="table" aria-label="Registered devices">
        <div className="inventory-table-head" role="row">
          <span role="columnheader">DEVICE</span>
          <span role="columnheader">ROOM</span>
          <span role="columnheader">DATA STATUS</span>
          <span role="columnheader">ENTITIES</span>
          <span />
        </div>
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
          <div className="management-empty">
            <Search size={27} />
            <h3>No devices match</h3>
            <p>Try another name, room or filter.</p>
            <Button
              variant="secondary"
              onPress={() => {
                setQuery('');
                setArea('all');
                setFilter('all');
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
      </div>
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
      <div className="management-bottom">
        <span>
          {items.length} of {inventory.length} devices · Live entities / registered entities
        </span>
        <button className="text-link" onClick={onAdd}>
          Add a device <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
