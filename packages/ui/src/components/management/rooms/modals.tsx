/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';

export interface PortableRoomCandidate {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly currentRoomName: string;
  readonly selected: boolean;
}

export function RoomAddDevicesModal({
  roomName,
  query,
  candidates,
  selectedCount,
  busy,
  error,
  onQueryChange,
  onToggleCandidate,
  onConfirm,
  onClose,
}: {
  readonly roomName: string;
  readonly query: string;
  readonly candidates: readonly PortableRoomCandidate[];
  readonly selectedCount: number;
  readonly busy: boolean;
  readonly error?: string;
  readonly onQueryChange: (value: string) => void;
  readonly onToggleCandidate: (deviceId: string) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="md"
      title={`Add devices to ${roomName}`}
      subtitle="Move unassigned or other room accessories here."
      scrollable
      onClose={onClose}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={13}>Cancel</Text>
          </HausButton>
          <HausButton
            id="room-add-devices-submit"
            variant="primary"
            disabled={busy || selectedCount === 0}
            isPending={busy}
            onPress={onConfirm}
          >
            <Text
              size={13}
              style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}
            >
              {busy
                ? 'Moving…'
                : `Move ${selectedCount} ${selectedCount === 1 ? 'device' : 'devices'}`}
            </Text>
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
        <TextInput
          id="room-add-devices-search"
          ariaLabel="Find devices"
          placeholder="Search devices or rooms"
          value={query}
          onChange={onQueryChange}
          style={{
            layout: { width: pct(100), minHeight: px(38), padding: insets(8, 10) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(10),
            typography: { size: 13, color: colorToken('textPrimary') },
          }}
        />
        {error && (
          <Text role="alert" tone="critical" size={12.5}>
            {error}
          </Text>
        )}
        <Stack gapPx={6} style={{ layout: { width: pct(100), maxHeight: px(300), overflowY: 'scroll' } }}>
          {candidates.map((item) => (
            <Pressable
              key={item.id}
              id={`room-candidate-${item.id}`}
              ariaPressed={item.selected}
              onActivate={() => onToggleCandidate(item.id)}
              style={{
                layout: {
                  width: pct(100),
                  direction: 'row',
                  alignItems: 'center',
                  justifyContent: 'between',
                  padding: insets(10, 12),
                },
                cursor: 'pointer',
                material: new SolidMaterial(
                  item.selected ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: item.selected ? colorToken('accent') : colorToken('border') },
                corners: corners(10),
                transitionMs: 150,
                states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
              }}
            >
              <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
                <Text size={13} weight={600}>
                  {item.name}
                </Text>
                <Text size={11} tone="muted">
                  {item.detail ? `${item.detail} · ${item.currentRoomName}` : item.currentRoomName}
                </Text>
              </Stack>
              {item.selected && <UiIcon name="check" size={16} />}
            </Pressable>
          ))}
          {!candidates.length && (
            <Text size={12.5} tone="muted">
              All matching devices are already in this room.
            </Text>
          )}
        </Stack>
      </Stack>
    </HausDialog>
  );
}

export function RoomDeleteModal({
  roomName,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  readonly roomName: string;
  readonly busy: boolean;
  readonly error?: string;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="sm"
      title={`Remove ${roomName}?`}
      onClose={onClose}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={13}>Cancel</Text>
          </HausButton>
          <HausButton
            id="room-delete-confirm"
            variant="danger"
            disabled={busy}
            isPending={busy}
            onPress={onConfirm}
          >
            <Text size={13}>{busy ? 'Removing…' : 'Remove room'}</Text>
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={10}>
        <Text size={13} tone="muted" style={{ typography: { lineHeight: 1.5 } }}>
          Devices in this room will stay connected and become unassigned.
        </Text>
        {error && (
          <Text role="alert" tone="critical" size={12.5}>
            {error}
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}
