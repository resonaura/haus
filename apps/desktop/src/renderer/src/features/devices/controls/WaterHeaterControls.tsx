/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, HausButton, Text } from '@haus/ui';
import type { HausAccessory, HassEntity, Snapshot } from '../../../model';
import { resolveCapabilities } from '../../../model';
import { formatTemperature } from '../../../model/format-temperature';
import {
  heaterModeLabel,
  isKettle,
  kettleHasActiveTarget,
  knownTemperature,
} from '../../../model/water-heater';
import { ControlRange } from './ControlRange';
import { TemperatureDial } from './TemperatureDial';
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
  const kettleHeating = kettle && kettleHasActiveTarget(String(mode));
  const modes: string[] = Array.isArray(attrs.operation_list)
    ? attrs.operation_list.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  return (
    <Box
      semantic="section"
      className={`haus-water-heater ${kettleHeating ? 'has-active-target' : ''}`}
      ariaLabel={kettle ? 'Kettle controls' : 'Water heater controls'}
    >
      <Box className="haus-water-temperature">
        <Text semantic="strong">
          {formatTemperature(current, attrs.suggested_display_precision) ?? '—'}
          <Text semantic="small">{unit}</Text>
        </Text>
        <Text>
          {typeof attrs.activity === 'string' ? attrs.activity : heaterModeLabel(mode, kettle)}
        </Text>
      </Box>
      {!kettle && target !== undefined && (
        <Text semantic="p" className="haus-water-target">
          Target {formatTemperature(target, attrs.suggested_display_precision) ?? target}
          {unit}
        </Text>
      )}
      {capabilities.includes('water-temperature') &&
        (kettle ? kettleHeating : true) &&
        target !== undefined &&
        minimum !== undefined &&
        maximum !== undefined &&
        minimum < maximum &&
        (kettle ? (
          <TemperatureDial
            value={target}
            min={minimum}
            max={maximum}
            step={knownTemperature(attrs.target_temp_step) ?? 1}
            unit={unit}
            current={current}
            disabled={disabled}
            onCommit={(next) => act('water-temperature', next)}
          />
        ) : (
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
        ))}
      {capabilities.includes('heater-mode') && (
        <Box
          className="haus-water-modes"
          role="group"
          ariaLabel={kettle ? 'Kettle mode' : 'Operation mode'}
        >
          {modes.map((option) => (
            <HausButton
              key={option}
              variant="secondary"
              isDisabled={disabled}
              aria-pressed={mode === option}
              onPress={() => act('heater-mode', option)}
            >
              {heaterModeLabel(option, kettle)}
            </HausButton>
          ))}
        </Box>
      )}
      {attrs.read_only === true ? (
        <Text semantic="p" className="haus-control-hint">
          Read-only commissioning · Controls are disabled in the bridge settings.
        </Text>
      ) : kettle && capabilities.includes('heater-mode') && !kettleHeating ? (
        <Text semantic="p" className="haus-control-hint">
          Choose Heat or Boil to adjust the target temperature.
        </Text>
      ) : null}
    </Box>
  );
}
