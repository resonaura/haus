/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stripOutlets } from '../../model/device-relationships';
import { type ReactNode, type Ref } from 'react';
import { colorToken, mixColor, rgba, transparentColor } from '@haus/ui';
import { DeviceTile, parseCssColor } from '@haus/ui/components';
import type { HausAccessory } from '../../model';
import { deviceAppearance, deviceSurfaceVars } from '../../model/device-appearance';
import { deviceSource } from '../../model/device-name';
import { accessoryDisplayName } from '../../model/accessory-name';
import { describeAccessory } from '../../model/presentation';
import { AccessoryIcon } from '../../components/icons/Icon';

export interface AccessoryTileProps {
  accessory: HausAccessory;
  room?: string;
  nameWithRoom?: boolean;
  favorite?: boolean;
  hidden?: boolean;
  draggable?: boolean;
  className?: string;
  tileRef?: Ref<HTMLElement>;
  selected?: boolean;
  included?: boolean;
  subtitle?: ReactNode;
  title?: string;
  stateText?: string;
  topRight?: ReactNode;
  showStatusDot?: boolean;
  showMore?: boolean;
  quickDisabled?: boolean;
  iconActionLabel?: string;
  bodyAriaPressed?: boolean;
  bodyAriaExpanded?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onRestore?: () => void;
  onOpen: () => void;
  onQuick: () => void;
}

export function AccessoryTile({
  accessory: a,
  room,
  nameWithRoom = false,
  favorite = false,
  hidden = false,
  draggable,
  className = '',
  tileRef,
  selected = false,
  included,
  subtitle,
  title,
  stateText,
  topRight,
  showStatusDot = true,
  showMore = true,
  quickDisabled,
  iconActionLabel,
  bodyAriaPressed,
  bodyAriaExpanded,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onContextMenu,
  onRestore,
  onOpen,
  onQuick,
}: AccessoryTileProps) {
  const outlets = a.powerStrip ? stripOutlets(a) : [];
  const appearance = deviceAppearance(
    a.powerStrip
      ? { ...a.state, state: outlets.some((item) => item.state === 'on') ? 'on' : 'off' }
      : a.state,
  );
  const active = a.availability === 'available' && appearance.active;
  const activeEffect = active ? appearance.effect : undefined;
  const swatch = active ? appearance.actualColor : undefined;

  const displayName =
    title ??
    (nameWithRoom && room
      ? `${room} ${accessoryDisplayName(a, room)}`
      : accessoryDisplayName(a, room));
  const resolvedStateText =
    stateText ??
    (a.powerStrip
      ? `${outlets.length} outlets · ${outlets.filter((item) => item.state === 'on').length} on`
      : describeAccessory(a));
  const isQuickDisabled = quickDisabled ?? (a.availability !== 'available' && !a.managementUrl);
  const isDraggable = draggable ?? !hidden;
  const selectionStyle =
    selected || included
      ? {
          border: { width: 1, color: mixColor(transparentColor, colorToken('ink'), 0.38) },
          shadows: [
            {
              offsetX: 0,
              offsetY: 0,
              blurRadius: 0,
              spreadRadius: 1,
              color: mixColor(transparentColor, colorToken('ink'), 0.14),
            },
            { offsetX: 0, offsetY: 5, blurRadius: 16, color: rgba(0, 0, 0, 0.1) },
          ],
        }
      : undefined;

  return (
    <DeviceTile
      desktop
      available={a.availability === 'available'}
      active={active}
      category={a.category}
      favorite={favorite}
      accent={parseCssColor(appearance.actualColor)}
      colorSwatch={parseCssColor(swatch)}
      lightEffect={activeEffect}
      pending={Boolean(a.pending)}
      pendingSince={a.pendingSince}
      groupCount={a.lightGroup?.members.length}
      battery={
        typeof a.batteryLevel === 'number' || typeof a.batteryCharging === 'boolean'
          ? { level: a.batteryLevel, charging: a.batteryCharging }
          : undefined
      }
      sourceBadge={subtitle === undefined ? deviceSource(a.name) : undefined}
      showStatusDot={showStatusDot}
      topRight={topRight}
      frame={{
        boxRef: tileRef,
        surfaceTokens: deviceSurfaceVars(appearance.accent, activeEffect),
        className:
          `accessory-tile accessory-${a.category} ${active ? 'is-active' : ''} ${a.availability !== 'available' ? 'is-unavailable' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''} ${className}`.trim(),
        dataAttrs: {
          'data-selected': selected || undefined,
          'data-included': included || undefined,
        },
        style: selectionStyle,
        draggable: isDraggable,
        onDragStart,
        onDragOver,
        onDragEnd,
        onDrop,
        onContextMenu,
      }}
      name={displayName}
      subtitle={subtitle ?? (nameWithRoom ? 'Light' : (room ?? 'Other'))}
      state={resolvedStateText}
      stateKey={`${a.state.state}:${resolvedStateText}`}
      icon={<AccessoryIcon accessory={a} size={19} />}
      quickLabel={
        iconActionLabel ??
        (a.managementUrl ? `Open ${a.name} in browser` : `Quick control ${a.name}`)
      }
      quickDisabled={isQuickDisabled}
      onQuick={onQuick}
      onOpen={onOpen}
      onMorePress={
        showMore
          ? (event) => {
              if (onContextMenu) {
                onContextMenu(event);
              } else {
                onOpen();
              }
            }
          : undefined
      }
      onRestore={hidden && onRestore ? onRestore : undefined}
      selected={bodyAriaPressed}
      opened={bodyAriaExpanded}
    />
  );
}
