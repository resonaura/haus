/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { ReactNode } from 'react';
import {
  colorToken,
  corners,
  insets,
  mixColor,
  pct,
  px,
  transparentColor,
  type ColorValue,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import { useHausUi } from '../../../primitives/context.js';
import { GlassRim } from '../../../primitives/glass-rim.js';
import { Box, HausSwitch, Pressable, Row, Stack, Text } from '../../../primitives/index.js';
import { resolveColorToCss } from '../../../renderers/contract.js';
import { UiIcon } from '../../icon.js';
import type { UiIconName } from '../../icons.js';
import { DeviceTileIconOrb, DeviceTileWash } from '../tile-effects.js';

export function DeviceModalSurfaceCard({
  title,
  badge,
  children,
}: {
  readonly title?: string;
  readonly badge?: string;
  readonly children: ReactNode;
}) {
  return (
    <Stack
      gapPx={10}
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: { width: pct(100), padding: insets(14, 16), position: 'relative', overflow: 'hidden' },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('borderSubtle') },
        corners: corners(18),
      }}
    >
      {(title || badge) && (
        <Row justify="between" align="center" gapPx={8} style={{ layout: { width: pct(100) } }}>
          {title ? (
            <Text size={12} weight={600} tone="secondary">
              {title}
            </Text>
          ) : (
            <Box />
          )}
          {badge && (
            <Text size={11.5} tone="muted" mono>
              {badge}
            </Text>
          )}
        </Row>
      )}
      {children}
      <GlassRim preset="card" radiusPx={17} opacity={0.42} />
    </Stack>
  );
}

export function DeviceModalHeroBanner({
  id,
  title,
  subtitle,
  iconName,
  iconSlot,
  active,
  accentColor,
  disabled,
  switchChecked,
  onToggle,
}: {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly iconName: UiIconName;
  readonly iconSlot?: ReactNode;
  readonly active: boolean;
  readonly accentColor?: ColorValue;
  readonly disabled?: boolean;
  readonly switchChecked?: boolean;
  readonly onToggle?: () => void;
}) {
  const { theme } = useHausUi();
  const effectiveAccent = accentColor ?? colorToken('accent');

  return (
    <Box
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: {
          width: pct(100),
          padding: insets(14, 16),
          position: 'relative',
          overflow: 'hidden',
        },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: {
          width: 1,
          color: active
            ? mixColor(colorToken('borderSubtle'), effectiveAccent, 0.34)
            : colorToken('borderSubtle'),
        },
        corners: corners(20),
      }}
    >
      <DeviceTileWash active={active} deviceColor={effectiveAccent} />
      <Row
        justify="between"
        align="center"
        gapPx={12}
        style={{ layout: { width: pct(100), position: 'relative', zIndex: 1 } }}
      >
        <Row align="center" gapPx={12} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
          <DeviceTileIconOrb
            id={id ? `${id}-orb` : undefined}
            active={active}
            deviceColor={effectiveAccent}
            ariaLabel={onToggle ? `Toggle ${title}` : title}
            disabled={disabled}
            onQuick={onToggle}
            renderIcon={(orbColor) =>
              iconSlot ?? (
                <UiIcon
                  name={iconName}
                  size={19}
                  color={resolveColorToCss(orbColor, theme, false)}
                />
              )
            }
          />
          <Stack gapPx={2} style={{ layout: { minWidth: px(0), flexGrow: 1 } }}>
            <Text size={16} weight={600} style={{ typography: { maxLines: 1, truncate: true } }}>
              {title}
            </Text>
            {subtitle && (
              <Text
                size={12}
                tone="muted"
                style={{ typography: { maxLines: 1, truncate: true } }}
              >
                {subtitle}
              </Text>
            )}
          </Stack>
        </Row>
        {onToggle && switchChecked !== undefined && (
          <HausSwitch
            id={id}
            size="md"
            checked={switchChecked}
            accentColor={active ? accentColor : undefined}
            disabled={disabled}
            aria-label={`Toggle ${title}`}
            onChange={() => onToggle()}
          />
        )}
      </Row>
      <GlassRim
        preset="card"
        radiusPx={19}
        opacity={active ? 0.7 : 0.44}
        tintColor={active ? accentColor : undefined}
      />
    </Box>
  );
}

/**
 * Tactile circular stage modeled directly on `PowerStripPanel` so single switches,
 * smart plugs, locks, and action buttons share the exact calm tactile aesthetic.
 */
export function DeviceModalOrbStage({
  id,
  iconName,
  stateLabel,
  caption,
  active,
  accentColor,
  disabled,
  ariaLabel,
  onPress,
  footer,
}: {
  readonly id?: string;
  readonly iconName: UiIconName;
  readonly stateLabel: string;
  readonly caption?: string;
  readonly active: boolean;
  readonly accentColor?: ColorValue;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
  readonly onPress?: () => void;
  readonly footer?: ReactNode;
}) {
  const { theme } = useHausUi();
  const ink = accentColor && active ? accentColor : colorToken(active ? 'textPrimary' : 'textMuted');
  const surface = colorToken('soft');
  const interactive = Boolean(onPress && !disabled);

  return (
    <Stack
      align="center"
      gapPx={12}
      dataAttrs={{ 'data-haus-glass-rim': 'managed' }}
      style={{
        layout: {
          width: pct(100),
          padding: insets(20, 16, 18, 16),
          position: 'relative',
          overflow: 'hidden',
        },
        material: new SolidMaterial(colorToken('surfaceSecondary')),
        border: { width: 1, color: colorToken('borderSubtle') },
        corners: corners(22),
      }}
    >
      {active && <DeviceTileWash active={active} deviceColor={accentColor ?? colorToken('accent')} />}
      <Pressable
        id={id}
        ariaLabel={ariaLabel}
        ariaPressed={active}
        disabled={!interactive}
        onActivate={onPress}
        style={{
          layout: {
            width: px(92),
            height: px(92),
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            zIndex: 1,
          },
          corners: corners(46, 'round'),
          border: {
            width: 1,
            color: active
              ? mixColor(colorToken('border'), ink, 0.35)
              : colorToken('border'),
          },
          material: new SolidMaterial(active ? mixColor(surface, ink, 0.16) : surface),
          opacity: disabled ? 0.55 : 1,
          cursor: interactive ? 'pointer' : 'default',
          transitionMs: 220,
          shadows: active
            ? [
                { offsetX: 0, offsetY: 1, blurRadius: 1, color: colorToken('ink', 0.12), inset: true },
                { offsetX: 0, offsetY: 6, blurRadius: 24, color: colorToken('ink', 0.08) },
              ]
            : undefined,
          states: interactive
            ? {
                pressed: { transform: { scale: 0.96 } },
                hover: {
                  material: new SolidMaterial(mixColor(surface, ink, active ? 0.22 : 0.09)),
                },
              }
            : undefined,
        }}
      >
        <UiIcon
          name={iconName}
          size={32}
          strokeWidth={1.6}
          color={resolveColorToCss(ink, theme, false)}
        />
      </Pressable>
      <Stack align="center" gapPx={3} style={{ layout: { position: 'relative', zIndex: 1 } }}>
        <Text size={16} weight={600}>
          {stateLabel}
        </Text>
        {caption && (
          <Text size={12} tone="muted" style={{ typography: { align: 'center' } }}>
            {caption}
          </Text>
        )}
      </Stack>
      {footer && (
        <Box style={{ layout: { width: pct(100), position: 'relative', zIndex: 1 } }}>{footer}</Box>
      )}
      <GlassRim preset="card" radiusPx={21} opacity={active ? 0.64 : 0.42} />
    </Stack>
  );
}

export interface PresetPillItem<T extends number | string = number> {
  readonly label: string;
  readonly value: T;
  readonly active?: boolean;
}

export function DevicePresetPills<T extends number | string = number>({
  idPrefix,
  items,
  disabled,
  onSelect,
}: {
  readonly idPrefix: string;
  readonly items: readonly PresetPillItem<T>[];
  readonly disabled?: boolean;
  readonly onSelect: (value: T) => void;
}) {
  return (
    <Row gapPx={6} wrap style={{ layout: { width: pct(100) } }}>
      {items.map((item) => (
        <Pressable
          key={String(item.value)}
          id={`${idPrefix}-preset-${String(item.value)}`}
          ariaPressed={Boolean(item.active)}
          disabled={disabled}
          onActivate={() => onSelect(item.value)}
          style={{
            layout: {
              flexGrow: 1,
              minHeight: px(30),
              padding: insets(4, 10),
              alignItems: 'center',
              justifyContent: 'center',
            },
            corners: corners(999, 'round'),
            material: new SolidMaterial(
              item.active
                ? mixColor(transparentColor, colorToken('ink'), 0.14)
                : colorToken('controlFill'),
            ),
            border: {
              width: 1,
              color: item.active ? colorToken('controlBorderActive') : colorToken('borderSubtle'),
            },
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
            transitionMs: 150,
            states: {
              hover: { material: new SolidMaterial(colorToken('controlFillHover')) },
              pressed: { transform: { scale: 0.97 } },
            },
          }}
        >
          <Text size={11.5} weight={item.active ? 600 : 500} tone={item.active ? 'primary' : 'secondary'}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </Row>
  );
}
