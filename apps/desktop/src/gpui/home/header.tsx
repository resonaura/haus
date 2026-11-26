/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Area } from '@haus/ha/types';
import type { RegistryController } from '@haus/ha/ui/registry';
import { sanitizeLiquidGlassSettings, type LiquidGlassSettings } from '@haus/ui';
import { HomeCategoryDock, UiIcon } from '@haus/ui/components';
import { insets } from '@haus/ui/ir';
import { HausButton, Heading, Row, Stack, Text } from '@haus/ui/primitives';
import type { GpuiAddDeviceRequest } from '../management/add-device.js';
import type { HomeRoute } from '../shell.js';
import type { homeDashboard } from './model.js';
import { RoomEditAction } from './rooms.js';

type HomeDashboard = ReturnType<typeof homeDashboard>;

export function WorkspacePageHeader({
  category,
  room,
  roomArea,
  route,
  search,
  heading,
  demo,
  isAdmin,
  disabled,
  registry,
  onGo,
  onAddDevice,
  onConnect,
  onRefresh,
}: {
  readonly category?: HomeDashboard['categories'][number];
  readonly room?: HomeDashboard['navigationRooms'][number];
  readonly roomArea?: Area;
  readonly route: HomeRoute;
  readonly search: boolean;
  readonly heading: string;
  readonly demo?: boolean;
  readonly isAdmin: boolean;
  readonly disabled: boolean;
  readonly registry?: Pick<RegistryController, 'saveRoom'>;
  readonly onGo: (route: HomeRoute) => void;
  readonly onAddDevice?: (request?: GpuiAddDeviceRequest) => void;
  readonly onConnect?: () => void;
  readonly onRefresh?: () => void;
}) {
  const eyebrow =
    route === 'servers'
      ? 'HOME SERVERS'
      : category || route === 'home'
        ? 'HAUS OVERVIEW'
        : room
          ? 'ROOM OVERVIEW'
          : 'THOUGHTFULLY CONNECTED';

  const subtitle =
    !search && route === 'home'
      ? 'Your home. A little closer.'
      : !search && route === 'servers'
        ? 'The machines that keep your home running.'
        : undefined;

  return (
    <Row justify="between" gapPx={10} style={{ layout: { margin: insets(0, 0, 22, 0) } }}>
      <Stack gapPx={0}>
        <Text
          tone="muted"
          size={8}
          weight={600}
          style={{
            typography: { letterSpacing: 0.25, lineHeight: 1.5 },
            layout: { margin: insets(0, 0, 7, 0) },
          }}
        >
          {eyebrow}
        </Text>
        <Heading
          id="desktop-page-title"
          level={1}
          size={28}
          weight={600}
          style={{ typography: { lineHeight: 1.08 } }}
        >
          {search ? 'Search' : heading}
        </Heading>
        {subtitle && (
          <Text tone="muted" size={12} style={{ typography: { lineHeight: 1.5 } }}>
            {subtitle}
          </Text>
        )}
      </Stack>
      <Row gapPx={8} align="center" wrap>
        {roomArea && (
          <RoomEditAction
            key={room?.id ?? 'new'}
            room={roomArea}
            registry={isAdmin ? registry : undefined}
            disabled={disabled}
            onSaved={(area) => onGo(`room:${area.area_id}`)}
          />
        )}
        {route === 'home' && (demo || isAdmin) && onAddDevice && (
          <HausButton
            id="home-add-device"
            variant="secondary"
            disabled={disabled}
            onPress={() => onAddDevice({ mode: 'picker' })}
          >
            <Row gapPx={6}>
              <UiIcon name="plus" size={15} />
              <Text size={12.5}>Add device</Text>
            </Row>
          </HausButton>
        )}
        {onConnect && (
          <HausButton id="connect-home" variant="outline" onPress={onConnect}>
            <Row gapPx={8}>
              <UiIcon name="plus" size={17} />
              <Text size={13}>Connect your home</Text>
            </Row>
          </HausButton>
        )}
        {onRefresh && (
          <HausButton id="hub-reconnect" variant="outline" disabled={disabled} onPress={onRefresh}>
            Refresh home
          </HausButton>
        )}
      </Row>
    </Row>
  );
}

export function WorkspaceCategoryRail({
  categories,
  route,
  activeCategory,
  bleedX,
  liquidGlass,
  onGo,
}: {
  readonly categories: HomeDashboard['categories'];
  readonly route: HomeRoute;
  readonly activeCategory?: HomeDashboard['categories'][number];
  readonly bleedX: number;
  readonly liquidGlass?: Partial<LiquidGlassSettings>;
  readonly onGo: (route: HomeRoute) => void;
}) {
  const items = [
    ...categories.filter((item) => item.id !== 'other'),
    { id: 'servers', name: 'Servers', summary: 'Storage & services' },
    ...categories.filter((item) => item.id === 'other'),
  ];
  const selected = route === 'servers' ? 'servers' : (activeCategory?.id ?? null);
  const glass = sanitizeLiquidGlassSettings(liquidGlass);

  return (
    <HomeCategoryDock
      categories={items}
      selected={selected}
      bleedX={bleedX}
      liquidGlass={{
        enabled: glass.enabled,
        refractionStrength: glass.refractionStrength,
        dispersion: glass.dispersion,
      }}
      onSelect={(id) => onGo(id === 'servers' ? 'servers' : id ? `category:${id}` : 'home')}
    />
  );
}
