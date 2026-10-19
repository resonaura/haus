import { MoreHorizontal, LayoutGrid } from 'lucide-react';
import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { inventoryStatus, type InventoryDevice } from '../../model/inventory';
import { categoryIcons } from '../../components/icons/Icon';
export function InventoryRow({
  device,
  room,
  selecting,
  selected,
  onSelect,
  onOpen,
  onManage,
}: {
  device: InventoryDevice;
  room?: string;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onManage: () => void;
}) {
  const Icon = categoryIcons[device.category] ?? LayoutGrid;
  const name = deviceDisplayName(device.name, room, device.model || 'Device');
  return (
    <div
      className="inventory-row"
      role="row"
      data-selecting={selecting || undefined}
      data-selected={selected || undefined}
    >
      <span className="inventory-device-cell" role="cell">
        {selecting && (
          <input
            type="checkbox"
            aria-label={`Select ${name}`}
            checked={selected}
            onChange={onSelect}
          />
        )}
        <button className="inventory-device" onClick={selecting ? onSelect : onOpen}>
          <span className={`inventory-glyph inventory-glyph--${device.category}`}>
            <Icon size={21} />
          </span>
          <span>
            <strong>
              {name}
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
        </button>
      </span>
      <span className="inventory-room" role="cell">
        {room ?? 'Unassigned'}
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
      <span role="cell">
        <button
          className="icon-button inventory-manage"
          aria-label={`Manage ${name}`}
          title={`Manage ${name}`}
          onClick={onManage}
        >
          <MoreHorizontal size={17} />
        </button>
      </span>
    </div>
  );
}
