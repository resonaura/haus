/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausDialog,
  HausSelect,
  HausSwitch,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { editorInputStyle } from './config-editor-sections.js';

export interface PortableDeviceMoveItem {
  readonly deviceId: string;
  readonly name: string;
  readonly fromRoomName: string;
  readonly toRoomName: string;
  readonly overrideCount: number;
}

export function RegistryDeviceModal({
  subtitle,
  hausId,
  backendDeviceId,
  name,
  areaId,
  areaOptions,
  canEdit,
  busy,
  error,
  onNameChange,
  onAreaChange,
  onSave,
  onClose,
}: {
  readonly subtitle: string;
  readonly hausId: string;
  readonly backendDeviceId: string;
  readonly name: string;
  readonly areaId: string;
  readonly areaOptions: readonly { readonly value: string; readonly label: string }[];
  readonly canEdit: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly onNameChange: (value: string) => void;
  readonly onAreaChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="md"
      title="Device settings"
      subtitle={subtitle}
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={13}>Cancel</Text>
          </HausButton>
          <HausButton
            id="registry-device-save"
            variant="primary"
            disabled={busy || !canEdit || !name.trim()}
            isPending={busy}
            onPress={onSave}
          >
            <Text size={13} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
              {busy ? 'Saving…' : 'Save'}
            </Text>
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        <Stack
          gapPx={8}
          style={{
            layout: { padding: insets(12) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <Row justify="between" gapPx={12}>
            <Text size={12} tone="muted">
              Haus ID
            </Text>
            <Text size={11.5} mono>
              {hausId}
            </Text>
          </Row>
          <Row justify="between" gapPx={12}>
            <Text size={12} tone="muted">
              Device ID
            </Text>
            <Text size={11.5} mono>
              {backendDeviceId}
            </Text>
          </Row>
        </Stack>

        <Stack gapPx={6}>
          <Text size={12} weight={600} tone="muted">
            Device name
          </Text>
          <TextInput
            id="registry-device-name"
            ariaLabel="Device name"
            maxLength={150}
            value={name}
            disabled={!canEdit || busy}
            onChange={onNameChange}
            style={editorInputStyle}
          />
          <Text size={11} tone="muted">
            Used across your home. Individually named controls keep their names.
          </Text>
        </Stack>

        <Stack gapPx={6}>
          <Text size={12} weight={600} tone="muted">
            Room
          </Text>
          <HausSelect
            id="registry-device-room"
            aria-label="Room"
            value={areaId}
            options={areaOptions}
            disabled={!canEdit || busy}
            onChange={onAreaChange}
          />
        </Stack>

        {error && (
          <Text role="alert" tone="critical" size={12.5}>
            {error}
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}

export function DeviceMoveModal({
  deviceCount,
  destination,
  areaOptions,
  hasOverrides,
  moveOverrides,
  plan,
  busy,
  error,
  onDestinationChange,
  onToggleOverrides,
  onConfirm,
  onClose,
}: {
  readonly deviceCount: number;
  readonly destination: string;
  readonly areaOptions: readonly { readonly value: string; readonly label: string }[];
  readonly hasOverrides: boolean;
  readonly moveOverrides: boolean;
  readonly plan: readonly PortableDeviceMoveItem[];
  readonly busy: boolean;
  readonly error?: string;
  readonly onDestinationChange: (value: string) => void;
  readonly onToggleOverrides: (checked: boolean) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <HausDialog
      size="md"
      title="Move devices"
      subtitle={`Give ${deviceCount === 1 ? 'this device' : `${deviceCount} devices`} a new place in your home.`}
      scrollable
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Row justify="end" gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton variant="ghost" disabled={busy} onPress={onClose}>
            <Text size={13}>Cancel</Text>
          </HausButton>
          <HausButton
            id="device-move-confirm"
            variant="primary"
            disabled={busy || !destination || !plan.length}
            isPending={busy}
            onPress={onConfirm}
          >
            <Text size={13} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
              {busy ? 'Moving…' : `Move ${plan.length || deviceCount} ${plan.length === 1 ? 'device' : 'devices'}`}
            </Text>
          </HausButton>
        </Row>
      }
    >
      <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
        <Stack gapPx={6}>
          <Text size={12} weight={600} tone="muted">
            Destination room
          </Text>
          <HausSelect
            id="device-move-destination"
            aria-label="Destination room"
            value={destination}
            options={areaOptions}
            disabled={busy}
            onChange={onDestinationChange}
          />
        </Stack>

        {hasOverrides && (
          <HausSwitch
            id="device-move-overrides"
            label="Also move controls assigned to another room"
            aria-label="Also move controls assigned to another room"
            checked={moveOverrides}
            disabled={busy}
            onChange={onToggleOverrides}
          />
        )}

        {plan.length > 0 && (
          <Stack gapPx={6} style={{ layout: { maxHeight: px(220), overflowY: 'scroll' } }}>
            {plan.map((item) => (
              <Box
                key={item.deviceId}
                style={{
                  layout: { padding: insets(10, 12) },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(10),
                }}
              >
                <Text size={13} weight={600}>
                  {item.name}
                </Text>
                <Text size={11.5} tone="muted">
                  {`${item.fromRoomName} -> ${item.toRoomName}${item.overrideCount ? ` (${item.overrideCount} controls)` : ''}`}
                </Text>
              </Box>
            ))}
          </Stack>
        )}

        {error && (
          <Text role="alert" tone="critical" size={12.5}>
            {error}
          </Text>
        )}
      </Stack>
    </HausDialog>
  );
}
