/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { stripOutlets } from '../../model/device-relationships';
import { useState, type ReactNode, type Ref } from 'react';
import { Eye, Heart, LoaderCircle, MoreHorizontal } from 'lucide-react';
import type { HausAccessory } from '../../model';
import { deviceAppearance } from '../../model/device-appearance';
import { deviceSource } from '../../model/device-name';
import { accessoryDisplayName } from '../../model/accessory-name';
import { describeAccessory } from '../../model/presentation';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { AccessoryIcon, BatteryLevelIcon } from '../../components/icons/Icon';
import { deviceSurfaceStyle, LightEffectIcon } from './controls/LightEffectIcon';

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
    <article
      ref={tileRef}
      style={deviceSurfaceStyle(outputAccent, active ? appearance.effect : undefined)}
      className={`accessory-tile accessory-${a.category} ${active ? 'is-active' : ''} ${a.availability !== 'available' ? 'is-unavailable' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''} ${className}`.trim()}
      data-pending={a.pending || undefined}
      data-selected={selected || undefined}
      data-included={included || undefined}
      data-light-effect={active ? appearance.effect?.motion : undefined}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <div className="tile-top">
        <button
          type="button"
          className="accessory-icon"
          aria-label={
            iconActionLabel ??
            (a.managementUrl ? `Open ${a.name} in browser` : `Quick control ${a.name}`)
          }
          onClick={onQuick}
          disabled={isQuickDisabled}
        >
          <AccessoryIcon accessory={a} />
        </button>
        <span>
          {slowPending && (
            <span className="tile-pending-indicator" aria-label="Updating device" title="Updating…">
              <LoaderCircle size={13} className="spin" />
            </span>
          )}
          {favorite ? <Heart size={13} fill="currentColor" /> : null}
          {a.lightGroup && (
            <b
              className="light-group-count"
              aria-label={`${a.lightGroup.members.length} lights grouped`}
            >
              {a.lightGroup.members.length}
            </b>
          )}
          {(typeof a.batteryLevel === 'number' || typeof a.batteryCharging === 'boolean') && (
            <span
              className={`battery-tile-reading ${typeof a.batteryLevel === 'number' && a.batteryLevel <= 20 ? 'is-low' : ''} ${a.batteryCharging ? 'is-charging' : ''}`}
              data-hover-only={
                (typeof a.batteryLevel === 'number' && a.batteryLevel >= 75 && !charging) ||
                undefined
              }
              aria-label={`${typeof a.batteryLevel === 'number' ? `Battery ${Math.round(a.batteryLevel)}%` : 'Battery'}${a.batteryCharging ? ', charging' : ''}`}
              title={`${typeof a.batteryLevel === 'number' ? `Battery ${Math.round(a.batteryLevel)}%` : 'Battery status'}${a.batteryCharging ? ' · Charging' : ''}`}
            >
              <BatteryLevelIcon level={a.batteryLevel} charging={a.batteryCharging} size={10.5} />
            </span>
          )}
          {showStatusDot &&
            (active && appearance.effect ? (
              <span
                className="light-effect-badge"
                title={`Effect: ${appearance.effect.label}`}
                aria-label={`Effect: ${appearance.effect.label}`}
              >
                <LightEffectIcon icon={appearance.effect.icon} size={11} />
              </span>
            ) : swatch ? (
              <i
                className="light-color-swatch"
                style={{ background: swatch }}
                title="Current light color"
              />
            ) : (
              <i className={active ? 'on' : ''} />
            ))}
          {topRight}
        </span>
      </div>
      <button
        type="button"
        className="tile-body"
        aria-pressed={bodyAriaPressed}
        aria-expanded={bodyAriaExpanded}
        onClick={onOpen}
      >
        <small>
          {subtitle ?? (
            <>
              {nameWithRoom ? 'Light' : (room ?? 'Other')}
              {deviceSource(a.name) && (
                <b className="scene-source-badge scene-source-inline device-source-badge">Hue</b>
              )}
            </>
          )}
        </small>
        <strong>{displayName}</strong>
        <span key={`${a.state.state}:${resolvedStateText}`} className="device-state-text">
          {resolvedStateText}
        </span>
      </button>
      {showMore && (
        <button
          type="button"
          className="tile-more"
          aria-label={`Options for ${a.name}`}
          onClick={(e) => {
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
        </button>
      )}
      {hidden && onRestore && (
        <button type="button" className="tile-restore" onClick={onRestore}>
          <Eye size={14} />
          Restore to app
        </button>
      )}
    </article>
  );
}
