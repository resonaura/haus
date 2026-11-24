/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useRef, useState } from 'react';
import { HausForm } from '../primitives/feedback.js';
import { HausButton } from '../primitives/controls.js';
import { Box, Stack, Text } from '../primitives/elements.js';
import { TextInput } from '../primitives/media.js';
import { colorToken, corners, insets, px } from '../ir/geometry.js';
import { SolidMaterial } from '../ir/materials.js';
import { Dialog } from './dialog.js';

export function RoomNameEditor({
  initialName,
  onClose,
  onSave,
  portable = false,
}: {
  initialName?: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  portable?: boolean;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const close = () => {
    if (!pending.current) onClose();
  };
  const submit = async () => {
    if (pending.current || !name.trim()) return;
    setError('');
    pending.current = true;
    setBusy(true);
    try {
      await onSave(name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the room.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const field = (
    <TextInput
      id="room-name"
      ariaLabel="Room name"
      autoFocus
      required
      maxLength={120}
      disabled={busy}
      value={name}
      onChange={setName}
      onSubmit={portable ? () => void submit() : undefined}
      style={
        portable
          ? {
              layout: { minHeight: px(40), padding: insets(8, 11) },
              material: new SolidMaterial(colorToken('soft')),
              corners: corners(10),
            }
          : undefined
      }
    />
  );
  const content = (
    <>
      {portable ? (
        <>
          <Text size={12}>Room name</Text>
          {field}
        </>
      ) : (
        <Text semantic="label" className="management-field">
          <Text>Room name</Text>
          {field}
        </Text>
      )}
      <Text semantic="p" className="registry-help" tone={portable ? 'muted' : undefined}>
        Keep rooms consistent across your home. Devices and scenes keep their settings.
      </Text>
      {error && (
        <Text
          semantic="p"
          role="alert"
          className="form-error"
          tone={portable ? 'critical' : undefined}
        >
          {error}
        </Text>
      )}
      <Box
        className="registry-dialog-actions"
        style={
          portable ? { layout: { direction: 'row', justifyContent: 'end', gap: px(8) } } : undefined
        }
      >
        <HausButton variant="ghost" disabled={busy} onPress={close}>
          Cancel
        </HausButton>
        <HausButton
          id="room-save"
          type={portable ? 'button' : 'submit'}
          isPending={busy}
          disabled={busy || !name.trim()}
          onPress={portable ? () => void submit() : undefined}
        >
          {initialName === undefined ? 'Create room' : 'Save'}
        </HausButton>
      </Box>
    </>
  );
  return (
    <Dialog
      title={initialName === undefined ? 'New room' : 'Room settings'}
      className="room-editor"
      onClose={close}
    >
      {portable ? (
        <Stack gapPx={10}>{content}</Stack>
      ) : (
        <HausForm onSubmit={() => void submit()}>{content}</HausForm>
      )}
    </Dialog>
  );
}
