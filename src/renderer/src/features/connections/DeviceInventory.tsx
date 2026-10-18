import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { ChevronRight, LayoutGrid, Plus, Radio, Search, Server, X } from 'lucide-react';
import type { HausAccessory, Snapshot } from '../../model';
import { buildInventory, inventoryStatus } from '../../model/inventory';
import { categoryIcons } from '../../components/icons/Icon';
type OpenServer = (path: string) => void;

export function DeviceInventory({
  snapshot,
  accessories,
  onOpen,
  openServer,
  onAdd,
}: {
  snapshot: Snapshot;
  accessories: HausAccessory[];
  onOpen: (a: HausAccessory) => void;
  openServer: OpenServer;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [area, setArea] = useState('all');
  const inventory = useMemo(() => buildInventory(snapshot, accessories), [snapshot, accessories]);
  const filters = [
    { id: 'all', label: 'All devices' },
    { id: 'network', label: 'Network' },
    { id: 'printers', label: 'Printers' },
    { id: 'unavailable', label: 'Unavailable' },
    { id: 'no_entities', label: 'No live entities' },
  ];
  const items = inventory.filter(
    (device) =>
      (filter === 'all' || device.category === filter || device.status === filter) &&
      (area === 'all' || (device.areaId ?? 'unassigned') === area) &&
      `${device.name} ${device.manufacturer} ${device.model}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
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
      <div className="filter-tabs" aria-label="Device filters">
        {filters.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            className={filter === item.id ? 'selected' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>
              {
                inventory.filter(
                  (d) => item.id === 'all' || d.category === item.id || d.status === item.id,
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="inventory-table" role="table" aria-label="Registered devices">
        <div className="inventory-table-head" role="row">
          <span role="columnheader">DEVICE</span>
          <span role="columnheader">ROOM</span>
          <span role="columnheader">DATA STATUS</span>
          <span role="columnheader">ENTITIES</span>
          <span />
        </div>
        {items.map((device) => {
          const Icon = categoryIcons[device.category] ?? LayoutGrid;
          return (
            <button
              className="inventory-row"
              role="row"
              key={device.id}
              onClick={() =>
                device.accessory
                  ? onOpen(device.accessory)
                  : openServer(`/config/devices/device/${encodeURIComponent(device.id)}`)
              }
            >
              <span className="inventory-device" role="cell">
                <span className={`inventory-glyph inventory-glyph--${device.category}`}>
                  <Icon size={21} />
                </span>
                <span>
                  <strong>
                    {deviceDisplayName(
                      device.name,
                      snapshot.areas.find((area) => area.area_id === device.areaId)?.name,
                      device.model || 'Device',
                    )}
                    {deviceSource(device.name) && (
                      <span className="scene-source-badge scene-source-inline device-source-badge">
                        Hue
                      </span>
                    )}
                  </strong>
                  <small>
                    {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Device'}
                  </small>
                </span>
              </span>
              <span className="inventory-room" role="cell">
                {snapshot.areas.find((a) => a.area_id === device.areaId)?.name ?? 'Unassigned'}
              </span>
              <span role="cell">
                <span className={`status-pill status-${device.status}`}>
                  <i />
                  {inventoryStatus[device.status]}
                </span>
              </span>
              <span className="inventory-entity-count" role="cell">
                {device.activeEntityCount}
                <small> / {device.entityCount}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          );
        })}
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
