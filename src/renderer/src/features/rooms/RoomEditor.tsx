import { useState } from 'react';
import { Button } from '@heroui/react';
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
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
        <label className="management-field">
          <span>Room name</span>
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="registry-help">
          Keep rooms consistent across your home. Devices and scenes keep their settings.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="registry-dialog-actions">
          <Button variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" isPending={busy} isDisabled={busy || !name.trim()}>
            {room ? 'Save' : 'Create room'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
