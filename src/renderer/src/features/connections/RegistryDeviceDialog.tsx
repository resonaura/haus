import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../components/ui/Dialog';
import type { Device, Snapshot } from '../../model';
import type { RegistryController } from '../../ha/registry';
export function RegistryDeviceDialog({
  device,
  snapshot,
  registry,
  onClose,
  onSaved,
}: {
  device: Device;
  snapshot: Snapshot;
  registry: RegistryController;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(device.name_by_user || device.name || '');
  const [areaId, setAreaId] = useState(device.area_id ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title="Device settings"
      className="room-editor"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Your connected device'}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void registry
            .updateDevice(device.id, {
              name_by_user: name,
              area_id: areaId === 'none' ? null : areaId,
            })
            .then(onSaved)
            .catch((reason) => setError(reason.message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="management-field">
          <span>Device name</span>
          <input
            autoFocus
            required
            maxLength={150}
            value={name}
            disabled={!snapshot.user.is_admin || busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="registry-help">
          Used across your home. Individually named controls keep their names.
        </p>
        <label className="management-field">
          <span>Room</span>
          <select
            aria-label="Device room"
            value={areaId}
            disabled={!snapshot.user.is_admin || busy}
            onChange={(event) => setAreaId(event.target.value)}
          >
            <option value="none">
              {device.parent_device_id ? 'Follow parent room' : 'Unassigned'}
            </option>
            {snapshot.areas.map((area) => (
              <option key={area.area_id} value={area.area_id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        {snapshot.entities.some((entry) => entry.device_id === device.id && entry.area_id) && (
          <p className="registry-help">Individually assigned controls keep their rooms.</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="registry-dialog-actions">
          <Button variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            isPending={busy}
            isDisabled={!snapshot.user.is_admin || busy || !name.trim()}
          >
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
