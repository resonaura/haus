import { Button } from '@heroui/react';
import type { HausAccessory, HassEntity, Snapshot } from '../../../model';
import { resolveCapabilities } from '../../../model';
import { heaterModeLabel, isKettle, knownTemperature } from '../../../model/water-heater';
import { ControlRange } from './ControlRange';
import './water-heater.scss';

export function WaterHeaterControls({
  accessory,
  entity,
  snapshot,
  disabled,
  act,
}: {
  accessory: HausAccessory;
  entity: HassEntity;
  snapshot: Snapshot;
  disabled: boolean;
  act: (intent: string, value?: unknown) => void;
}) {
  const attrs = entity.attributes;
  const kettle = isKettle(accessory);
  const capabilities = resolveCapabilities(entity, snapshot.services);
  const current = knownTemperature(attrs.current_temperature);
  const target = knownTemperature(attrs.temperature);
  const minimum = knownTemperature(attrs.min_temp);
  const maximum = knownTemperature(attrs.max_temp);
  const unit = attrs.temperature_unit ?? snapshot.config.unit_system?.temperature ?? '°C';
  const mode = attrs.operation_mode ?? entity.state;
  const modes: string[] = Array.isArray(attrs.operation_list)
    ? attrs.operation_list.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  return (
    <section
      className="haus-water-heater"
      aria-label={kettle ? 'Kettle controls' : 'Water heater controls'}
    >
      <div className="haus-water-temperature">
        <strong>
          {current ?? '—'}
          <small>{unit}</small>
        </strong>
        <span>
          {typeof attrs.activity === 'string' ? attrs.activity : heaterModeLabel(mode, kettle)}
        </span>
      </div>
      {target !== undefined && (
        <p className="haus-water-target">
          Target {target}
          {unit}
        </p>
      )}
      {capabilities.includes('water-temperature') &&
        target !== undefined &&
        minimum !== undefined &&
        maximum !== undefined &&
        minimum < maximum && (
          <ControlRange
            label="Target temperature"
            value={target}
            min={minimum}
            max={maximum}
            step={knownTemperature(attrs.target_temp_step) ?? 1}
            unit={unit}
            disabled={disabled}
            onCommit={(next) => act('water-temperature', next)}
          />
        )}
      {capabilities.includes('heater-mode') && (
        <div
          className="haus-water-modes"
          role="group"
          aria-label={kettle ? 'Kettle mode' : 'Operation mode'}
        >
          {modes.map((option) => (
            <Button
              key={option}
              variant="secondary"
              isDisabled={disabled}
              aria-pressed={mode === option}
              onPress={() => act('heater-mode', option)}
            >
              {heaterModeLabel(option, kettle)}
            </Button>
          ))}
        </div>
      )}
      {attrs.read_only === true ? (
        <p className="haus-control-hint">
          Read-only commissioning · Controls are disabled in the bridge settings.
        </p>
      ) : kettle && capabilities.includes('heater-mode') ? (
        <p className="haus-control-hint">Set a target, then choose Heat or Boil.</p>
      ) : null}
    </section>
  );
}
