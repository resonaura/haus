import { useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowUpRight, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { RoomIconPicker } from './RoomIconPicker';
import { RoomEditor } from './RoomEditor';
import { RoomDelete } from './RoomDelete';
import { deviceArea } from '../../model/registry';
import type { Area, Snapshot } from '../../model';
import type { RegistryController } from '../../ha/registry';
type Props = {
  snapshot: Snapshot;
  registry: RegistryController;
  roomIcons?: Record<string, string>;
  onIcon: (id: string, icon: string) => void;
  onOpen: (id: string) => void;
  onDevices: () => void;
  notify: (message: string) => void;
};
export function RoomsPage({
  snapshot,
  registry,
  roomIcons,
  onIcon,
  onOpen,
  onDevices,
  notify,
}: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Area | null | undefined>();
  const [deleting, setDeleting] = useState<Area>();
  const rooms = snapshot.areas
    .filter((area) => area.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const unassigned = snapshot.devices.filter(
    (device) => !deviceArea(device, snapshot.devices),
  ).length;
  return (
    <div className="rooms-manager">
      <div className="management-toolbar">
        <label className="management-search">
          <Search size={17} />
          <input
            aria-label="Search rooms"
            placeholder="Find a room"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          variant="secondary"
          isDisabled={!snapshot.user.is_admin}
          onPress={() => setEditing(null)}
        >
          <Plus size={17} />
          New room
        </Button>
      </div>
      {unassigned > 0 && (
        <button className="room-unassigned" onClick={onDevices}>
          <span>
            <strong>A place for everything</strong>
            <small>
              {unassigned} {unassigned === 1 ? 'device is' : 'devices are'} waiting for a room.
            </small>
          </span>
          <ArrowUpRight size={20} />
        </button>
      )}
      {!snapshot.user.is_admin && (
        <p className="registry-help">An administrator can create, rename or remove rooms.</p>
      )}
      <div className="room-management-grid">
        {rooms.map((room) => {
          const devices = snapshot.devices.filter(
            (device) => deviceArea(device, snapshot.devices) === room.area_id,
          ).length;
          return (
            <article className="room-management-card" key={room.area_id}>
              <div className="room-management-top">
                <RoomIconPicker
                  name={room.name}
                  value={roomIcons?.[room.area_id]}
                  onChange={(icon) => onIcon(room.area_id, icon)}
                />
                <div className="room-management-actions">
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={`Settings for ${room.name}`}
                    isDisabled={!snapshot.user.is_admin}
                    onPress={() => setEditing(room)}
                  >
                    <MoreHorizontal size={19} />
                  </Button>
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={`Remove ${room.name}`}
                    isDisabled={!snapshot.user.is_admin}
                    onPress={() => setDeleting(room)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              <button className="room-management-open" onClick={() => onOpen(room.area_id)}>
                <strong>{room.name}</strong>
                <span>
                  {devices} {devices === 1 ? 'device' : 'devices'}
                  <ArrowUpRight size={17} />
                </span>
              </button>
            </article>
          );
        })}
      </div>
      {!rooms.length && (
        <div className="management-empty">
          <Search size={26} />
          <h3>{query ? 'No rooms match' : 'Make room for home'}</h3>
          <p>{query ? 'Try another room name.' : 'Create a room to bring its devices together.'}</p>
        </div>
      )}
      {editing !== undefined && (
        <RoomEditor
          room={editing ?? undefined}
          areas={snapshot.areas}
          registry={registry}
          onClose={() => setEditing(undefined)}
          onSaved={(area) => {
            setEditing(undefined);
            notify(`${area.name} ${editing ? 'updated' : 'created'}.`);
          }}
        />
      )}
      {deleting && (
        <RoomDelete
          room={deleting}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setDeleting(undefined);
            notify('Room removed. Devices remain connected.');
          }}
        />
      )}
    </div>
  );
}
