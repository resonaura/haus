import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Switch } from '@heroui/react';
import {
  buildAction,
  resolveCapabilities,
  type HausAccessory,
  type HassEntity,
  type Snapshot,
} from '../../../model';
import { AccessoryIcon } from '../../../components/icons/Icon';
import { binaryStateDescription, deviceAppearance } from '../../../model/device-appearance';
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
      : ['switch', 'input_boolean'].includes(domain)
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
      <div
        className="haus-light-controller"
        style={
          { '--device-color': appearance.accent, '--accent': appearance.accent } as CSSProperties
        }
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
          <Button
            className={`haus-power-surface ${active ? 'is-on' : ''}`}
            isDisabled={disabled || !has('toggle')}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            aria-pressed={active}
            onPress={() => act('toggle')}
          >
            <span className="haus-power-fill" />
            {accessory.category === 'security' ? (
              <AccessoryIcon
                accessory={{ ...accessory, state: entity, primaryEntityId: entity.entity_id }}
                size={27}
              />
            ) : (
              <Glyph name={icon} />
            )}
            <span>{active ? 'On' : 'Off'}</span>
          </Button>
        )}
        {has('brightness') && has('toggle') && (
          <Switch
            className="haus-color-switch haus-light-power"
            isSelected={active}
            aria-label={`${active ? 'Turn off' : 'Turn on'} ${accessory.name}`}
            isDisabled={disabled}
            onChange={() => act('toggle')}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              {active ? 'On' : 'Off'}
            </Switch.Content>
          </Switch>
        )}
        {domain === 'light' && (
          <LightColour entity={entity} capabilities={capabilities} disabled={disabled} act={act} />
        )}
        <p className="haus-control-hint">
          {has('brightness')
            ? 'Drag to adjust · Arrow keys · Scroll when focused'
            : 'Press to change power'}
        </p>
      </div>
    );
  } else if (domain === 'climate') {
    primary = (
      <div className="haus-climate-controller">
        <div className={`haus-thermostat ${entity.state !== 'off' ? 'is-on' : ''}`}>
          <span>Set to</span>
          <strong className={rangedClimate ? 'is-range' : ''}>
            {rangedClimate ? `${lowTarget}–${highTarget}` : targetTemperature}
            <small>{temperatureUnit}</small>
          </strong>
          <span>
            Currently{' '}
            {formatTemperature(attrs.current_temperature, attrs.suggested_display_precision) ?? '—'}
            {temperatureUnit}
          </span>
        </div>
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
            <div className="haus-temperature-buttons">
              <Button
                isIconOnly
                aria-label="Decrease target temperature"
                isDisabled={disabled || targetTemperature <= minTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature - tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="minus" />
              </Button>
              <span>Target temperature</span>
              <Button
                isIconOnly
                aria-label="Increase target temperature"
                isDisabled={disabled || targetTemperature >= maxTemp}
                onPress={() =>
                  act('climate-temperature', clamp(targetTemperature + tempStep, minTemp, maxTemp))
                }
              >
                <Glyph name="plus" />
              </Button>
            </div>
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
          <label className="haus-field">
            Mode
            <select
              value={entity.state}
              disabled={disabled}
              onChange={(event) => act('hvac-mode', event.target.value)}
            >
              {strings(attrs.hvac_modes).map((mode) => (
                <option key={mode} value={mode}>
                  {humanize(mode)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  } else if (domain === 'cover') {
    primary = (
      <div className="haus-cover-controller">
        <div className="haus-cover-illustration" aria-hidden="true">
          <div
            style={{
              height: `${100 - numeric(attrs.current_position, entity.state === 'closed' ? 0 : 100)}%`,
            }}
          />
          <span />
        </div>
        <div className="haus-action-row">
          {(['open', 'stop', 'close'] as const).filter(has).map((intent) => (
            <Button
              key={intent}
              className="haus-secondary-action"
              variant="secondary"
              isDisabled={disabled}
              onPress={() => act(intent)}
            >
              {humanize(intent)}
            </Button>
          ))}
        </div>
        {has('position') && (
          <ControlRange
            label="Open position"
            value={numeric(attrs.current_position, 0)}
            disabled={disabled}
            onCommit={(next) => act('position', next)}
          />
        )}
      </div>
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
      <div className="haus-media-controller">
        <div className="haus-media-art">
          <AccessoryIcon accessory={accessory} size={56} />
          <span>{typeof attrs.app_name === 'string' ? attrs.app_name : 'Now playing'}</span>
        </div>
        <h3>{typeof attrs.media_title === 'string' ? attrs.media_title : accessory.name}</h3>
        <p>
          {typeof attrs.media_artist === 'string' ? attrs.media_artist : humanize(entity.state)}
        </p>
        <div className="haus-transport">
          {availableServices.includes('media_previous_track') && (
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Previous track"
              isDisabled={disabled}
              onPress={() => explicitService('media_previous_track')}
            >
              <Glyph name="previous" />
            </Button>
          )}
          {has('play-pause') && (
            <Button
              className="haus-play-button"
              isIconOnly
              aria-label={entity.state === 'playing' ? 'Pause' : 'Play'}
              isDisabled={disabled}
              onPress={() => act('play-pause')}
            >
              <Glyph name={entity.state === 'playing' ? 'pause' : 'play'} />
            </Button>
          )}
          {availableServices.includes('media_next_track') && (
            <Button
              isIconOnly
              variant="ghost"
              aria-label="Next track"
              isDisabled={disabled}
              onPress={() => explicitService('media_next_track')}
            >
              <Glyph name="next" />
            </Button>
          )}
        </div>
        {has('volume') && (
          <ControlRange
            label="Volume"
            value={Math.round(numeric(attrs.volume_level, 0) * 100)}
            disabled={disabled}
            onCommit={(next) => act('volume', next / 100)}
          />
        )}
        {has('toggle') && (
          <Button variant="secondary" isDisabled={disabled} onPress={() => act('toggle')}>
            <Glyph name="power" />
            Power
          </Button>
        )}
      </div>
    );
  } else if (domain === 'fan') {
    primary = (
      <div className="haus-fan-controller">
        <div className={`haus-fan-orb ${active ? 'is-on' : ''}`}>
          <Glyph name="fan" />
        </div>
        {has('toggle') && (
          <Button
            className="haus-primary-action"
            isDisabled={disabled}
            onPress={() => act('toggle')}
          >
            Turn {active ? 'off' : 'on'}
          </Button>
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
      </div>
    );
  } else if (domain === 'lock') {
    const intent = entity.state === 'locked' ? 'unlock' : 'lock';
    primary = (
      <div className="haus-lock-controller">
        <div className={`haus-lock-orb ${entity.state === 'locked' ? 'is-locked' : ''}`}>
          <Glyph name="lock" />
        </div>
        <p>
          {['locking', 'unlocking'].includes(entity.state)
            ? 'Updating lock…'
            : entity.state === 'locked'
              ? 'Your door is secured.'
              : 'Your door is not locked.'}
        </p>
        {confirmation ? (
          <div className="haus-lock-confirm">
            <p>
              Confirm {confirmation} for {accessory.name}?
            </p>
            <div className="haus-action-row">
              <Button variant="secondary" onPress={() => setConfirmation(null)}>
                Cancel
              </Button>
              <Button
                className="haus-primary-action"
                isDisabled={disabled}
                onPress={() => {
                  act(confirmation);
                  setConfirmation(null);
                }}
              >
                Confirm {confirmation}
              </Button>
            </div>
          </div>
        ) : (
          has(intent) && (
            <Button
              className="haus-primary-action"
              isDisabled={disabled}
              onPress={() => setConfirmation(intent)}
            >
              {humanize(intent)} door
            </Button>
          )
        )}
      </div>
    );
  } else if (has('run') || has('press')) {
    primary = (
      <div className="haus-scene-controller">
        <div className="haus-fan-orb">
          <Glyph name="star" />
        </div>
        <p>
          {domain === 'scene'
            ? 'Set the atmosphere with one action.'
            : 'Run this Home Assistant action.'}
        </p>
        <Button
          className="haus-primary-action"
          isDisabled={disabled}
          onPress={() => act(has('run') ? 'run' : 'press')}
        >
          {domain === 'scene' ? 'Activate scene' : 'Run action'}
        </Button>
      </div>
    );
  } else if (has('select')) {
    primary = (
      <label className="haus-field">
        Selection
        <select
          value={entity.state}
          disabled={disabled}
          onChange={(event) => act('select', event.target.value)}
        >
          {strings(attrs.options).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  } else if (has('value')) {
    primary = (
      <ControlRange
        label="Value"
        value={Number(entity.state) || 0}
        min={numeric(attrs.min, 0)}
        max={numeric(attrs.max, 100)}
        step={numeric(attrs.step, 1)}
        unit={typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : ''}
        disabled={disabled}
        onCommit={(next) => act('value', next)}
      />
    );
  } else {
    primary = (
      <div className="haus-sensor-controller">
        <div className="haus-sensor-glyph">
          {accessory.category === 'security' ? (
            <AccessoryIcon
              accessory={{ ...accessory, state: entity, primaryEntityId: entity.entity_id }}
              size={27}
            />
          ) : (
            <Glyph name={icon} />
          )}
        </div>
        <strong>
          {binaryStateDescription(entity) ?? humanize(entity.state)}
          <small>
            {typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : ''}
          </small>
        </strong>
        <p>Live device state</p>
        <div className="haus-sensor-metrics">
          {Object.entries(attrs)
            .filter(
              ([key, value]) =>
                !['friendly_name', 'icon', 'supported_features', 'unit_of_measurement'].includes(
                  key,
                ) && ['string', 'number', 'boolean'].includes(typeof value),
            )
            .slice(0, 6)
            .map(([key, value]) => (
              <div key={key}>
                <span>{humanize(key)}</span>
                <b>{String(value)}</b>
              </div>
            ))}
        </div>
      </div>
    );
  }

  return primary;
}
