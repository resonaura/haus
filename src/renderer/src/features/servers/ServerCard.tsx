import { ServerIcon } from '../../components/icons/ServerIcon';
import { BatteryLevelIcon } from '../../components/icons/Icon';
import { percent, ratio, telemetryIsFresh } from './presentation';
import type { HomeServer } from './types';

export function ServerCard({
  server,
  room,
  fresh,
  now,
  onOpen,
  icon,
}: {
  server: HomeServer;
  room?: string;
  fresh: boolean;
  now: number;
  onOpen: () => void;
  icon?: string;
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
  return (
    <button
      type="button"
      id={`server-card-${server.id}`}
      className={`accessory-tile server-tile ${fresh && !server.online ? 'is-unavailable' : ''}`}
      onClick={onOpen}
      aria-label={`${server.name}, ${room ?? 'Unassigned'}, ${state}`}
    >
      <span className="tile-top">
        <span className="accessory-icon">
          <ServerIcon server={server} icon={icon} />
        </span>
        <span>
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
          <i className={fresh && server.online && server.enabled !== false ? 'on' : ''} />
        </span>
      </span>
      <span className="tile-body">
        <small>{room ?? 'Unassigned'}</small>
        <strong>{server.name}</strong>
        <span>{state}</span>
      </span>
      {telemetryFresh && server.host && (
        <span className="server-tile-resources">
          <span>CPU {percent(server.host.cpu.usage)}</span>
          <span>
            RAM {percent(ratio(server.host.memory.usedBytes, server.host.memory.totalBytes))}
          </span>
        </span>
      )}
    </button>
  );
}
