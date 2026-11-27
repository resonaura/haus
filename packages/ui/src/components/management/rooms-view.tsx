/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
} from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  Heading,
  Pressable,
  Row,
  Stack,
  Text,
  TextInput,
  useHausUi,
} from '../../primitives/index.js';
import { GlassRim } from '../../primitives/glass-rim.js';
import { buildTileFrameStyle, getDeviceTileTokens } from '../devices/tile-theme.js';
import { DashboardGrid } from '../home.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export {
  RoomAddDevicesModal,
  RoomDeleteModal,
  type PortableRoomCandidate,
} from './rooms/modals.js';

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

function RoomManagementCard({
  room,
  picking,
  canManage,
  iconOptions,
  onTogglePicker,
  onSelectIcon,
  onOpenRoom,
  onAddDevices,
  onEditRoom,
  onDeleteRoom,
}: {
  readonly room: PortableRoomCardItem;
  readonly picking: boolean;
  readonly canManage: boolean;
  readonly iconOptions: readonly PortableRoomIconChoice[];
  readonly onTogglePicker: () => void;
  readonly onSelectIcon: (iconId: string) => void;
  readonly onOpenRoom: () => void;
  readonly onAddDevices: () => void;
  readonly onEditRoom: () => void;
  readonly onDeleteRoom: () => void;
}) {
  const { theme, viewport } = useHausUi();
  const [hovered, setHovered] = useState(false);
  const tokens = getDeviceTileTokens(theme.mode);
  const frameLayout = buildTileFrameStyle({
    mode: theme.mode,
    active: false,
    hovered,
    highContrast: viewport.highContrast,
    reducedTransparency: viewport.reducedTransparency,
    deviceColor: tokens.deviceNeutral,
    hasRestore: false,
  });

  return (
    <Box
      semantic="article"
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        layout: {
          display: 'flex',
          direction: 'column',
          justifyContent: 'between',
          gap: px(18),
          width: pct(100),
          minHeight: px(142),
          padding: insets(18),
          position: 'relative',
          overflow: 'hidden',
        },
        material: frameLayout.material,
        border: frameLayout.border,
        shadows: frameLayout.shadows,
        corners: corners(26),
        transitionMs: 220,
      }}
    >
      {frameLayout.sheenMaterial && (
        <Box
          ariaHidden
          style={{
            layout: { position: 'absolute', inset: insets(0), width: pct(100), height: pct(100) },
            corners: corners(25),
            pointerEvents: 'none',
            material: frameLayout.sheenMaterial,
          }}
        />
      )}

      <Row
        align="center"
        justify="between"
        gapPx={8}
        style={{ layout: { width: pct(100), position: 'relative', zIndex: 1 } }}
      >
        <Pressable
          id={`room-icon-${room.id}`}
          ariaLabel={`Change ${room.name} icon`}
          ariaExpanded={picking}
          onActivate={onTogglePicker}
          style={{
            layout: { width: px(38), height: px(38), alignItems: 'center', justifyContent: 'center' },
            cursor: 'pointer',
            material: new SolidMaterial(
              mixColor(transparentColor, colorToken('ink'), picking ? 0.14 : 0.07),
            ),
            border: {
              width: 1,
              color: mixColor(transparentColor, colorToken('ink'), picking ? 0.22 : 0.1),
            },
            corners: corners(12),
            transitionMs: 160,
            states: {
              hover: {
                material: new SolidMaterial(mixColor(transparentColor, colorToken('ink'), 0.13)),
              },
              pressed: { transform: { scale: 0.94 } },
            },
          }}
        >
          <UiIcon name={room.iconName} size={18} />
        </Pressable>

        <Box style={{ opacity: hovered || picking ? 1 : 0, transitionMs: 160 }}>
          <Row align="center" gapPx={2}>
            <HausButton
              id={`room-add-devices-${room.id}`}
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label={`Add devices to ${room.name}`}
              disabled={!canManage}
              onPress={onAddDevices}
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
              onPress={onEditRoom}
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
              onPress={onDeleteRoom}
            >
              <UiIcon name="trash-2" size={15} />
            </HausButton>
          </Row>
        </Box>
      </Row>

      {picking && (
        <Row gapPx={6} wrap style={{ layout: { width: pct(100), position: 'relative', zIndex: 1 } }}>
          {iconOptions.map((opt) => {
            const active = room.iconId === opt.id;
            return (
              <Pressable
                key={opt.id}
                id={`room-icon-option-${room.id}-${opt.id}`}
                ariaLabel={opt.label}
                ariaPressed={active}
                onActivate={() => onSelectIcon(opt.id)}
                style={{
                  layout: {
                    padding: insets(5, 8),
                    direction: 'row',
                    alignItems: 'center',
                    gap: px(5),
                  },
                  cursor: 'pointer',
                  material: new SolidMaterial(
                    active ? colorToken('surfaceActive') : colorToken('surface'),
                  ),
                  border: {
                    width: 1,
                    color: active ? colorToken('accent') : colorToken('border'),
                  },
                  corners: corners(9),
                  transitionMs: 150,
                  states: {
                    hover: { material: new SolidMaterial(colorToken('surfaceHover')) },
                    pressed: { transform: { scale: 0.96 } },
                  },
                }}
              >
                <UiIcon name={opt.iconName} size={14} />
                <Text size={11}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </Row>
      )}

      <Pressable
        id={`room-${room.id}`}
        onActivate={onOpenRoom}
        style={{
          layout: {
            width: pct(100),
            direction: 'column',
            alignItems: 'start',
            gap: px(6),
            position: 'relative',
            zIndex: 1,
          },
          cursor: 'pointer',
          material: new SolidMaterial(transparentColor),
          border: { width: 0, style: 'none', color: transparentColor },
        }}
      >
        <Text size={17} weight={600}>
          {room.name}
        </Text>
        <Row align="center" justify="between" style={{ layout: { width: pct(100) } }}>
          <Text size={12.5} tone="muted">
            {`${room.deviceCount} ${room.deviceCount === 1 ? 'device' : 'devices'}`}
          </Text>
          <UiIcon name="arrow-up-right" size={15} />
        </Row>
      </Pressable>

      <GlassRim preset="card" variant="card" opacity={hovered ? 0.78 : 0.54} />
    </Box>
  );
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
  const [unassignedHovered, setUnassignedHovered] = useState(false);

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
        <Box
          dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
          onPointerEnter={() => setUnassignedHovered(true)}
          onPointerLeave={() => setUnassignedHovered(false)}
          style={{
            layout: { width: pct(100), position: 'relative', overflow: 'hidden' },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(22),
            transitionMs: 200,
          }}
        >
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
                position: 'relative',
                zIndex: 1,
              },
              cursor: 'pointer',
              material: new SolidMaterial(transparentColor),
              border: { width: 0, style: 'none', color: transparentColor },
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
          <GlassRim preset="card" variant="card" opacity={unassignedHovered ? 0.74 : 0.5} />
        </Box>
      )}

      {!canManage && (
        <Text size={12} tone="muted">
          An administrator can create, rename or remove rooms.
        </Text>
      )}

      {rooms.length > 0 ? (
        <DashboardGrid columns={columns}>
          {rooms.map((room) => (
            <RoomManagementCard
              key={room.id}
              room={room}
              picking={iconMenuRoomId === room.id}
              canManage={canManage}
              iconOptions={iconOptions}
              onTogglePicker={() => setIconMenuRoomId((cur) => (cur === room.id ? null : room.id))}
              onSelectIcon={(iconId) => {
                onChangeIcon(room.id, iconId);
                setIconMenuRoomId(null);
              }}
              onOpenRoom={() => onOpenRoom(room.id)}
              onAddDevices={() => onAddDevices(room.id)}
              onEditRoom={() => onEditRoom(room.id)}
              onDeleteRoom={() => onDeleteRoom(room.id)}
            />
          ))}
        </DashboardGrid>
      ) : (
        <Stack
          align="center"
          gapPx={8}
          dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
          style={{
            layout: { width: pct(100), padding: insets(34, 20), position: 'relative', overflow: 'hidden' },
            material: new SolidMaterial(colorToken('surfaceSecondary')),
            border: { width: 1, color: colorToken('border') },
            corners: corners(20),
          }}
        >
          <UiIcon name="search" size={26} />
          <Heading level={3} size={16} weight={600}>
            {hasAnyRooms ? 'No rooms match' : 'Make room for home'}
          </Heading>
          <Text size={12.5} tone="muted">
            {hasAnyRooms ? 'Try another room name.' : 'Create a room to bring its devices together.'}
          </Text>
          <GlassRim preset="card" variant="card" opacity={0.48} />
        </Stack>
      )}
    </Stack>
  );
}
