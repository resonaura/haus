/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, Heading, Pressable, Text, TextInput } from '@haus/ui';
import { ArrowUpRight, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { RoomIconPicker } from './RoomIconPicker';
import { RoomEditor } from './RoomEditor';
import { RoomDelete } from './RoomDelete';
import { RoomAddDevicesDialog } from './RoomAddDevicesDialog';
import { mergeRoomIcons } from './room-candidates';
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
  const [addingDevices, setAddingDevices] = useState<Area>();
  const mergedIcons = mergeRoomIcons(snapshot.areas, roomIcons);
  const rooms = snapshot.areas
    .filter((area) => area.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const unassigned = snapshot.devices.filter(
    (device) => !deviceArea(device, snapshot.devices),
  ).length;
  return (
    <Box className="rooms-manager">
      <Box className="management-toolbar">
        <Text semantic="label" className="management-search">
          <Search size={17} />
          <TextInput
            ariaLabel="Search rooms"
            placeholder="Find a room"
            value={query}
            onChange={setQuery}
          />
        </Text>
        <HausButton
          variant="secondary"
          isDisabled={!snapshot.user.is_admin}
          onPress={() => setEditing(null)}
        >
          <Plus size={17} />
          New room
        </HausButton>
      </Box>
      {unassigned > 0 && (
        <Pressable className="room-unassigned" onPress={onDevices}>
          <Text>
            <Text semantic="strong">A place for everything</Text>
            <Text semantic="small">
              {unassigned} {unassigned === 1 ? 'device is' : 'devices are'} waiting for a room.
            </Text>
          </Text>
          <ArrowUpRight size={20} />
        </Pressable>
      )}
      {!snapshot.user.is_admin && (
        <Text semantic="p" className="registry-help">
          An administrator can create, rename or remove rooms.
        </Text>
      )}
      <Box className="room-management-grid">
        {rooms.map((room) => {
          const devices = snapshot.devices.filter(
            (device) => deviceArea(device, snapshot.devices) === room.area_id,
          ).length;
          return (
            <Box semantic="article" className="room-management-card" key={room.area_id}>
              <Box className="room-management-top">
                <RoomIconPicker
                  name={room.name}
                  value={mergedIcons[room.area_id]}
                  onChange={(icon) => onIcon(room.area_id, icon)}
                />
                <Box className="room-management-actions">
                  <HausButton
                    isIconOnly
                    variant="ghost"
                    aria-label={`Add devices to ${room.name}`}
                    isDisabled={!snapshot.user.is_admin}
                    onPress={() => setAddingDevices(room)}
                  >
                    <Plus size={17} />
                  </HausButton>
                  <HausButton
                    isIconOnly
                    variant="ghost"
                    aria-label={`Settings for ${room.name}`}
                    isDisabled={!snapshot.user.is_admin}
                    onPress={() => setEditing(room)}
                  >
                    <MoreHorizontal size={19} />
                  </HausButton>
                  <HausButton
                    isIconOnly
                    variant="ghost"
                    aria-label={`Remove ${room.name}`}
                    isDisabled={!snapshot.user.is_admin}
                    onPress={() => setDeleting(room)}
                  >
                    <Trash2 size={16} />
                  </HausButton>
                </Box>
              </Box>
              <Pressable className="room-management-open" onPress={() => onOpen(room.area_id)}>
                <Text semantic="strong">{room.name}</Text>
                <Text>
                  {devices} {devices === 1 ? 'device' : 'devices'}
                  <ArrowUpRight size={17} />
                </Text>
              </Pressable>
            </Box>
          );
        })}
      </Box>
      {!rooms.length && (
        <Box className="management-empty">
          <Search size={26} />
          <Heading level={3}>{query ? 'No rooms match' : 'Make room for home'}</Heading>
          <Text semantic="p">
            {query ? 'Try another room name.' : 'Create a room to bring its devices together.'}
          </Text>
          {!query && snapshot.user.is_admin && (
            <HausButton variant="secondary" onPress={() => setEditing(null)}>
              <Plus size={16} />
              Create room
            </HausButton>
          )}
        </Box>
      )}
      {addingDevices && (
        <RoomAddDevicesDialog
          room={addingDevices}
          snapshot={snapshot}
          registry={registry}
          onClose={() => setAddingDevices(undefined)}
          onAdded={(ids) =>
            notify(
              `${ids.length} ${ids.length === 1 ? 'device' : 'devices'} moved to ${addingDevices.name}.`,
            )
          }
        />
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
    </Box>
  );
}
