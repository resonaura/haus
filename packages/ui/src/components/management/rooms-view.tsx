/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  HausButton,
  HausDialog,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
} from '../../primitives/index.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface PortableRoomCardItem {
  readonly id: string;
  readonly name: string;
  readonly iconId: string;
  readonly iconName: UiIconName;
  readonly deviceCount: number;
}

export interface PortableRoomIconChoice {
  readonly id: string;
  readonly label: string;
  readonly iconName: UiIconName;
}

export interface PortableRoomCandidate {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly currentRoomName: string;
  readonly selected: boolean;
}

export function RoomsManagerView({
  rooms,
  iconOptions,
  columns = 3,
  query,
  unassignedCount,
  canManage,
  hasAnyRooms,
  onQueryChange,
  onCreateRoom,
  onOpenDevices,
  onOpenRoom,
  onChangeIcon,
  onAddDevices,
  onEditRoom,
  onDeleteRoom,
}: {
  readonly rooms: readonly PortableRoomCardItem[];
  readonly iconOptions: readonly PortableRoomIconChoice[];
  readonly columns?: number;
  readonly query: string;
  readonly unassignedCount: number;
  readonly canManage: boolean;
  readonly hasAnyRooms: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onCreateRoom: () => void;
  readonly onOpenDevices: () => void;
  readonly onOpenRoom: (roomId: string) => void;
  readonly onChangeIcon: (roomId: string, iconId: string) => void;
  readonly onAddDevices: (roomId: string) => void;
  readonly onEditRoom: (roomId: string) => void;
  readonly onDeleteRoom: (roomId: string) => void;
}) {
  const [iconMenuRoomId, setIconMenuRoomId] = useState<string | null>(null);

  return (
    <Stack gapPx={18} style={{ layout: { width: pct(100) } }}>
      <Row align="center" gapPx={10} wrap style={{ layout: { width: pct(100) } }}>
        <Row
          align="center"
          gapPx={8}
          style={{
            layout: {
              flexGrow: 1,
              minWidth: px(200),
              minHeight: px(38),
              padding: insets(0, 12),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(12),
          }}
        >
          <UiIcon name="search" size={16} />
          <TextInput
            id="rooms-search"
            ariaLabel="Search rooms"
            placeholder="Find a room"
            value={query}
            onChange={onQueryChange}
            style={{
              layout: { flexGrow: 1, minWidth: px(0), height: px(34) },
              typography: { size: 13, color: colorToken('textPrimary') },
            }}
          />
        </Row>
        <HausButton
          id="create-room"
          variant="secondary"
          size="sm"
          disabled={!canManage}
          onPress={onCreateRoom}
        >
          <UiIcon name="plus" size={15} />
          <Text size={12.5}>New room</Text>
        </HausButton>
      </Row>

      {unassignedCount > 0 && (
        <Pressable
          id="rooms-unassigned"
          onActivate={onOpenDevices}
          style={{
            layout: {
              width: pct(100),
              direction: 'row',
              alignItems: 'center',
              justifyContent: 'between',
              padding: insets(16, 18),
            },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(18),
            states: { hover: { material: new SolidMaterial(colorToken('surfaceHover')) } },
          }}
        >
          <Stack gapPx={3}>
            <Text size={14} weight={600}>
              A place for everything
            </Text>
            <Text size={12} tone="muted">
              {`${unassignedCount} ${unassignedCount === 1 ? 'device is' : 'devices are'} waiting for a room.`}
            </Text>
          </Stack>
          <UiIcon name="arrow-up-right" size={18} />
        </Pressable>
      )}

      {!canManage && (
        <Text size={12} tone="muted">
          An administrator can create, rename or remove rooms.
        </Text>
      )}

      {rooms.length > 0 ? (
        <DashboardGrid columns={columns}>
          {rooms.map((room) => {
            const picking = iconMenuRoomId === room.id;
            return (
              <Stack
                key={room.id}
                gapPx={18}
                style={{
                  layout: { width: pct(100), padding: insets(18), position: 'relative' },
                  material: new SolidMaterial(colorToken('surfaceSecondary')),
                  border: { width: 1, color: colorToken('border') },
                  corners: corners(22, 'superellipse', 1.4),
                }}
              >
                <Row align="center" justify="between" gapPx={8} style={{ layout: { width: pct(100) } }}>
                  <Pressable
                    id={`room-icon-${room.id}`}
                    ariaLabel={`Change ${room.name} icon`}
                    ariaExpanded={picking}
                    onActivate={() => setIconMenuRoomId((cur) => (cur === room.id ? null : room.id))}
                    style={{
                      layout: { width: px(38), height: px(38), alignItems: 'center', justifyContent: 'center' },
                      material: new SolidMaterial(colorToken('surface')),
                      border: { width: 1, color: colorToken('borderSubtle') },
                      corners: corners(12),
                    }}
                  >
                    <UiIcon name={room.iconName} size={18} />
                  </Pressable>
                  <Row align="center" gapPx={2} style={{ opacity: 0.78 }}>
                    <HausButton
                      id={`room-add-devices-${room.id}`}
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Add devices to ${room.name}`}
                      disabled={!canManage}
                      onPress={() => onAddDevices(room.id)}
                    >
                      <UiIcon name="plus" size={15} />
                    </HausButton>
                    <HausButton
                      id={`room-edit-${room.id}`}
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Settings for ${room.name}`}
                      disabled={!canManage}
                      onPress={() => onEditRoom(room.id)}
                    >
                      <UiIcon name="more-horizontal" size={16} />
                    </HausButton>
                    <HausButton
                      id={`room-delete-${room.id}`}
                      isIconOnly
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${room.name}`}
                      disabled={!canManage}
                      onPress={() => onDeleteRoom(room.id)}
                    >
                      <UiIcon name="trash-2" size={15} />
                    </HausButton>
                  </Row>
                </Row>

                {picking && (
                  <Row gapPx={6} wrap style={{ layout: { width: pct(100) } }}>
                    {iconOptions.map((opt) => (
                      <Pressable
                        key={opt.id}
                        id={`room-icon-option-${room.id}-${opt.id}`}
                        ariaLabel={opt.label}
                        ariaPressed={room.iconId === opt.id}
                        onActivate={() => {
                          onChangeIcon(room.id, opt.id);
                          setIconMenuRoomId(null);
                        }}
                        style={{
                          layout: {
                            padding: insets(5, 8),
                            direction: 'row',
                            alignItems: 'center',
                            gap: px(5),
                          },
                          material: new SolidMaterial(
                            room.iconId === opt.id ? colorToken('surfaceActive') : colorToken('surface'),
                          ),
                          border: { width: 1, color: colorToken('border') },
                          corners: corners(9),
                        }}
                      >
                        <UiIcon name={opt.iconName} size={14} />
                        <Text size={11}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </Row>
                )}

                <Pressable
                  id={`room-${room.id}`}
                  onActivate={() => onOpenRoom(room.id)}
                  style={{ layout: { width: pct(100), gap: px(6) } }}
                >
                  <Text size={17.5} weight={600}>
                    {room.name}
                  </Text>
                  <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
                    <Text size={12.5} tone="muted">
                      {`${room.deviceCount} ${room.deviceCount === 1 ? 'device' : 'devices'}`}
                    </Text>
                    <UiIcon name="arrow-up-right" size={15} />
                  </Row>
                </Pressable>
              </Stack>
            );
          })}
        </DashboardGrid>
      ) : (
        <Stack
          align="center"
          gapPx={8}
          style={{
            layout: { width: pct(100), padding: insets(34, 20) },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(16),
          }}
        >
          <UiIcon name="search" size={26} />
          <Heading level={3} size={16} weight={600}>
            {hasAnyRooms ? 'No rooms match' : 'Make room for home'}
          </Heading>
          <Text size={12.5} tone="muted">
            {hasAnyRooms ? 'Try another room name.' : 'Create a room to bring its devices together.'}
          </Text>
        </Stack>
      )}
    </Stack>
  );
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
            <Text size={13} style={{ typography: { color: colorToken('accentForeground'), weight: 600 } }}>
              {busy ? 'Moving…' : `Move ${selectedCount} ${selectedCount === 1 ? 'device' : 'devices'}`}
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
                material: new SolidMaterial(
                  item.selected ? colorToken('surfaceActive') : colorToken('surfaceSecondary'),
                ),
                border: { width: 1, color: item.selected ? colorToken('accent') : colorToken('border') },
                corners: corners(10),
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
