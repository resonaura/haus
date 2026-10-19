import { useEffect, useState } from 'react';
import { Button, Tabs, ColorArea, ColorSlider, parseColor, type Color } from '@heroui/react';
import { buildAction, type HassEntity as Entity } from '../../../model';
import { lightColor } from '../../../model/light-color';
import { lightTemperature } from '../../../model/light-profile';
import { numeric } from './control-values';
import { Glyph } from './ControlGlyph';
import { ControlRange } from './ControlRange';
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];
const colorFromLight = (entity: Entity): Color => parseColor(lightColor(entity) ?? '#f3cf74');
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
  useEffect(() => setColor(parseColor(reportedColor)), [reportedColor]);
  const sendColor = (next: Color) => {
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
  if (!canColor && !canTemperature) return null;
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
  if (!canColor) return <section className="haus-light-colour">{temperatureControl}</section>;
  return (
    <section className="haus-light-colour">
      {canColor && (
        <div className="haus-swatches" aria-label="Light colour presets">
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
              style={{ backgroundColor: hex }}
              onPress={() => {
                const next = parseColor(hex);
                setColor(next);
                sendColor(next);
              }}
            />
          ))}
        </div>
      )}
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
              <ColorArea
                className="haus-colour-area"
                aria-label="Light saturation and brightness"
                colorSpace="hsb"
                xChannel="saturation"
                yChannel="brightness"
                value={color}
                onChange={setColor}
                onChangeEnd={sendColor}
                isDisabled={disabled}
              >
                <ColorArea.Thumb />
              </ColorArea>
              <ColorSlider
                className="haus-hue"
                aria-label="Light hue"
                channel="hue"
                colorSpace="hsb"
                value={color}
                onChange={setColor}
                onChangeEnd={sendColor}
                isDisabled={disabled}
              >
                <ColorSlider.Track>
                  <ColorSlider.Thumb />
                </ColorSlider.Track>
              </ColorSlider>
            </Tabs.Panel>
          )}
          {canTemperature && <Tabs.Panel id="temperature">{temperatureControl}</Tabs.Panel>}
        </Tabs>
      )}
    </section>
  );
}
