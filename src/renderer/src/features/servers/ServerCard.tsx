import { ServerIcon } from '../../components/icons/ServerIcon';
import { BatteryLevelIcon } from '../../components/icons/Icon';
import { Eye, Heart, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextMenu } from '../../components/ui/ContextMenu';
import type { ContextMenuItem } from '../../../../shared/native';
import { percent, ratio, telemetryIsFresh } from './presentation';
import type { HomeServer } from './types';
import type { ServerDevicePreference } from '../../model/preferences';
import type { ServerRoom } from './server-rooms';
import { serverContextItems, serverContextPreference } from './server-context-menu';

export function ServerCard({
  server,
  room,
  fresh,
  now,
  onOpen,
  icon,
  rooms = [],
  preference,
  onSavePreference,
  hidden = false,
}: {
  server: HomeServer;
  room?: string;
  fresh: boolean;
  now: number;
  onOpen: () => void;
  icon?: string;
  rooms?: ServerRoom[];
  preference?: ServerDevicePreference;
  onSavePreference?: (value: ServerDevicePreference) => void | Promise<void>;
  hidden?: boolean;
}) {
  const telemetryFresh = telemetryIsFresh(server, fresh, now);
  const state = !fresh
    ? 'Last known status'
    : server.enabled === false
      ? 'Paused'
      : server.online
        ? 'Connected'
        : 'Offline';
  const battery = telemetryFresh ? server.host?.battery : null;
  const batteryLevel = battery?.level ?? undefined;
  const batteryCharging = battery?.charging ?? undefined;
  const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number }>();
  const [menuError, setMenuError] = useState('');
  const applyMenuAction = async (selected: string) => {
    setMenu(undefined);
    if (selected === 'details') return onOpen();
    const next = serverContextPreference(selected, rooms, preference);
    if (next && onSavePreference) await onSavePreference(next);
  };
  const showMenu = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    setMenuError('');
    const items = serverContextItems(rooms, preference, Boolean(onSavePreference));
    if (window.hausNative?.showContextMenu) {
      try {
        const selected = await window.hausNative.showContextMenu(items);
        if (selected) await applyMenuAction(selected);
      } catch {
        setMenuError('Your server settings could not be saved. Try again.');
      }
    } else {
      setMenu({
        items,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 210)),
      });
    }
  };
  return (
    <article
      id={`server-card-${server.id}`}
      tabIndex={-1}
      className={`accessory-tile server-tile ${fresh && !server.online ? 'is-unavailable' : ''}`}
      onContextMenu={(event) => void showMenu(event)}
    >
      <div className="tile-top">
        <button
          type="button"
          className="accessory-icon"
          onClick={onOpen}
          aria-label={`Open ${server.name}`}
        >
          <ServerIcon server={server} icon={icon} />
        </button>
        <span className="server-tile-status">
          {(typeof batteryLevel === 'number' || typeof batteryCharging === 'boolean') && (
            <span
              key={`${batteryLevel === undefined ? 'unknown' : Math.round(batteryLevel)}:${batteryCharging ? 'charging' : 'idle'}`}
              className={`battery-tile-reading server-tile-battery ${typeof batteryLevel === 'number' && batteryLevel <= 20 ? 'is-low' : ''} ${batteryCharging ? 'is-charging' : ''}`}
              aria-label={`${typeof batteryLevel === 'number' ? `Battery ${Math.round(batteryLevel)}%` : 'Battery'}${batteryCharging ? ', charging' : ''}`}
              title={`${typeof batteryLevel === 'number' ? `Battery ${Math.round(batteryLevel)}%` : 'Battery status'}${batteryCharging === true ? ' · Charging' : batteryCharging === false ? ' · Not charging' : ''}`}
            >
              <BatteryLevelIcon level={batteryLevel} charging={batteryCharging} />
              {typeof batteryLevel === 'number' && <small>{Math.round(batteryLevel)}%</small>}
            </span>
          )}
          {preference?.favorite && <Heart size={13} fill="currentColor" aria-label="Favorite" />}
          <i className={fresh && server.online && server.enabled !== false ? 'on' : ''} />
        </span>
      </div>
      <button
        type="button"
        className="tile-body"
        onClick={onOpen}
        aria-label={`${server.name}, ${room ?? 'Unassigned'}, ${state}`}
      >
        <small>{room ?? 'Unassigned'}</small>
        <strong>{server.name}</strong>
        <span>{state}</span>
      </button>
      {!hidden && telemetryFresh && server.host && (
        <span className="server-tile-resources">
          <span>CPU {percent(server.host.cpu.usage)}</span>
          <span>
            RAM {percent(ratio(server.host.memory.usedBytes, server.host.memory.totalBytes))}
          </span>
        </span>
      )}
      <button
        type="button"
        className="tile-more"
        aria-label={`Options for ${server.name}`}
        onClick={(event) => void showMenu(event)}
      >
        <MoreHorizontal size={17} />
      </button>
      {hidden && onSavePreference && (
        <button
          type="button"
          className="tile-restore"
          onClick={() =>
            void applyMenuAction('app-visibility').catch(() =>
              setMenuError('Your server settings could not be saved. Try again.'),
            )
          }
        >
          <Eye size={14} />
          Restore to Haus
        </button>
      )}
      {menuError && (
        <span className="server-card-error" role="alert">
          {menuError}
        </span>
      )}
      {menu &&
        createPortal(
          <ContextMenu
            {...menu}
            onClose={() => setMenu(undefined)}
            onAction={(selected) =>
              void applyMenuAction(selected).catch(() =>
                setMenuError('Your server settings could not be saved. Try again.'),
              )
            }
          />,
          document.body,
        )}
    </article>
  );
}
