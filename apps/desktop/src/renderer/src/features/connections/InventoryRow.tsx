/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { AlertTriangle, MoreHorizontal, LayoutGrid } from 'lucide-react';
import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { inventoryStatus, type InventoryDevice } from '../../model/inventory';
import { categoryIcons } from '../../components/icons/Icon';
import { tuyaPendingCopy, type TuyaPendingCamera } from './flow/tuya-camera-pending';
export function InventoryRow({
  device,
  room,
  selecting,
  selected,
  pendingTuya,
  canManage = false,
  onSelect,
  onOpen,
  onManage,
  onFinishTuyaSetup,
}: {
  device: InventoryDevice;
  room?: string;
  selecting: boolean;
  selected: boolean;
  pendingTuya?: TuyaPendingCamera;
  canManage?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onManage: () => void;
  onFinishTuyaSetup?: (pending: TuyaPendingCamera) => void;
}) {
  const Icon = categoryIcons[device.category] ?? LayoutGrid;
  const name = deviceDisplayName(device.name, room, device.model || 'Device');
  const pendingCopy = pendingTuya ? tuyaPendingCopy(pendingTuya.reason) : undefined;
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
      <span className="inventory-status-cell" role="cell">
        {pendingTuya && pendingCopy ? (
          <>
            <span className="status-pill status-warning" title={pendingCopy.detail}>
              <AlertTriangle size={11} />
              {pendingCopy.badge}
            </span>
            {canManage && onFinishTuyaSetup && (
              <button
                type="button"
                className="finish-setup-pill"
                title={pendingCopy.detail}
                onClick={(event) => {
                  event.stopPropagation();
                  onFinishTuyaSetup(pendingTuya);
                }}
              >
                {pendingCopy.action}
              </button>
            )}
          </>
        ) : (
          <span className={`status-pill status-${device.status}`}>
            <i />
            {inventoryStatus[device.status]}
          </span>
        )}
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
