import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import { deviceArea } from '../../model/registry';
import type { Area, Snapshot } from '../../model';
import type { RegistryController } from '../../ha/registry';
export function RoomDelete({
  room,
  snapshot,
  registry,
  onClose,
  onDeleted,
}: {
  room: Area;
  snapshot: Snapshot;
  registry: RegistryController;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const devices = snapshot.devices.filter(
    (device) => deviceArea(device, snapshot.devices) === room.area_id,
  ).length;
  const entities = snapshot.entities.filter(
    (entry) => !entry.device_id && entry.area_id === room.area_id,
  ).length;
  return (
    <Dialog
      title={`Remove ${room.name}?`}
      className="room-editor"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        {devices
          ? `${devices} ${devices === 1 ? 'device will' : 'devices will'} become unassigned. `
          : ''}
        {entities
          ? `${entities} standalone ${entities === 1 ? 'control will' : 'controls will'} become unassigned. `
          : ''}
        Your devices stay connected. Scenes and automations remain saved; any rules that target this
        room will need a new room.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="registry-dialog-actions">
        <Button variant="ghost" isDisabled={busy} onPress={onClose}>
          Keep room
        </Button>
        <Button
          variant="danger"
          isPending={busy}
          isDisabled={busy}
          onPress={() => {
            setBusy(true);
            setError('');
            void registry
              .deleteRoom(room.area_id)
              .then(onDeleted)
              .catch((reason) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
        >
          Remove room
        </Button>
      </div>
    </Dialog>
  );
}
