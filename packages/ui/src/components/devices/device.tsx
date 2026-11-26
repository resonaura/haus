/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { LightEffectOption } from '@haus/core/device';
import type { DeviceCategory } from '../../categories/index.js';
import { colorToken, corners, insets, px } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { mergeStyleSpecs, type UiStyleSpec } from '../../ir/node.js';
import { useHausUi } from '../../primitives/context.js';
import { Box, Pressable, Text, type PressableProps } from '../../primitives/elements.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';
import { UiIcon } from '../icon.js';
import { DeviceBrandIcon } from '../brand/device-icon.js';
import { DesktopDeviceTile, type DesktopTileRenderProps } from './tile-desktop.js';

export interface DeviceTileBatteryData {
  readonly level?: number;
  readonly charging?: boolean;
  readonly powerConnected?: boolean;
}

/** Presentation data only. Apps resolve provider state and own device actions. */
export interface DeviceTileData {
  readonly name: string;
  readonly category?: DeviceCategory;
  readonly categoryLabel?: string;
  readonly state: string;
  readonly available: boolean;
  readonly favorite?: boolean;
}

export interface DeviceTileProps extends DesktopTileRenderProps {}

const compactStyles = {
  frame: {
    layout: {
      display: 'flex',
      direction: 'row',
      alignItems: 'center',
      minHeight: px(68),
      gap: px(12),
      padding: insets(8, 12),
      margin: { bottom: px(8) },
    },
    material: new SolidMaterial(colorToken('card')),
    border: { width: 1, color: colorToken('borderSubtle') },
    corners: corners(16),
  },
  top: { layout: { direction: 'column', position: 'relative' } },
  icon: {
    layout: {
      width: px(44),
      height: px(44),
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    corners: corners(999, 'round'),
  },
  indicators: { layout: { position: 'absolute', inset: { top: px(0), right: px(0) } } },
  body: {
    layout: { direction: 'column', minWidth: px(0), flexGrow: 1, flexShrink: 1, gap: px(2) },
  },
  subtitle: { typography: { size: 12, color: colorToken('textSecondary'), maxLines: 1 } },
  name: { typography: { size: 16, weight: 500, color: colorToken('textPrimary'), maxLines: 2 } },
  state: { typography: { size: 14, color: colorToken('textSecondary'), maxLines: 2 } },
} satisfies Record<string, UiStyleSpec>;

export function DeviceTile(props: DeviceTileProps) {
  if (props.desktop) return <DesktopDeviceTile {...props} />;
  const {
    name,
    state,
    available,
    category,
    categoryLabel,
    favorite,
    compact = false,
    accent,
    frame,
    subtitle = categoryLabel,
    stateKey,
    icon,
    iconName = DEVICE_ICONS[category ?? 'other'],
    deviceIcon,
    indicators,
    actions,
    details,
    quickLabel = `Quick control ${name}`,
    quickDisabled = !available,
    onQuick,
    onOpen,
    opened,
    selected,
  } = props;
  const { theme } = useHausUi();
  const styles = compact ? compactStyles : undefined;
  const iconColor = resolveColorToCss(
    accent ?? colorToken(available ? 'textPrimary' : 'textMuted'),
    theme,
    false,
  );
  const tileIcon = (key: UiIconName, size: number) => (
    <UiIcon name={key} size={size} color={iconColor} />
  );
  const indicatorsContent = indicators ?? (favorite ? tileIcon('heart', 12) : undefined);
  const frameStyle = styles ? mergeStyleSpecs(styles.frame, frame?.style) : frame?.style;
  const tile = (
    <Box semantic="article" {...frame} style={frameStyle}>
      <Box className="tile-top" style={styles?.top}>
        <TileAction
          id={frame?.id && `${frame.id}-quick`}
          className="accessory-icon"
          ariaLabel={quickLabel}
          disabled={quickDisabled}
          onActivate={onQuick}
          style={styles?.icon}
        >
          {icon ??
            (deviceIcon ? (
              <DeviceBrandIcon
                device={deviceIcon}
                size={21}
                color={iconColor}
                fallbackIconName={iconName}
              />
            ) : (
              tileIcon(iconName, 21)
            ))}
        </TileAction>
        {styles ? (
          indicatorsContent && (
            <Box
              style={styles?.indicators}
              ariaLabel={indicators === undefined ? 'Favorite' : undefined}
            >
              {indicatorsContent}
            </Box>
          )
        ) : (
          <Text>{indicatorsContent}</Text>
        )}
      </Box>
      <TileAction
        id={frame?.id && `${frame.id}-details`}
        className="tile-body"
        ariaPressed={selected}
        ariaExpanded={opened}
        onActivate={onOpen}
        style={styles?.body}
      >
        {(!styles || Boolean(subtitle)) && (
          <Text semantic="small" style={styles?.subtitle}>
            {subtitle}
          </Text>
        )}
        <Text semantic="strong" style={styles?.name}>
          {name}
        </Text>
        <Text key={stateKey} className="device-state-text" style={styles?.state}>
          {compact && !available ? 'Unavailable' : state}
        </Text>
      </TileAction>
      {actions}
    </Box>
  );
  if (details == null) return tile;
  return (
    <Box>
      {tile}
      {opened && <Box style={{ layout: { padding: insets(0, 12, 8, 12) } }}>{details}</Box>}
    </Box>
  );
}

function TileAction(props: PressableProps) {
  if (props.onActivate) return <Pressable {...props} />;
  return (
    <Box className={props.className} style={props.style}>
      {props.children}
    </Box>
  );
}

export type { LightEffectOption };
