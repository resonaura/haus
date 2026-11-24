/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausForm, SelectInput, Text, TextInput } from '@haus/ui';
import { Dialog } from '@haus/ui/components';
import { HausIdProperties } from '../../../components/ui/haus-id';
import { nativeApi } from '../../../ha/management';
import { resolveDeviceHausId, type Device, type Snapshot } from '../../../model';
import { ExportSettings } from '../../devices/publication/export';

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

  const save = async () => {
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
      <Text semantic="p" className="registry-help">
        {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Connected device'}
      </Text>
      <HausIdProperties
        deviceHausId={resolveDeviceHausId(device, snapshot)}
        backendDeviceId={device.id}
      />
      <ExportSettings key={device.id} deviceId={device.id} canEdit={snapshot.user.is_admin} />
      <HausForm onSubmit={() => void save()}>
        <Text semantic="label" className="management-field">
          <Text>Device name</Text>
          <TextInput
            autoFocus
            required
            value={name}
            onChange={setName}
            placeholder="Friendly device name"
          />
        </Text>
        <Text semantic="label" className="management-field">
          <Text>Room / Area</Text>
          <SelectInput
            value={areaId}
            onChange={setAreaId}
            options={[
              { value: 'none', label: 'No area assigned' },
              ...snapshot.areas.map((area) => ({ value: area.area_id, label: area.name })),
            ]}
          />
        </Text>
        {error && (
          <Text semantic="p" role="alert" className="form-error">
            {error}
          </Text>
        )}
        <Box className="management-action-row">
          <HausButton type="button" variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton type="submit" isPending={busy} isDisabled={busy}>
            Save
          </HausButton>
        </Box>
      </HausForm>
    </Dialog>
  );
}
