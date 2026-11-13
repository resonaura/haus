/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog } from '../../../components/ui/Dialog';
import { nativeApi } from '../../../ha/management';
import type { Device, Snapshot } from '../../../model';

export function DeviceQuickEditDialog({
  device,
  snapshot,
  onClose,
  onSaved,
}: {
  device: Device;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(device.name_by_user || device.name || '');
  const [areaId, setAreaId] = useState(device.area_id ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await nativeApi().request({
        type: 'config/device_registry/update',
        device_id: device.id,
        name_by_user: name.trim() || null,
        area_id: areaId === 'none' ? null : areaId,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Device settings"
      className="room-editor"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="registry-help">
        {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Connected device'}
      </p>
      <form onSubmit={(e) => void save(e)}>
        <label className="management-field">
          <span>Device name</span>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friendly device name"
          />
        </label>
        <label className="management-field">
          <span>Room / Area</span>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="none">No area assigned</option>
            {snapshot.areas.map((area) => (
              <option key={area.area_id} value={area.area_id}>
                {area.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="management-action-row">
          <Button type="button" variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button type="submit" isPending={busy} isDisabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
