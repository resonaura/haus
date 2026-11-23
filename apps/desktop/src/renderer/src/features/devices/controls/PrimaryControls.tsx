/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState, type ReactNode } from 'react';
import { Box, HausButton, HausSwitch, Heading, pct, SelectInput, Text } from '@haus/ui';
import {
  buildAction,
  entityCategory,
  resolveCapabilities,
  type HausAccessory,
  type HassEntity,
  type Snapshot,
} from '../../../model';
import { AccessoryIcon } from '../../../components/icons/Icon';
import {
  binaryStateDescription,
  deviceAppearance,
  deviceSurfaceVars,
} from '../../../model/device-appearance';
import { formatTemperature } from '../../../model/format-temperature';
import { ControlRange } from './ControlRange';
import { LightColour } from './LightColour';
import { WaterHeaterControls } from './WaterHeaterControls';
import { Glyph } from './ControlGlyph';
import { numeric, strings, humanize, clamp } from './control-values';
type Intent = Parameters<typeof buildAction>[1];
type Value = Parameters<typeof buildAction>[2];
type Props = {
  accessory: HausAccessory;
  entity: HassEntity;
  snapshot: Snapshot;
  disabled: boolean;
  act: (intent: Intent, value?: Value) => void;
  explicitService: (service: string, data?: Record<string, unknown>) => void;
};
export function PrimaryControls({
  accessory,
  entity,
  snapshot,
  disabled,
  act,
  explicitService,
}: Props) {
  const attrs = entity.attributes;
  const domain = entity.entity_id.split('.')[0];
  const appearance = deviceAppearance(entity);
  const capabilities = resolveCapabilities(entity, snapshot.services);
  const has = (capability: string) => capabilities.includes(capability);
  const availableServices = Object.keys(snapshot.services[domain] ?? {});
  const active = !['off', 'closed', 'locked', 'idle', 'unavailable', 'unknown'].includes(
    entity.state,
  );
  const icon =
    domain === 'media_player'
      ? 'media'
      : domain === 'switch' || domain === 'input_boolean'
        ? 'power'
        : domain;
  const [confirmation, setConfirmation] = useState<'lock' | 'unlock' | null>(null);
  const temperatureUnit = snapshot.config.unit_system?.temperature ?? '°C';
  const targetTemperature = numeric(attrs.temperature, numeric(attrs.current_temperature, 20));
  const tempStep = numeric(attrs.target_temp_step, 0.5);
  const minTemp = numeric(attrs.min_temp, 7);
  const maxTemp = numeric(attrs.max_temp, 35);
  const rangedClimate = entity.state === 'heat_cool';
  const lowTarget = numeric(attrs.target_temp_low, minTemp);
  const highTarget = numeric(attrs.target_temp_high, maxTemp);

  let primary: ReactNode;
  if (domain === 'light' || ['switch', 'input_boolean'].includes(domain)) {
    primary = (
      <Box
        className="haus-light-controller"
        dataAttrs={{ 'data-light-effect': appearance.effect?.motion }}
        surfaceTokens={deviceSurfaceVars(appearance.accent, appearance.effect, true)}
      >
        {has('brightness') ? (
          <ControlRange
            label="Brightness"
            value={entity.state === 'off' ? 0 : Math.round(numeric(attrs.brightness, 0) / 2.55)}
            disabled={disabled}
            vertical
            onCommit={(next) => act('brightness', next)}
          />
        ) : (
          <HausButton
            className={`haus-power-surface ${active ? 'is-on' : ''}`}
            isDisabled={disabled || !has('toggle')}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            aria-pressed={active}
            onPress={() => act('toggle')}
          >
            <Text className="haus-power-fill" />
            {entityCategory(entity) === 'security' ? (
              <AccessoryIcon
                accessory={{ ...accessory, state: entity, primaryEntityId: entity.entity_id }}
                size={27}
              />
            ) : (
              <Glyph name={icon} />
            )}
            <Text>{active ? 'On' : 'Off'}</Text>
          </HausButton>
        )}
        {has('brightness') && has('toggle') && (
          <HausSwitch
            className="haus-color-switch haus-light-power"
            isSelected={active}
            label={active ? 'On' : 'Off'}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            isDisabled={disabled}
            onChange={() => act('toggle')}
          />
        )}
        {domain === 'light' && (
          <LightColour entity={entity} capabilities={capabilities} disabled={disabled} act={act} />
        )}
        <Text semantic="p" className="haus-control-hint">
          {has('brightness')
            ? 'Drag to adjust · Arrow keys · Scroll when focused'
            : 'Press to change power'}
        </Text>
      </Box>
    );
  } else if (domain === 'climate') {
    primary = (
      <Box className="haus-climate-controller">
        <Box className={`haus-thermostat ${entity.state !== 'off' ? 'is-on' : ''}`}>
          <Text>Set to</Text>
          <Text semantic="strong" className={rangedClimate ? 'is-range' : ''}>
            {rangedClimate ? `${lowTarget}–${highTarget}` : targetTemperature}
            <Text semantic="small">{temperatureUnit}</Text>
          </Text>
          <Text>
            Currently{' '}
            {formatTemperature(attrs.current_temperature, attrs.suggested_display_precision) ?? '—'}
            {temperatureUnit}
          </Text>
        </Box>
        {has('climate-temperature') && rangedClimate && (
          <>
            <ControlRange
              label="Heat below"
              value={lowTarget}
              min={minTemp}
              max={highTarget}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) =>
                act('climate-temperature', { target_temp_low: next, target_temp_high: highTarget })
              }
            />
            <ControlRange
              label="Cool above"
              value={highTarget}
              min={lowTarget}
              max={maxTemp}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) =>
                act('climate-temperature', { target_temp_low: lowTarget, target_temp_high: next })
              }
            />
          </>
        )}
        {has('climate-temperature') && !rangedClimate && (
          <>
            <Box className="haus-temperature-buttons">
              <HausButton
                isIconOnly
                aria-label="Decrease target temperature"
                isDisabled={disabled || targetTemperature <= minTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature - tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="minus" />
              </HausButton>
              <Text>Target temperature</Text>
              <HausButton
                isIconOnly
                aria-label="Increase target temperature"
                isDisabled={disabled || targetTemperature >= maxTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature + tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="plus" />
              </HausButton>
            </Box>
            <ControlRange
              label="Temperature"
              value={targetTemperature}
              min={minTemp}
              max={maxTemp}
              step={tempStep}
              unit={temperatureUnit}
              disabled={disabled}
              onCommit={(next) => act('climate-temperature', next)}
            />
          </>
        )}
        {has('hvac-mode') && (
          <Text semantic="label" className="haus-field">
            Mode
            <SelectInput
              value={entity.state}
              disabled={disabled}
              options={strings(attrs.hvac_modes).map((mode) => ({
                value: mode,
                label: humanize(mode),
              }))}
              onChange={(next) => act('hvac-mode', next)}
            />
          </Text>
        )}
      </Box>
    );
  } else if (domain === 'cover') {
    const coverH = 100 - numeric(attrs.current_position, entity.state === 'closed' ? 0 : 100);
    primary = (
      <Box className="haus-cover-controller">
        <Box className="haus-cover-illustration" ariaHidden>
          <Box style={{ layout: { height: pct(coverH) } }} />
          <Text />
        </Box>
        <Box className="haus-action-row">
          {(['open', 'stop', 'close'] as const).filter(has).map((intent) => (
            <HausButton
              key={intent}
              className="haus-secondary-action"
              variant="secondary"
              isDisabled={disabled}
              onPress={() => act(intent)}
            >
              {humanize(intent)}
            </HausButton>
          ))}
        </Box>
        {has('position') && (
          <ControlRange
            label="Open position"
            value={numeric(attrs.current_position, 0)}
            disabled={disabled}
            onCommit={(next) => act('position', next)}
          />
        )}
      </Box>
    );
  } else if (domain === 'water_heater') {
    primary = (
      <WaterHeaterControls
        accessory={accessory}
        entity={entity}
        snapshot={snapshot}
        disabled={disabled}
        act={act}
      />
    );
  } else if (domain === 'media_player') {
    primary = (
      <Box className="haus-media-controller">
        <Box className="haus-media-art">
          <AccessoryIcon accessory={accessory} size={56} />
          <Text>{typeof attrs.app_name === 'string' ? attrs.app_name : 'Now playing'}</Text>
        </Box>
        <Heading level={3}>
          {typeof attrs.media_title === 'string' ? attrs.media_title : accessory.name}
        </Heading>
        <Text semantic="p">
          {typeof attrs.media_artist === 'string' ? attrs.media_artist : humanize(entity.state)}
        </Text>
        <Box className="haus-transport">
          {availableServices.includes('media_previous_track') && (
            <HausButton
              isIconOnly
              variant="ghost"
              aria-label="Previous track"
              isDisabled={disabled}
              onPress={() => explicitService('media_previous_track')}
            >
              <Glyph name="previous" />
            </HausButton>
          )}
          {has('play-pause') && (
            <HausButton
              className="haus-play-button"
              isIconOnly
              aria-label={entity.state === 'playing' ? 'Pause' : 'Play'}
              isDisabled={disabled}
              onPress={() => act('play-pause')}
            >
              <Glyph name={entity.state === 'playing' ? 'pause' : 'play'} />
            </HausButton>
          )}
          {availableServices.includes('media_next_track') && (
            <HausButton
              isIconOnly
              variant="ghost"
              aria-label="Next track"
              isDisabled={disabled}
              onPress={() => explicitService('media_next_track')}
            >
              <Glyph name="next" />
            </HausButton>
          )}
        </Box>
        {has('volume') && (
          <ControlRange
            label="Volume"
            value={Math.round(numeric(attrs.volume_level, 0) * 100)}
            disabled={disabled}
            onCommit={(next) => act('volume', next / 100)}
          />
        )}
        {has('toggle') && (
          <HausButton variant="secondary" isDisabled={disabled} onPress={() => act('toggle')}>
            <Glyph name="power" />
            Power
          </HausButton>
        )}
      </Box>
    );
  } else if (domain === 'fan') {
    primary = (
      <Box className="haus-fan-controller">
        <Box className={`haus-fan-orb ${active ? 'is-on' : ''}`}>
          <Glyph name="fan" />
        </Box>
        {has('toggle') && (
          <HausButton
            className="haus-primary-action"
            isDisabled={disabled}
            onPress={() => act('toggle')}
          >
            Turn {active ? 'off' : 'on'}
          </HausButton>
        )}
        {has('percentage') && (
          <ControlRange
            label="Fan speed"
            value={numeric(attrs.percentage, 0)}
            step={numeric(attrs.percentage_step, 1)}
            disabled={disabled}
            onCommit={(next) => act('percentage', next)}
          />
        )}
      </Box>
    );
  } else if (domain === 'lock') {
    const intent = entity.state === 'locked' ? 'unlock' : 'lock';
    primary = (
      <Box className="haus-lock-controller">
        <Box className={`haus-lock-orb ${entity.state === 'locked' ? 'is-locked' : ''}`}>
          <Glyph name="lock" />
        </Box>
        <Text semantic="p">
          {['locking', 'unlocking'].includes(entity.state)
            ? 'Updating lock…'
            : entity.state === 'locked'
              ? 'Your door is secured.'
              : 'Your door is not locked.'}
        </Text>
        {confirmation ? (
          <Box className="haus-lock-confirm">
            <Text semantic="p">
              Confirm {confirmation} for {accessory.name}?
            </Text>
            <Box className="haus-action-row">
              <HausButton variant="secondary" onPress={() => setConfirmation(null)}>
                Cancel
              </HausButton>
              <HausButton
                className="haus-primary-action"
                isDisabled={disabled}
                onPress={() => {
                  act(confirmation);
                  setConfirmation(null);
                }}
              >
                Confirm {confirmation}
              </HausButton>
            </Box>
          </Box>
        ) : (
          has(intent) && (
            <HausButton
              className="haus-primary-action"
              isDisabled={disabled}
              onPress={() => setConfirmation(intent)}
            >
              {humanize(intent)} door
            </HausButton>
          )
        )}
      </Box>
    );
  } else if (has('run') || has('press')) {
    primary = (
      <Box className="haus-scene-controller">
        <Box className="haus-fan-orb">
          <Glyph name="star" />
        </Box>
        <Text semantic="p">
          {domain === 'scene' ? 'Set the atmosphere with one action.' : 'Run this device action.'}
        </Text>
        <HausButton
          className="haus-primary-action"
          isDisabled={disabled}
          onPress={() => act(has('run') ? 'run' : 'press')}
        >
          {domain === 'scene' ? 'Activate scene' : 'Run action'}
        </HausButton>
      </Box>
    );
  } else if (has('select')) {
    primary = (
      <Text semantic="label" className="haus-field">
        Selection
        <SelectInput
          value={entity.state}
          disabled={disabled}
          options={strings(attrs.options).map((option) => ({ value: option, label: option }))}
          onChange={(next) => act('select', next)}
        />
      </Text>
    );
  } else if (has('value')) {
    primary = (
      <ControlRange
        label="Value"
        value={numeric(entity.state, numeric(attrs.min, 0))}
        min={numeric(attrs.min, 0)}
        max={numeric(attrs.max, 100)}
        step={numeric(attrs.step, 1)}
        unit={typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : ''}
        disabled={disabled}
        unknown={['unavailable', 'unknown'].includes(entity.state)}
        onCommit={(next) => act('value', next)}
      />
    );
  } else {
    primary = (
      <Box className="haus-sensor-controller">
        <Box className="haus-sensor-glyph">
          {entityCategory(entity) === 'security' ? (
            <AccessoryIcon
              accessory={{ ...accessory, state: entity, primaryEntityId: entity.entity_id }}
              size={27}
            />
          ) : (
            <Glyph name={icon} />
          )}
        </Box>
        <Text semantic="strong">
          {binaryStateDescription(entity) ?? humanize(entity.state)}
          <Text semantic="small">
            {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
          </Text>
        </Text>
        <Text semantic="p">Live device state</Text>
        <Box className="haus-sensor-metrics">
          {Object.entries(attrs)
            .filter(
              ([key, value]) =>
                !['friendly_name', 'icon', 'supported_features', 'unit_of_measurement'].includes(
                  key,
                ) && ['string', 'number', 'boolean'].includes(typeof value),
            )
            .slice(0, 6)
            .map(([key, value]) => (
              <Box key={key}>
                <Text>{humanize(key)}</Text>
                <Text semantic="bold">{String(value)}</Text>
              </Box>
            ))}
        </Box>
      </Box>
    );
  }
  return primary;
}
