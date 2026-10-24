import { Server } from 'lucide-react';
import { ServerCard } from './ServerCard';
import { namedServer, type ServerDevicePreferences, type ServerRoom } from './server-rooms';
import { useServers } from './useServers';
import { serversForView } from './server-catalog';

export function RoomServers({
  demo,
  areaId,
  rooms,
  serverDevices,
  onServerDeviceChange,
  onOpen,
}: {
  demo: boolean;
  areaId: string;
  rooms: ServerRoom[];
  serverDevices: ServerDevicePreferences;
  onServerDeviceChange?: (
    serverId: string,
    value: import('../../model/preferences').ServerDevicePreference,
  ) => void | Promise<void>;
  onOpen: (serverId: string) => void;
}) {
  const { status, fresh, now } = useServers(demo);
  const servers = serversForView(status?.servers ?? [], serverDevices, 'all').filter(
    (server) => serverDevices[server.id]?.areaId === areaId,
  );
  const room = rooms.find((item) => item.id === areaId)?.name;
  if (!servers.length) return null;
  return (
    <section className="device-group room-servers-section" aria-label="Servers in this room">
      <div className="device-group-heading">
        <span className="device-group-icon">
          <Server size={19} />
        </span>
        <h2>Servers</h2>
        <span className="device-group-count">
          {servers.length} {servers.length === 1 ? 'server' : 'servers'}
        </span>
        <span className="device-group-rule" />
      </div>
      <div className="accessory-grid server-card-grid">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={namedServer(server, serverDevices)}
            icon={serverDevices[server.id]?.icon}
            room={room}
            fresh={fresh}
            now={now}
            rooms={rooms}
            preference={serverDevices[server.id]}
            onSavePreference={
              onServerDeviceChange ? (value) => onServerDeviceChange(server.id, value) : undefined
            }
            onOpen={() => onOpen(server.id)}
          />
        ))}
      </div>
    </section>
  );
}
