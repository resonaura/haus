/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
} from '../../ir/geometry.js';
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
import { DevicePresetPills } from './modal/surfaces.js';

export interface LightColorPresetItem {
  readonly name: string;
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
}

function kelvinTint(kelvin: number) {
  if (kelvin <= 2500) return rgba(255, 166, 84, 1);
  if (kelvin <= 3300) return rgba(255, 198, 128, 1);
  if (kelvin <= 4500) return rgba(255, 228, 196, 1);
  return rgba(214, 234, 255, 1);
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

  useEffect(() => {
    setDraftKelvin(undefined);
  }, [kelvin]);

  if (!canColor && !canTemperature) return null;

  const shownHue = draftHue ?? hue;
  const shownSat = draftSat ?? saturation;
  const shownKelvin = draftKelvin ?? kelvin ?? 3000;
  const currentSwatch = rgba(rgb[0], rgb[1], rgb[2], 1);
  const kelvinPresets = [
    { label: 'Warm', value: 2200 },
    { label: 'Cozy', value: 2700 },
    { label: 'Neutral', value: 4000 },
    { label: 'Daylight', value: 5600 },
  ].filter((item) => item.value >= minKelvin && item.value <= maxKelvin);

  return (
    <Stack gapPx={14} style={{ layout: { width: pct(100) } }}>
      {canColor && (
        <Stack gapPx={9} style={{ layout: { width: pct(100) } }}>
          <Row justify="between" align="center" style={{ layout: { width: pct(100) } }}>
            <Text size={12} weight={500} tone="secondary">
              Swatches
            </Text>
            <Row align="center" gapPx={6}>
              <Box
                style={{
                  layout: { width: px(14), height: px(14) },
                  corners: corners(7),
                  material: new SolidMaterial(currentSwatch),
                  border: { width: 1, color: colorToken('border') },
                }}
              />
              <Text size={11} tone="muted" mono>
                {`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`}
              </Text>
            </Row>
          </Row>
          <Row gapPx={8} wrap>
            {presets.map((preset, index) => {
              const selected =
                Math.abs(preset.rgb[0] - rgb[0]) <= 12 &&
                Math.abs(preset.rgb[1] - rgb[1]) <= 12 &&
                Math.abs(preset.rgb[2] - rgb[2]) <= 12;
              return (
                <Pressable
                  key={preset.hex}
                  id={`${idPrefix}-preset-${index}`}
                  ariaLabel={preset.name}
                  ariaPressed={selected}
                  disabled={disabled}
                  onActivate={() => onColorRgb([preset.rgb[0], preset.rgb[1], preset.rgb[2]])}
                  style={{
                    layout: {
                      width: px(32),
                      height: px(32),
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    corners: corners(999, 'round'),
                    material: new SolidMaterial(rgba(preset.rgb[0], preset.rgb[1], preset.rgb[2], 1)),
                    border: {
                      width: selected ? 2 : 1,
                      color: selected ? colorToken('textPrimary') : colorToken('borderSubtle'),
                    },
                    opacity: disabled ? 0.45 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    states: {
                      pressed: { transform: { scale: 0.93 } },
                    },
                  }}
                />
              );
            })}
          </Row>
        </Stack>
      )}

      {canTemperature && (
        <Stack gapPx={9} style={{ layout: { width: pct(100) } }}>
          <HausSlider
            id={`${idPrefix}-kelvin`}
            label="White warmth"
            valueLabel={`${shownKelvin} K`}
            value={shownKelvin}
            min={minKelvin}
            max={maxKelvin}
            step={50}
            accentColor={kelvinTint(shownKelvin)}
            disabled={disabled}
            onChange={setDraftKelvin}
            onChangeEnd={(next) => {
              setDraftKelvin(undefined);
              onTemperature(next);
            }}
          />
          {kelvinPresets.length > 0 && (
            <DevicePresetPills
              idPrefix={`${idPrefix}-kelvin`}
              disabled={disabled}
              items={kelvinPresets.map((item) => ({
                ...item,
                active: kelvin !== undefined && Math.abs(shownKelvin - item.value) <= 180,
              }))}
              onSelect={onTemperature}
            />
          )}
        </Stack>
      )}

      {canColor && (
        <Stack gapPx={8} style={{ layout: { width: pct(100) } }}>
          <HausButton
            id={`${idPrefix}-hsv-toggle`}
            size="sm"
            variant="ghost"
            onPress={() => setExpanded((prev) => !prev)}
          >
            <Row align="center" gapPx={6} style={{ pointerEvents: 'none' }}>
              <UiIcon name="sliders-horizontal" size={14} />
              <Text size={12}>
                {expanded ? 'Hide fine colour controls' : 'Custom hue & saturation'}
              </Text>
            </Row>
          </HausButton>
          {expanded && (
            <Stack
              gapPx={10}
              style={{
                layout: { width: pct(100), padding: insets(12) },
                material: new SolidMaterial(colorToken('surface')),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
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
                accentColor={currentSwatch}
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
                accentColor={currentSwatch}
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
