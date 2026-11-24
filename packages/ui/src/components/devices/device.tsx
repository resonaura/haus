/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import type { DeviceCategory } from '../../categories/index.js';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  type ColorValue,
} from '../../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../../ir/materials.js';
import { mergeStyleSpecs, type UiStyleSpec } from '../../ir/node.js';
import { useHausUi } from '../../primitives/context.js';
import { resolveColorToCss } from '../../renderers/contract.js';
import {
  Box,
  Pressable,
  Text,
  type BoxProps,
  type PressableProps,
} from '../../primitives/elements.js';
import { DEVICE_ICONS, type UiIconName } from '../icons.js';
import { UiIcon } from '../icon.js';

/** Presentation data only. Apps resolve provider state and own device actions. */
export interface DeviceTileData {
  readonly name: string;
  readonly category?: DeviceCategory;
  readonly categoryLabel?: string;
  readonly state: string;
  readonly available: boolean;
  readonly favorite?: boolean;
}

export interface DeviceTileProps extends DeviceTileData {
  readonly compact?: boolean;
  readonly desktop?: boolean;
  readonly accent?: ColorValue;
  readonly frame?: BoxProps;
  readonly subtitle?: ReactNode;
  readonly stateKey?: string;
  readonly icon?: ReactNode;
  readonly iconName?: UiIconName;
  readonly indicators?: ReactNode;
  readonly actions?: ReactNode;
  readonly details?: ReactNode;
  readonly quickLabel?: string;
  readonly quickDisabled?: boolean;
  readonly onQuick?: () => void;
  readonly onOpen?: () => void;
  readonly opened?: boolean;
  readonly selected?: boolean;
}

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
    layout: { width: px(44), height: px(44), alignItems: 'center', justifyContent: 'center' },
  },
  indicators: { layout: { position: 'absolute', inset: { top: px(0), right: px(0) } } },
  body: {
    layout: { direction: 'column', minWidth: px(0), flexGrow: 1, flexShrink: 1, gap: px(2) },
  },
  subtitle: { typography: { size: 12, color: colorToken('textSecondary'), maxLines: 1 } },
  name: { typography: { size: 16, weight: 500, color: colorToken('textPrimary'), maxLines: 2 } },
  state: { typography: { size: 14, color: colorToken('textSecondary'), maxLines: 2 } },
} satisfies Record<string, UiStyleSpec>;

const desktopStyles = {
  frame: {
    layout: {
      display: 'flex',
      direction: 'column',
      minHeight: px(126),
      padding: insets(13, 14),
      position: 'relative',
    },
    material: new SolidMaterial(colorToken('card')),
    border: { width: 1, color: colorToken('borderSubtle') },
    corners: corners(26),
  },
  top: {
    layout: {
      direction: 'row',
      alignItems: 'center',
      justifyContent: 'between',
      margin: insets(0, 0, 11, 0),
    },
  },
  icon: {
    layout: { width: px(32), height: px(32), alignItems: 'center', justifyContent: 'center' },
    corners: corners(16),
  },
  indicators: { layout: { direction: 'row', alignItems: 'center', gap: px(8) } },
  body: { layout: { direction: 'column', width: pct(100), alignItems: 'start', gap: px(2) } },
  subtitle: { typography: { size: 10, color: colorToken('textMuted'), maxLines: 1 } },
  name: { typography: { size: 13, weight: 600, color: colorToken('textPrimary'), maxLines: 1 } },
  state: { typography: { size: 11, color: colorToken('textMuted'), maxLines: 1 } },
} satisfies Record<string, UiStyleSpec>;

export function DeviceTile({
  name,
  state,
  available,
  category,
  categoryLabel,
  favorite,
  compact = false,
  desktop = false,
  accent,
  frame,
  subtitle = categoryLabel,
  stateKey,
  icon,
  iconName = DEVICE_ICONS[category ?? 'other'],
  indicators,
  actions,
  details,
  quickLabel = `Quick control ${name}`,
  quickDisabled = !available,
  onQuick,
  onOpen,
  opened,
  selected,
}: DeviceTileProps) {
  const { theme } = useHausUi();
  const styles = desktop ? desktopStyles : compact ? compactStyles : undefined;
  const iconColor = resolveColorToCss(
    accent ?? colorToken(available ? 'textPrimary' : 'textMuted'),
    theme,
    false,
  );
  const tileIcon = (key: UiIconName, size: number) => (
    <UiIcon name={key} size={size} color={iconColor} />
  );
  const indicatorsContent = indicators ?? (favorite ? tileIcon('heart', 12) : undefined);
  const activeSurface: UiStyleSpec | undefined =
    desktop && accent
      ? {
          material: new GradientMaterial([
            { offset: 0, color: mixColor(colorToken('card'), accent, 0.22) },
            { offset: 1, color: colorToken('card') },
          ]),
          border: { width: 1, color: mixColor(colorToken('border'), accent, 0.35) },
        }
      : undefined;
  const frameStyle = styles
    ? mergeStyleSpecs(styles.frame, activeSurface, frame?.style)
    : frame?.style;
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
          {icon ?? tileIcon(iconName, desktop ? 20 : 21)}
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
