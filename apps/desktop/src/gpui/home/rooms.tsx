/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { Area } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import { RoomNameEditor, UiIcon } from '@haus/ui/components';
import { HausButton, Stack, Text } from '@haus/ui/primitives';
import { roomIcon } from './navigation.js';

export function RoomEditAction({
  room,
  registry,
  disabled,
  onSaved,
}: {
  room?: Area;
  registry?: Pick<RegistryController, 'saveRoom'>;
  disabled?: boolean;
  onSaved: (area: Area) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!registry) return null;
  return (
    <>
      <HausButton
        id={room ? 'edit-room' : 'create-room'}
        variant="outline"
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <UiIcon name={room ? 'settings-2' : 'plus'} size={16} />
        <Text size={13}>{room ? 'Room settings' : 'New room'}</Text>
      </HausButton>
      {open && (
        <RoomNameEditor
          initialName={room?.name}
          portable
          onClose={() => setOpen(false)}
          onSave={async (name) => {
            const saved = await registry.saveRoom(name, room?.area_id);
            setOpen(false);
            onSaved(saved);
          }}
        />
      )}
    </>
  );
}

export function RoomsList({
  rooms,
  openRoom,
}: {
  rooms: readonly Area[];
  openRoom: (id: string) => void;
}) {
  return (
    <Stack gapPx={8}>
      {rooms.map((room) => (
        <HausButton
          key={room.area_id}
          id={`room-${room.area_id}`}
          variant="secondary"
          onPress={() => openRoom(room.area_id)}
        >
          <UiIcon name={roomIcon(room.name)} size={18} />
          <Text>{room.name}</Text>
        </HausButton>
      ))}
      {!rooms.length && <Text tone="muted">No rooms yet.</Text>}
    </Stack>
  );
}
