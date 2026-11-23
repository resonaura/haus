/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausForm, Text, TextInput } from '@haus/ui';
import { Dialog } from '../../components/ui/Dialog';
import { roomNameInput } from '../../model/registry';
import type { Area } from '../../model';
import type { RegistryController } from '../../ha/registry';

export function RoomEditor({
  room,
  areas,
  registry,
  onClose,
  onSaved,
}: {
  room?: Area;
  areas: Area[];
  registry: RegistryController;
  onClose: () => void;
  onSaved: (area: Area) => void;
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title={room ? 'Room settings' : 'New room'}
      className="room-editor"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <HausForm
        onSubmit={() => {
          setError('');
          try {
            roomNameInput(name, areas, room?.area_id);
          } catch (reason) {
            setError((reason as Error).message);
            return;
          }
          setBusy(true);
          void registry
            .saveRoom(name, room?.area_id)
            .then(onSaved)
            .catch((reason) => setError(reason.message))
            .finally(() => setBusy(false));
        }}
      >
        <Text semantic="label" className="management-field">
          <Text>Room name</Text>
          <TextInput autoFocus required maxLength={120} value={name} onChange={setName} />
        </Text>
        <Text semantic="p" className="registry-help">
          Keep rooms consistent across your home. Devices and scenes keep their settings.
        </Text>
        {error && (
          <Text semantic="p" role="alert" className="form-error">
            {error}
          </Text>
        )}
        <Box className="registry-dialog-actions">
          <HausButton variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton type="submit" isPending={busy} isDisabled={busy || !name.trim()}>
            {room ? 'Save' : 'Create room'}
          </HausButton>
        </Box>
      </HausForm>
    </Dialog>
  );
}
