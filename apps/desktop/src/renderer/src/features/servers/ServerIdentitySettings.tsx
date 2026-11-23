/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausForm, Heading, SelectInput, Text, TextInput } from '@haus/ui';
import type { HomeServer } from './types';
import type { ServerDevicePreference, ServerRoom } from './server-rooms';
import { sanitizeServerIcon } from '../../model/server-icon';
import { ServerIconPicker } from './ServerIconPicker';

export function ServerIdentitySettings({
  server,
  rooms,
  preference,
  onSave,
}: {
  server: HomeServer;
  rooms: ServerRoom[];
  preference?: ServerDevicePreference;
  onSave: (value: ServerDevicePreference) => void | Promise<void>;
}) {
  const [name, setName] = useState(server.name);
  const [areaId, setAreaId] = useState(preference?.areaId ?? '');
  const [icon, setIcon] = useState(() => sanitizeServerIcon(preference?.icon));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed =
    name.trim() !== server.name ||
    areaId !== (preference?.areaId ?? '') ||
    icon !== sanitizeServerIcon(preference?.icon);
  return (
    <HausForm
      className="server-panel server-identity-settings"
      onSubmit={() => {
        if (busy || !name.trim() || !changed) return;
        setBusy(true);
        setError('');
        void Promise.resolve()
          .then(() =>
            onSave({
              ...preference,
              name: name.trim(),
              areaId,
              icon: icon || undefined,
            }),
          )
          .catch(() => setError('Your server details could not be saved. Try again.'))
          .finally(() => setBusy(false));
      }}
    >
      <Box className="server-section-heading">
        <Box>
          <Heading level={3}>At home</Heading>
          <Text semantic="p">Choose a familiar name, room and icon for this server.</Text>
        </Box>
      </Box>
      <Box className="server-identity-fields">
        <Text semantic="label" className="management-field">
          <Text>Name</Text>
          <TextInput value={name} maxLength={100} disabled={busy} onChange={setName} />
        </Text>
        <Text semantic="label" className="management-field">
          <Text>Room</Text>
          <SelectInput
            value={areaId}
            disabled={busy}
            options={[
              { value: '', label: 'Unassigned' },
              ...rooms.map((room) => ({ value: room.id, label: room.name })),
            ]}
            onChange={setAreaId}
          />
        </Text>
      </Box>
      <ServerIconPicker server={server} value={icon} onChange={setIcon} disabled={busy} />
      {error && (
        <Text semantic="p" className="form-error" role="alert">
          {error}
        </Text>
      )}
      <Box className="server-identity-actions">
        <HausButton
          type="submit"
          variant="secondary"
          isDisabled={!changed || !name.trim()}
          isPending={busy}
        >
          Save details
        </HausButton>
      </Box>
    </HausForm>
  );
}
