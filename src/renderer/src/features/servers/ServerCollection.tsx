import { Server } from 'lucide-react';
import { useServers } from './useServers';
import { groupServersByRoom, type ServerDevicePreferences, type ServerRoom } from './server-rooms';
import { ServerCard } from './ServerCard';
import type { ServerDevicePreference } from '../../model/preferences';
import { serversForView } from './server-catalog';

export function ServerCollection({
  demo,
  rooms,
  preferences,
  mode,
  onOpen,
  onSave,
}: {
  demo: boolean;
  rooms: ServerRoom[];
  preferences: ServerDevicePreferences;
  mode: 'home' | 'favorites' | 'hidden';
  onOpen: (id: string) => void;
  onSave: (id: string, value: ServerDevicePreference) => void | Promise<void>;
}) {
  const { status, fresh, now, error } = useServers(demo);
  if (!status)
    return mode === 'hidden' && !demo ? (
      <p className="page-tip" role={error ? 'alert' : 'status'}>
        <Server size={16} />
        {error || 'Loading hidden servers…'}
      </p>
    ) : null;
  const visible = serversForView(status.servers, preferences, mode);
  if (!visible.length) return null;
  const groups = groupServersByRoom(visible, rooms, preferences);
  return (
    <div className={`device-groups server-collections server-collections--${mode}`}>
      {groups.map((group) => (
        <section className="device-group" key={group.id}>
          <div className="device-group-heading">
            <span className="device-group-icon" aria-hidden="true">
              <Server size={19} />
            </span>
            <h2>{group.name}</h2>
            <span className="device-group-count">
              {group.servers.length} {group.servers.length === 1 ? 'server' : 'servers'}
            </span>
            <span className="device-group-rule" />
          </div>
          <div className="accessory-grid server-card-grid">
            {group.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                room={group.name}
                fresh={fresh}
                now={now}
                icon={preferences[server.id]?.icon}
                rooms={rooms}
                preference={preferences[server.id]}
                hidden={mode === 'hidden'}
                onSavePreference={(value) => onSave(server.id, value)}
                onOpen={() => onOpen(server.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
