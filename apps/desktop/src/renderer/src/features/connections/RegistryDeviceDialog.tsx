/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Box, HausButton, HausForm, SelectInput, Text, TextInput } from '@haus/ui';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '@haus/ui/components';
import { HausIdProperties } from '../../components/ui/haus-id';
import { resolveDeviceHausId, type Device, type Snapshot } from '../../model';
import { ExportSettings } from '../devices/publication/export';
import type { RegistryController } from '../../ha/registry';
import { tuyaPendingCopy, type TuyaPendingCamera } from './flow/tuya-camera-pending';
export function RegistryDeviceDialog({
  device,
  snapshot,
  registry,
  pendingTuya,
  onFinishTuyaSetup,
  onClose,
  onSaved,
}: {
  device: Device;
  snapshot: Snapshot;
  registry: RegistryController;
  pendingTuya?: TuyaPendingCamera;
  onFinishTuyaSetup?: (pending: TuyaPendingCamera) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(device.name_by_user || device.name || '');
  const [areaId, setAreaId] = useState(device.area_id ?? 'none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingCopy = pendingTuya ? tuyaPendingCopy(pendingTuya.reason) : undefined;
  return (
    <Dialog
      title="Device settings"
      className="room-editor"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Text semantic="p" className="registry-help">
        {[device.manufacturer, device.model].filter(Boolean).join(' · ') || 'Your connected device'}
      </Text>
      <HausIdProperties
        deviceHausId={resolveDeviceHausId(device, snapshot)}
        backendDeviceId={device.id}
      />
      <ExportSettings key={device.id} deviceId={device.id} canEdit={snapshot.user.is_admin} />
      {pendingTuya && pendingCopy && (
        <Box className="flow-warning-box" role="note">
          <AlertTriangle size={18} />
          <Box className="registry-tuya-warning-copy">
            <Text semantic="strong">{pendingCopy.badge}</Text>
            <Text semantic="p">{pendingCopy.detail}</Text>
            {snapshot.user.is_admin && onFinishTuyaSetup && (
              <HausButton
                size="sm"
                className="finish-setup-pill"
                onPress={() => onFinishTuyaSetup(pendingTuya)}
              >
                {pendingCopy.action}
              </HausButton>
            )}
          </Box>
        </Box>
      )}
      <HausForm
        onSubmit={() => {
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
        <Text semantic="label" className="management-field">
          <Text>Device name</Text>
          <TextInput
            autoFocus
            required
            maxLength={150}
            value={name}
            disabled={!snapshot.user.is_admin || busy}
            onChange={setName}
          />
        </Text>
        <Text semantic="p" className="registry-help">
          Used across your home. Individually named controls keep their names.
        </Text>
        <Text semantic="label" className="management-field">
          <Text>Room</Text>
          <SelectInput
            ariaLabel="Device room"
            value={areaId}
            disabled={!snapshot.user.is_admin || busy}
            onChange={setAreaId}
            options={[
              {
                value: 'none',
                label: device.parent_device_id ? 'Follow parent room' : 'Unassigned',
              },
              ...snapshot.areas.map((area) => ({ value: area.area_id, label: area.name })),
            ]}
          />
        </Text>
        {snapshot.entities.some((entry) => entry.device_id === device.id && entry.area_id) && (
          <Text semantic="p" className="registry-help">
            Individually assigned controls keep their rooms.
          </Text>
        )}
        {error && (
          <Text semantic="p" role="alert" className="form-error">
            {error}
          </Text>
        )}
        <Box className="registry-dialog-actions">
          <HausButton variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </HausButton>
          <HausButton
            type="submit"
            isPending={busy}
            isDisabled={!snapshot.user.is_admin || busy || !name.trim()}
          >
            Save
          </HausButton>
        </Box>
      </HausForm>
    </Dialog>
  );
}
