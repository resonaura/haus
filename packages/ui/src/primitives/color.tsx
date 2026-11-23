/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { HausColor, parseHausColor } from '../ir/color.js';
import { colorToken, corners, insets, pct, px, rgba } from '../ir/geometry.js';
import { GradientMaterial, SolidMaterial } from '../ir/materials.js';
import { HausSlider } from './controls.js';
import { Box, Row, Stack, Text } from './elements.js';

export interface HausColorPickerProps {
  readonly value: HausColor;
  readonly disabled?: boolean;
  readonly onChange: (color: HausColor) => void;
  readonly onChangeEnd?: (color: HausColor) => void;
}

/**
 * Adapter-driven HSB color picker (Hue, Saturation, Brightness + live preview swatch)
 * built strictly from `@haus/ui` primitives — ZERO direct HTML tags.
 */
export function HausColorPicker({
  value,
  disabled,
  onChange,
  onChangeEnd,
}: HausColorPickerProps): React.ReactElement {
  const hsb = value.toFormat('hsb');
  const hue = Math.round(hsb.getChannelValue('hue'));
  const saturation = Math.round(hsb.getChannelValue('saturation'));
  const brightness = Math.round(hsb.getChannelValue('brightness'));
  const rgb = value.toFormat('rgb');
  const previewColor = rgba(
    rgb.getChannelValue('red'),
    rgb.getChannelValue('green'),
    rgb.getChannelValue('blue'),
    1,
  );
  const pureHueRgb = parseHausColor(`hsb(${hue}, 100%, 100%)`).toFormat('rgb');
  const pureHueColor = rgba(
    pureHueRgb.getChannelValue('red'),
    pureHueRgb.getChannelValue('green'),
    pureHueRgb.getChannelValue('blue'),
    1,
  );

  const emit = (next: HausColor, commit: boolean) => {
    onChange(next);
    if (commit) onChangeEnd?.(next);
  };

  return (
    <Stack gapPx={12}>
      <Box
        style={{
          layout: {
            width: pct(100),
            height: px(42),
            display: 'flex',
            direction: 'row',
            alignItems: 'center',
            justifyContent: 'between',
            padding: insets(0, 14),
          },
          material: new GradientMaterial(
            [
              { offset: 0, color: previewColor },
              { offset: 1, color: pureHueColor },
            ],
            90,
          ),
          corners: corners(14, 'superellipse', 1.4),
          border: { width: 1, style: 'solid', color: colorToken('materialEdge') },
        }}
      >
        <Row
          style={{
            layout: { padding: insets(3, 8) },
            material: new SolidMaterial(rgba(0, 0, 0, 0.42)),
            corners: corners(999, 'round'),
          }}
        >
          <Text mono size={11.5} style={{ typography: { color: rgba(255, 255, 255, 0.96) } }}>
            {value.toString('hex').toUpperCase()}
          </Text>
        </Row>
      </Box>

      <HausSlider
        label="Hue"
        aria-label="Hue"
        value={hue}
        min={0}
        max={359}
        step={1}
        valueLabel={`${hue}°`}
        disabled={disabled}
        onChange={(nextHue) => emit(hsb.withChannelValue('hue', nextHue), false)}
        onChangeEnd={(nextHue) => emit(hsb.withChannelValue('hue', nextHue), true)}
      />

      <HausSlider
        label="Saturation"
        aria-label="Saturation"
        value={saturation}
        min={0}
        max={100}
        step={1}
        valueLabel={`${saturation}%`}
        disabled={disabled}
        onChange={(nextSat) => emit(hsb.withChannelValue('saturation', nextSat), false)}
        onChangeEnd={(nextSat) => emit(hsb.withChannelValue('saturation', nextSat), true)}
      />

      <HausSlider
        label="Intensity"
        aria-label="Color intensity"
        value={brightness}
        min={10}
        max={100}
        step={1}
        valueLabel={`${brightness}%`}
        disabled={disabled}
        onChange={(nextVal) => emit(hsb.withChannelValue('brightness', nextVal), false)}
        onChangeEnd={(nextVal) => emit(hsb.withChannelValue('brightness', nextVal), true)}
      />
    </Stack>
  );
}
