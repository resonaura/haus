/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, pct, px, rgba } from '../../ir/geometry.js';
import { SolidMaterial } from '../../ir/materials.js';
import {
  Box,
  HausButton,
  HausSlider,
  Pressable,
  Row,
  Stack,
  Text,
} from '../../primitives/index.js';
import { UiIcon } from '../icon.js';

export interface LightColorPresetItem {
  readonly name: string;
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
}

export function LightColorPanel({
  idPrefix,
  rgb,
  hue,
  saturation,
  kelvin,
  minKelvin = 2000,
  maxKelvin = 6500,
  canColor,
  canTemperature,
  disabled,
  presets,
  onColorRgb,
  onColorHsv,
  onTemperature,
}: {
  readonly idPrefix: string;
  readonly rgb: readonly [number, number, number];
  readonly hue: number;
  readonly saturation: number;
  readonly kelvin?: number;
  readonly minKelvin?: number;
  readonly maxKelvin?: number;
  readonly canColor: boolean;
  readonly canTemperature: boolean;
  readonly disabled: boolean;
  readonly presets: readonly LightColorPresetItem[];
  readonly onColorRgb: (next: [number, number, number]) => void;
  readonly onColorHsv: (nextHue: number, nextSat: number) => void;
  readonly onTemperature: (nextKelvin: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftHue, setDraftHue] = useState<number>();
  const [draftSat, setDraftSat] = useState<number>();
  const [draftKelvin, setDraftKelvin] = useState<number>();

  if (!canColor && !canTemperature) return null;

  const shownHue = draftHue ?? hue;
  const shownSat = draftSat ?? saturation;
  const shownKelvin = draftKelvin ?? kelvin ?? 3000;

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      {canColor && (
        <Stack gapPx={8}>
          <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
            <Text size={12} weight={600}>
              Colour
            </Text>
            <Row align="center" gapPx={8}>
              <Box
                style={{
                  layout: { width: px(16), height: px(16) },
                  corners: corners(8),
                  material: new SolidMaterial(rgba(rgb[0], rgb[1], rgb[2], 1)),
                  border: { width: 1, color: colorToken('border') },
                }}
              />
              <Text size={11} tone="muted" mono>
                {rgb.join(', ')}
              </Text>
            </Row>
          </Row>
          <Row gapPx={8} wrap>
            {presets.map((preset, index) => (
              <Pressable
                key={preset.hex}
                id={`${idPrefix}-preset-${index}`}
                ariaLabel={preset.name}
                disabled={disabled}
                onActivate={() => onColorRgb([preset.rgb[0], preset.rgb[1], preset.rgb[2]])}
                style={{
                  layout: {
                    width: px(28),
                    height: px(28),
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  corners: corners(14),
                  material: new SolidMaterial(rgba(preset.rgb[0], preset.rgb[1], preset.rgb[2], 1)),
                  border: { width: 1, color: colorToken('border') },
                  opacity: disabled ? 0.45 : 1,
                }}
              />
            ))}
          </Row>
        </Stack>
      )}

      {canTemperature && (
        <HausSlider
          id={`${idPrefix}-kelvin`}
          label="White temperature"
          valueLabel={`${shownKelvin} K`}
          value={shownKelvin}
          min={minKelvin}
          max={maxKelvin}
          step={50}
          disabled={disabled}
          onChange={setDraftKelvin}
          onChangeEnd={(next) => {
            setDraftKelvin(undefined);
            onTemperature(next);
          }}
        />
      )}

      {canColor && (
        <Stack gapPx={8}>
          <HausButton
            id={`${idPrefix}-hsv-toggle`}
            size="sm"
            variant="ghost"
            onPress={() => setExpanded((prev) => !prev)}
          >
            <Row align="center" gapPx={6} style={{ pointerEvents: 'none' }}>
              <UiIcon name="sliders-horizontal" size={14} />
              {expanded ? 'Hide fine colour controls' : 'Custom hue & saturation'}
            </Row>
          </HausButton>
          {expanded && (
            <Stack
              gapPx={10}
              style={{
                layout: { padding: insets(10, 12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('border') },
                corners: corners(12),
              }}
            >
              <HausSlider
                id={`${idPrefix}-hue`}
                label="Hue"
                valueLabel={`${shownHue}°`}
                value={shownHue}
                min={0}
                max={360}
                step={1}
                disabled={disabled}
                onChange={setDraftHue}
                onChangeEnd={(nextHue) => {
                  setDraftHue(undefined);
                  onColorHsv(nextHue, shownSat);
                }}
              />
              <HausSlider
                id={`${idPrefix}-saturation`}
                label="Saturation"
                valueLabel={`${shownSat}%`}
                value={shownSat}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                onChange={setDraftSat}
                onChangeEnd={(nextSat) => {
                  setDraftSat(undefined);
                  onColorHsv(shownHue, nextSat);
                }}
              />
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}
