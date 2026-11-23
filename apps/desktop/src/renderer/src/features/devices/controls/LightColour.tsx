/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useState } from 'react';
import {
  Box,
  HausButton as Button,
  HausColorPicker,
  HausTabsView as Tabs,
  parseHausColor,
  rgba,
  SolidMaterial,
  type HausColor,
} from '@haus/ui';
import { buildAction, type HassEntity as Entity } from '../../../model';
import { lightColor } from '../../../model/light-color';
import { lightTemperature } from '../../../model/light-profile';
import { numeric } from './control-values';
import { Glyph } from './ControlGlyph';
import { ControlRange } from './ControlRange';
import { LightEffects } from './LightEffects';

type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];

const colorFromLight = (entity: Entity): HausColor =>
  parseHausColor(lightColor(entity) ?? '#f3cf74');

function swatchMaterial(hex: string): SolidMaterial {
  const rgb = parseHausColor(hex).toFormat('rgb');
  return new SolidMaterial(
    rgba(rgb.getChannelValue('red'), rgb.getChannelValue('green'), rgb.getChannelValue('blue'), 1),
  );
}

export function LightColour({
  entity,
  capabilities,
  disabled,
  act,
  initiallyExpanded = false,
}: {
  initiallyExpanded?: boolean;
  entity: Entity;
  capabilities: string[];
  disabled: boolean;
  act: (intent: Intent, value?: Value) => void;
}) {
  const [color, setColor] = useState(() => colorFromLight(entity));
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const reportedColor = lightColor(entity) ?? '#f3cf74';
  useEffect(() => setColor(parseHausColor(reportedColor)), [reportedColor]);
  const sendColor = (next: HausColor) => {
    const converted = next.toFormat('rgb');
    act(
      'color',
      ['red', 'green', 'blue'].map((channel) =>
        Math.round(converted.getChannelValue(channel as 'red' | 'green' | 'blue')),
      ),
    );
  };
  const canColor = capabilities.includes('color');
  const canTemperature = capabilities.includes('temperature');
  const canEffect = capabilities.includes('effect');
  if (!canColor && !canTemperature && !canEffect) return null;
  const effectsControl = (
    <LightEffects entity={entity} capabilities={capabilities} disabled={disabled} act={act} />
  );
  const temperatureControl = (
    <ControlRange
      label="White temperature"
      value={lightTemperature(entity) ?? 3000}
      min={numeric(entity.attributes.min_color_temp_kelvin, 2000)}
      max={numeric(entity.attributes.max_color_temp_kelvin, 6500)}
      step={50}
      unit=" K"
      disabled={disabled}
      onCommit={(next) => act('temperature', next)}
    />
  );
  if (!canColor) {
    return (
      <Box semantic="section" className="haus-light-colour">
        {canTemperature && temperatureControl}
        {effectsControl}
      </Box>
    );
  }
  return (
    <Box semantic="section" className="haus-light-colour">
      {canColor && (
        <Box className="haus-swatches" ariaLabel="Light colour presets">
          {[
            ['Candlelight', '#ffc47c'],
            ['Warm white', '#ffe7ba'],
            ['Daylight', '#ecf5ff'],
            ['Rose', '#eea5a9'],
            ['Lavender', '#acaff4'],
            ['Ocean', '#8fc8dc'],
          ].map(([name, hex]) => (
            <Button
              key={hex}
              isIconOnly
              className="haus-swatch"
              aria-label={name}
              isDisabled={disabled}
              style={{ material: swatchMaterial(hex) }}
              onPress={() => {
                const next = parseHausColor(hex);
                setColor(next);
                sendColor(next);
              }}
            />
          ))}
        </Box>
      )}
      {effectsControl}
      <Button
        className="haus-colour-expand"
        variant="ghost"
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
      >
        {canTemperature ? 'Colour & white temperature' : 'Colour'}{' '}
        <Glyph name="chevron" className={expanded ? 'is-expanded' : ''} />
      </Button>
      {expanded && (
        <Tabs defaultSelectedKey={canColor ? 'colour' : 'temperature'} className="haus-colour-tabs">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Light appearance">
              {canColor && (
                <Tabs.Tab id="colour">
                  Colour
                  <Tabs.Indicator />
                </Tabs.Tab>
              )}
              {canTemperature && (
                <Tabs.Tab id="temperature">
                  Temperature
                  <Tabs.Indicator />
                </Tabs.Tab>
              )}
            </Tabs.List>
          </Tabs.ListContainer>
          {canColor && (
            <Tabs.Panel id="colour">
              <HausColorPicker
                value={color}
                disabled={disabled}
                onChange={setColor}
                onChangeEnd={sendColor}
              />
            </Tabs.Panel>
          )}
          {canTemperature && <Tabs.Panel id="temperature">{temperatureControl}</Tabs.Panel>}
        </Tabs>
      )}
    </Box>
  );
}
