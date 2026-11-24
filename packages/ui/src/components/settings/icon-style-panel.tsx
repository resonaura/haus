/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { colorToken, corners, insets, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausSegmentedControl } from '../../primitives/controls.js';
import { Box, Divider, Grid, Pressable, Row, Stack, Text } from '../../primitives/elements.js';

export interface IconStyleOption<T extends string = string> {
  readonly value: T;
  readonly title: string;
  readonly hex?: string;
}

export interface IconStylePanelProps<
  Appearance extends string = string,
  Variation extends string = string,
  Tint extends string = string,
> {
  readonly appearance: Appearance;
  readonly variation: Variation;
  readonly tintColor: Tint;
  readonly appearances: readonly IconStyleOption<Appearance>[];
  readonly variations: readonly IconStyleOption<Variation>[];
  readonly tintColors: readonly IconStyleOption<Tint>[];
  readonly badgeText?: string;
  readonly onChangeAppearance: (value: Appearance) => void;
  readonly onChangeVariation: (value: Variation) => void;
  readonly onChangeTintColor: (value: Tint) => void;
}

function swatchFill(hex: string | undefined): SolidMaterial {
  if (!hex || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return new SolidMaterial(colorToken('accent'));
  }
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return new SolidMaterial(colorToken('accent'));
  }
  return new SolidMaterial(rgba(r, g, b));
}

export function IconStylePanel<
  Appearance extends string = string,
  Variation extends string = string,
  Tint extends string = string,
>({
  appearance,
  variation,
  tintColor,
  appearances,
  variations,
  tintColors,
  badgeText,
  onChangeAppearance,
  onChangeVariation,
  onChangeTintColor,
}: IconStylePanelProps<Appearance, Variation, Tint>) {
  const showVariation = appearance !== 'dark';
  const showTint = appearance === 'tinted';
  const activeTintTitle = tintColors.find((c) => c.value === tintColor)?.title ?? 'Automatic';

  return (
    <Stack gapPx={12}>
      <Divider />
      <Row justify="between" align="center" gapPx={12}>
        <Stack gapPx={2}>
          <Text size={13}>Icon & integration style</Text>
          {badgeText && (
            <Text size={11} tone="muted">
              {badgeText}
            </Text>
          )}
        </Stack>
        <HausSegmentedControl
          id="icon-appearance"
          aria-label="Icon style"
          value={appearance}
          options={appearances.map((item) => ({ value: item.value, label: item.title }))}
          onChange={onChangeAppearance}
        />
      </Row>
      {showVariation && (
        <Row justify="between" align="center" gapPx={12}>
          <Text size={12} tone="secondary">
            {appearance === 'default'
              ? 'Default style'
              : appearance === 'clear'
                ? 'Clear style'
                : 'Tinted style'}
          </Text>
          <HausSegmentedControl
            id="icon-variation"
            aria-label="Icon variation"
            value={variation}
            options={variations.map((item) => ({ value: item.value, label: item.title }))}
            onChange={onChangeVariation}
          />
        </Row>
      )}
      {showTint && (
        <Stack gapPx={8}>
          <Row justify="between" align="center">
            <Text size={12} tone="secondary">
              Tint color
            </Text>
            <Text size={11} tone="muted">
              {activeTintTitle}
            </Text>
          </Row>
          <Grid columns={Math.min(Math.max(1, tintColors.length), 8)} gapPx={8}>
            {tintColors.map((color) => {
              const selected = tintColor === color.value;
              return (
                <Pressable
                  key={color.value}
                  id={`icon-tint-${color.value}`}
                  role="radio"
                  ariaChecked={selected}
                  ariaLabel={color.title}
                  title={color.title}
                  onActivate={() => onChangeTintColor(color.value)}
                  style={{
                    layout: {
                      width: px(24),
                      height: px(24),
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: insets(0),
                    },
                    corners: corners(12),
                    material: swatchFill(color.hex),
                    border: {
                      width: selected ? 2 : 1,
                      color: selected ? colorToken('textPrimary') : colorToken('border'),
                    },
                  }}
                >
                  <Box />
                </Pressable>
              );
            })}
          </Grid>
        </Stack>
      )}
    </Stack>
  );
}
