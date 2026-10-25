import { stripOutlets } from '../../model/device-relationships';
import { useState, type CSSProperties } from 'react';
import { Eye, Heart, LoaderCircle, MoreHorizontal } from 'lucide-react';
import type { HausAccessory } from '../../model';
import { deviceAppearance } from '../../model/device-appearance';
import { deviceSource } from '../../model/device-name';
import { accessoryDisplayName } from '../../model/accessory-name';
import { describeAccessory } from '../../model/presentation';
import { useDelayedPending } from '../../hooks/useDelayedPending';
import { AccessoryIcon, BatteryLevelIcon } from '../../components/icons/Icon';

export function AccessoryTile({
  accessory: a,
  room,
  favorite,
  hidden = false,
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
}: {
  accessory: HausAccessory;
  room?: string;
  favorite: boolean;
  hidden?: boolean;
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
}) {
  const outlets = a.powerStrip ? stripOutlets(a) : [];
  const appearance = deviceAppearance(
    a.powerStrip
      ? { ...a.state, state: outlets.some((item) => item.state === 'on') ? 'on' : 'off' }
      : a.state,
  );
  const charging = a.batteryCharging === true;
  const active = appearance.active;
  const swatch = appearance.actualColor;
  const slowPending = useDelayedPending(Boolean(a.pending), a.pendingSince);
  // Retain the last output while the wash fades out, rather than fading via white.
  const [outputAccent, setOutputAccent] = useState(appearance.accent);
  if (active && outputAccent !== appearance.accent) setOutputAccent(appearance.accent);
  return (
    <article
      style={{ '--device-color': outputAccent } as CSSProperties}
      className={`accessory-tile accessory-${a.category} ${active ? 'is-active' : ''} ${a.availability !== 'available' ? 'is-unavailable' : ''} ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      data-pending={a.pending || undefined}
      draggable={!hidden}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <div className="tile-top">
        <button
          className="accessory-icon"
          aria-label={`Quick control ${a.name}`}
          onClick={onQuick}
          disabled={a.availability !== 'available'}
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
          {swatch ? (
            <i
              className="light-color-swatch"
              style={{ background: swatch }}
              title="Current light color"
            />
          ) : (
            <i className={active ? 'on' : ''} />
          )}
        </span>
      </div>
      <button className="tile-body" onClick={onOpen}>
        <small>
          {room ?? 'Other'}
          {deviceSource(a.name) && (
            <b className="scene-source-badge scene-source-inline device-source-badge">Hue</b>
          )}
        </small>
        <strong>{accessoryDisplayName(a, room)}</strong>
        <span
          key={`${a.state.state}:${a.powerStrip ? `${outlets.length} outlets · ${outlets.filter((item) => item.state === 'on').length} on` : describeAccessory(a)}`}
          className="device-state-text"
        >
          {a.powerStrip
            ? `${outlets.length} outlets · ${outlets.filter((item) => item.state === 'on').length} on`
            : describeAccessory(a)}
        </span>
      </button>
      <button
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
      {hidden && onRestore && (
        <button className="tile-restore" onClick={onRestore}>
          <Eye size={14} />
          Restore to app
        </button>
      )}
    </article>
  );
}
