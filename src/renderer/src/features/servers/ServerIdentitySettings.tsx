import { useState } from 'react';
import { Button } from '@heroui/react';
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
    <form
      className="server-panel server-identity-settings"
      onSubmit={(event) => {
        event.preventDefault();
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
      <div className="server-section-heading">
        <div>
          <h3>At home</h3>
          <p>Choose a familiar name, room and icon for this server.</p>
        </div>
      </div>
      <div className="server-identity-fields">
        <label className="management-field">
          <span>Name</span>
          <input
            value={name}
            maxLength={100}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="management-field">
          <span>Room</span>
          <select
            value={areaId}
            disabled={busy}
            onChange={(event) => setAreaId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ServerIconPicker server={server} value={icon} onChange={setIcon} disabled={busy} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="server-identity-actions">
        <Button
          type="submit"
          variant="secondary"
          isDisabled={!changed || !name.trim()}
          isPending={busy}
        >
          Save details
        </Button>
      </div>
    </form>
  );
}
