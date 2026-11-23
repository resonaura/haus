/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stripOutlets } from '../../model/device-relationships';
import { useState, type ReactNode, type Ref } from 'react';
import { Box, Pressable, Text } from '@haus/ui';
import { Eye, Heart, LoaderCircle, MoreHorizontal } from 'lucide-react';
import type { HausAccessory } from '../../model';
import { deviceAppearance, deviceSurfaceVars } from '../../model/device-appearance';
import { deviceSource } from '../../model/device-name';
import { accessoryDisplayName } from '../../model/accessory-name';
import { describeAccessory } from '../../model/presentation';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { AccessoryIcon, BatteryLevelIcon } from '../../components/icons/Icon';
import { LightEffectIcon } from './controls/LightEffectIcon';

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
  const charging = a.batteryCharging === true;
  const active = a.availability === 'available' && appearance.active;
  const swatch = active ? appearance.actualColor : undefined;
  const slowPending = useDelayedPending(Boolean(a.pending), a.pendingSince);
  // Retain the last output while the wash fades out, rather than fading via white.
  const [outputAccent, setOutputAccent] = useState(appearance.accent);
  if (active && outputAccent !== appearance.accent) setOutputAccent(appearance.accent);

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

  return (
    <Box
      semantic="article"
      boxRef={tileRef}
      surfaceTokens={deviceSurfaceVars(outputAccent, active ? appearance.effect : undefined)}
      className={`accessory-tile accessory-${a.category} ${active ? 'is-active' : ''} ${a.availability !== 'available' ? 'is-unavailable' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''} ${className}`.trim()}
      dataAttrs={{
        'data-pending': a.pending || undefined,
        'data-selected': selected || undefined,
        'data-included': included || undefined,
        'data-light-effect': active ? appearance.effect?.motion : undefined,
      }}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <Box className="tile-top">
        <Pressable
          className="accessory-icon"
          ariaLabel={
            iconActionLabel ??
            (a.managementUrl ? `Open ${a.name} in browser` : `Quick control ${a.name}`)
          }
          onPress={onQuick}
          disabled={isQuickDisabled}
        >
          <AccessoryIcon accessory={a} />
        </Pressable>
        <Text>
          {slowPending && (
            <Text className="tile-pending-indicator" ariaLabel="Updating device" title="Updating…">
              <LoaderCircle size={13} className="spin" />
            </Text>
          )}
          {favorite ? <Heart size={13} fill="currentColor" /> : null}
          {a.lightGroup && (
            <Text
              semantic="bold"
              className="light-group-count"
              ariaLabel={`${a.lightGroup.members.length} lights grouped`}
            >
              {a.lightGroup.members.length}
            </Text>
          )}
          {(typeof a.batteryLevel === 'number' || typeof a.batteryCharging === 'boolean') && (
            <Text
              className={`battery-tile-reading ${typeof a.batteryLevel === 'number' && a.batteryLevel <= 20 ? 'is-low' : ''} ${a.batteryCharging ? 'is-charging' : ''}`}
              dataAttrs={{
                'data-hover-only':
                  (typeof a.batteryLevel === 'number' && a.batteryLevel >= 75 && !charging) ||
                  undefined,
              }}
              ariaLabel={`${typeof a.batteryLevel === 'number' ? `Battery ${Math.round(a.batteryLevel)}%` : 'Battery'}${a.batteryCharging ? ', charging' : ''}`}
              title={`${typeof a.batteryLevel === 'number' ? `Battery ${Math.round(a.batteryLevel)}%` : 'Battery status'}${a.batteryCharging ? ' · Charging' : ''}`}
            >
              <BatteryLevelIcon level={a.batteryLevel} charging={a.batteryCharging} size={10.5} />
            </Text>
          )}
          {showStatusDot &&
            (active && appearance.effect ? (
              <Text
                className="light-effect-badge"
                title={`Effect: ${appearance.effect.label}`}
                ariaLabel={`Effect: ${appearance.effect.label}`}
              >
                <LightEffectIcon icon={appearance.effect.icon} size={11} />
              </Text>
            ) : swatch ? (
              <Text
                semantic="swatch"
                className="light-color-swatch"
                surfaceTokens={{ background: swatch }}
                title="Current light color"
              />
            ) : null)}
          {topRight}
        </Text>
      </Box>
      <Pressable
        className="tile-body"
        ariaPressed={bodyAriaPressed}
        ariaExpanded={bodyAriaExpanded}
        onPress={onOpen}
      >
        <Text semantic="small">
          {subtitle ?? (
            <>
              {nameWithRoom ? 'Light' : (room ?? 'Other')}
              {deviceSource(a.name) && (
                <Text
                  semantic="bold"
                  className="scene-source-badge scene-source-inline device-source-badge"
                >
                  Hue
                </Text>
              )}
            </>
          )}
        </Text>
        <Text semantic="strong">{displayName}</Text>
        <Text key={`${a.state.state}:${resolvedStateText}`} className="device-state-text">
          {resolvedStateText}
        </Text>
      </Pressable>
      {showMore && (
        <Pressable
          className="tile-more"
          ariaLabel={`Options for ${a.name}`}
          onPress={(e) => {
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            if (onContextMenu) {
              onContextMenu(e);
            } else {
              onOpen();
            }
          }}
        >
          <MoreHorizontal size={17} />
        </Pressable>
      )}
      {hidden && onRestore && (
        <Pressable className="tile-restore" onPress={onRestore}>
          <Eye size={14} />
          Restore to app
        </Pressable>
      )}
    </Box>
  );
}
