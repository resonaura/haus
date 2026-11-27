/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  missingSceneTargetName,
  resolveSceneTargetVisual,
  type SceneEntityLike,
} from '@haus/core/transport';
import type { DeviceCategory } from '../../categories/index.js';
import { colorToken, corners, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { Box } from '../../primitives/index.js';
import type { DeviceBrandIconInput } from '../brand/types.js';
import { DeviceTile } from '../devices/device.js';
import { parseCssColor } from '../devices/tile-theme.js';
import { UiIcon } from '../icon.js';
import type { UiIconName } from '../icons.js';

export interface SceneControllableDevice {
  readonly entityId: string;
  readonly name: string;
  readonly roomId?: string;
  readonly roomName: string;
  readonly category: DeviceCategory;
  readonly iconName?: UiIconName;
  readonly deviceIcon?: DeviceBrandIconInput;
  readonly entity: SceneEntityLike;
  readonly liveStateText: string;
  readonly pickerEligible: boolean;
}

const DOMAIN_TO_CATEGORY: Readonly<Record<string, DeviceCategory>> = {
  light: 'lights',
  switch: 'outlets',
  input_boolean: 'outlets',
  climate: 'climate',
  fan: 'climate',
  cover: 'covers',
  lock: 'security',
  media_player: 'media',
  water_heater: 'water',
};

export function ScenePresentTile({
  device,
  setting,
  included,
  adding,
  selected,
  onToggleInclude,
  onQuickToggle,
  onSelectToggle,
}: {
  readonly device: SceneControllableDevice;
  readonly setting: unknown;
  readonly included: boolean;
  readonly adding: boolean;
  readonly selected: boolean;
  readonly onToggleInclude: () => void;
  readonly onQuickToggle: () => void;
  readonly onSelectToggle: () => void;
}) {
  const useDraft = adding ? included : true;
  const visual = useDraft
    ? resolveSceneTargetVisual(device.entityId, device.entity, setting)
    : undefined;

  const selectionBadge = adding ? (
    <Box
      ariaHidden
      style={{
        layout: {
          width: px(22),
          height: px(22),
          alignItems: 'center',
          justifyContent: 'center',
        },
        material: new SolidMaterial(
          included ? colorToken('accent') : rgba(128, 128, 128, 0.18),
        ),
        border: {
          width: 1,
          color: included ? colorToken('accent') : colorToken('border'),
        },
        corners: corners(999, 'round'),
      }}
    >
      {included && <UiIcon name="check" size={12} color="#101010" />}
    </Box>
  ) : undefined;

  return (
    <DeviceTile
      frame={{ id: `scene-tile-${device.entityId}` }}
      desktop
      name={device.name}
      category={device.category}
      subtitle={device.roomName}
      state={useDraft && visual ? visual.stateText : device.liveStateText}
      available
      active={useDraft && visual ? visual.active : device.entity.state === 'on'}
      accent={useDraft && visual ? parseCssColor(visual.accentCss) : undefined}
      colorSwatch={useDraft && visual ? parseCssColor(visual.swatchCss) : undefined}
      showStatusDot={!adding}
      topRight={selectionBadge}
      iconName={device.iconName}
      deviceIcon={device.deviceIcon}
      selected={adding ? included : selected}
      opened={!adding && selected}
      quickLabel={
        adding
          ? `${included ? 'Remove' : 'Include'} ${device.name}`
          : `Toggle ${device.name} target state`
      }
      onQuick={adding ? onToggleInclude : onQuickToggle}
      onOpen={adding ? onToggleInclude : onSelectToggle}
      onMore={adding ? undefined : onSelectToggle}
    />
  );
}

export function SceneMissingTile({
  id,
  setting,
  adding,
  selected,
  onRemove,
  onSelectToggle,
}: {
  readonly id: string;
  readonly setting: unknown;
  readonly adding: boolean;
  readonly selected: boolean;
  readonly onRemove: () => void;
  readonly onSelectToggle: () => void;
}) {
  const visual = resolveSceneTargetVisual(id, undefined, setting);
  const displayName = missingSceneTargetName(id);
  const category = DOMAIN_TO_CATEGORY[visual.domain] ?? 'other';
  const savedSwatch = parseCssColor(visual.swatchCss);

  return (
    <DeviceTile
      frame={{ id: `scene-missing-${id}` }}
      desktop
      name={displayName}
      category={category}
      subtitle="Unavailable"
      state={visual.stateText}
      available={false}
      active={false}
      showStatusDot={false}
      topRight={
        adding ? (
          <Box
            ariaHidden
            style={{
              layout: {
                width: px(22),
                height: px(22),
                alignItems: 'center',
                justifyContent: 'center',
              },
              material: new SolidMaterial(colorToken('accent')),
              corners: corners(999, 'round'),
            }}
          >
            <UiIcon name="check" size={12} color="#101010" />
          </Box>
        ) : savedSwatch ? (
          <Box
            ariaHidden
            style={{
              layout: { width: px(12), height: px(12) },
              material: new SolidMaterial(savedSwatch),
              corners: corners(999, 'round'),
              border: { width: 1, color: rgba(255, 255, 255, 0.3) },
            }}
          />
        ) : undefined
      }
      selected={adding ? true : selected}
      opened={!adding && selected}
      quickDisabled={!adding}
      onQuick={adding ? onRemove : undefined}
      onOpen={adding ? onRemove : onSelectToggle}
      onMore={adding ? undefined : onSelectToggle}
    />
  );
}
