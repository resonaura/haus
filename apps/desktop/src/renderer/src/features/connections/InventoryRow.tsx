/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, CheckboxInput, Pressable, Text } from '@haus/ui';
import { AlertTriangle, MoreHorizontal, LayoutGrid } from 'lucide-react';
import { deviceDisplayName, deviceSource } from '../../model/device-name';
import { inventoryStatus, type InventoryDevice } from '../../model/inventory';
import { categoryIcons } from '../../components/icons/Icon';
import { HausIdCode } from '../../components/ui/haus-id';
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
    <Box
      className="inventory-row"
      role="row"
      dataAttrs={{ selecting: selecting || undefined, selected: selected || undefined }}
    >
      <Text className="inventory-device-cell" role="cell">
        {selecting && (
          <CheckboxInput ariaLabel={`Select ${name}`} checked={selected} onChange={onSelect} />
        )}
        <Pressable className="inventory-device" onPress={selecting ? onSelect : onOpen}>
          <Text className={`inventory-glyph inventory-glyph--${device.category}`}>
            <Icon size={21} />
          </Text>
          <Text>
            <Text semantic="strong">
              {name}
              {deviceSource(device.name) && (
                <Text className="scene-source-badge scene-source-inline device-source-badge">
                  Hue
                </Text>
              )}
            </Text>
            <Text semantic="small">
              {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Device'}
            </Text>
            <Text semantic="small" className="haus-id-inline">
              <HausIdCode value={device.hausId} />
            </Text>
          </Text>
        </Pressable>
      </Text>
      <Text className="inventory-room" role="cell">
        {room ?? 'Unassigned'}
      </Text>
      <Text className="inventory-status-cell" role="cell">
        {pendingTuya && pendingCopy ? (
          <>
            <Text className="status-pill status-warning" title={pendingCopy.detail}>
              <AlertTriangle size={11} />
              {pendingCopy.badge}
            </Text>
            {canManage && onFinishTuyaSetup && (
              <Pressable
                className="finish-setup-pill"
                title={pendingCopy.detail}
                stopPropagation
                onPress={() => onFinishTuyaSetup(pendingTuya)}
              >
                {pendingCopy.action}
              </Pressable>
            )}
          </>
        ) : (
          <Text className={`status-pill status-${device.status}`}>
            <Text semantic="swatch" />
            {inventoryStatus[device.status]}
          </Text>
        )}
      </Text>
      <Text className="inventory-entity-count" role="cell">
        {device.activeEntityCount}
        <Text semantic="small"> / {device.entityCount}</Text>
      </Text>
      <Text role="cell">
        <Pressable
          className="icon-button inventory-manage"
          ariaLabel={`Manage ${name}`}
          title={`Manage ${name}`}
          onPress={onManage}
        >
          <MoreHorizontal size={17} />
        </Pressable>
      </Text>
    </Box>
  );
}
