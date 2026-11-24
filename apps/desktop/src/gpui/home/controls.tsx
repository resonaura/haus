/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import type { Snapshot } from '@haus/ha/types';
import { heaterModeLabel, isKettle, knownTemperature } from '@haus/ha/view/water-heater';
import {
  HausButton,
  HausSegmentedControl,
  HausSwitch,
  Row,
  SelectInput,
  Stack,
  Text,
} from '@haus/ui/primitives';
import { MediaRemotePanel } from '@haus/ui/components';
import { availableAction, type DeviceIntent, type HomeDevice } from './model.js';
import type { DeviceControl } from './cards.js';
import {
  DeviceRange,
  LightControlsSection,
  NetworkSection,
  PowerStripSection,
  PrinterSuppliesSection,
} from './controls-specialty.js';

export function DeviceControls({
  device,
  snapshot,
  disabled,
  onControl,
  onOpenMember,
  onSeparateLightGroup,
  onManage,
}: {
  readonly device: HomeDevice;
  readonly snapshot: Snapshot;
  readonly disabled: boolean;
  readonly onControl: DeviceControl;
  readonly onOpenMember?: (id: string) => void;
  readonly onSeparateLightGroup?: (groupKey: string) => void;
  readonly onManage?: (url: string) => void;
}) {
  const [lockConfirm, setLockConfirm] = useState<'lock' | 'unlock' | null>(null);
  const { accessory, id } = device;
  const entity = accessory.state;
  const domain = id.split('.')[0] ?? '';
  const attrs = entity.attributes;
  const send = (intent: DeviceIntent, value?: unknown, targetId = id) => {
    if (availableAction(snapshot, targetId, intent, value)) {
      onControl(targetId, intent, value);
    }
  };

  if (accessory.powerStrip) {
    return (
      <PowerStripSection
        device={device}
        snapshot={snapshot}
        disabled={disabled}
        onControl={onControl}
      />
    );
  }

  if (accessory.category === 'network') {
    return (
      <NetworkSection
        device={device}
        snapshot={snapshot}
        disabled={disabled}
        onControl={onControl}
        onManage={onManage}
      />
    );
  }

  const printerSection =
    accessory.category === 'printers' ? <PrinterSuppliesSection device={device} /> : null;

  if (domain === 'light') {
    return (
      <LightControlsSection
        device={device}
        snapshot={snapshot}
        disabled={disabled}
        onControl={onControl}
        onOpenMember={onOpenMember}
        onSeparateLightGroup={onSeparateLightGroup}
      />
    );
  }

  if (domain === 'climate') {
    const temp = typeof attrs.temperature === 'number' ? attrs.temperature : 21;
    const min = typeof attrs.min_temp === 'number' ? attrs.min_temp : 7;
    const max = typeof attrs.max_temp === 'number' ? attrs.max_temp : 35;
    const step = typeof attrs.target_temp_step === 'number' ? attrs.target_temp_step : 1;
    const modes = Array.isArray(attrs.hvac_modes)
      ? attrs.hvac_modes.filter((item): item is string => typeof item === 'string')
      : [];

    return (
      <Stack gapPx={12}>
        {availableAction(snapshot, id, 'climate-temperature', temp) && (
          <DeviceRange
            id={`control-${id}-temperature`}
            label="Target temperature"
            value={temp}
            min={min}
            max={max}
            step={step}
            unit="°"
            disabled={disabled}
            onCommit={(next) => send('climate-temperature', next)}
          />
        )}
        {modes.length > 0 && availableAction(snapshot, id, 'hvac-mode', modes[0]) && (
          <HausSegmentedControl
            id={`control-${id}-mode`}
            aria-label="HVAC mode"
            value={entity.state}
            options={modes.map((mode) => ({ value: mode, label: mode, disabled }))}
            onChange={(next) => send('hvac-mode', next)}
          />
        )}
      </Stack>
    );
  }

  if (domain === 'water_heater') {
    const kettle = isKettle(accessory);
    const currentTemp = knownTemperature(attrs.current_temperature);
    const targetTemp = knownTemperature(attrs.temperature);
    const min = knownTemperature(attrs.min_temp) ?? 40;
    const max = knownTemperature(attrs.max_temp) ?? 100;
    const modes = Array.isArray(attrs.operation_list)
      ? attrs.operation_list.filter((item): item is string => typeof item === 'string')
      : [];

    return (
      <Stack gapPx={12}>
        <Row justify="between" align="center">
          <Text size={13} tone="muted">
            Current temperature
          </Text>
          <Text size={14} weight={600} mono>
            {currentTemp !== undefined ? `${currentTemp}°` : '—'}
          </Text>
        </Row>
        {targetTemp !== undefined && availableAction(snapshot, id, 'water-temperature', targetTemp) && (
          <DeviceRange
            id={`control-${id}-water-temperature`}
            label="Target temperature"
            value={targetTemp}
            min={min}
            max={max}
            unit="°"
            disabled={disabled}
            onCommit={(next) => send('water-temperature', next)}
          />
        )}
        {modes.length > 0 && availableAction(snapshot, id, 'heater-mode', modes[0]) && (
          <HausSegmentedControl
            id={`control-${id}-heater-mode`}
            aria-label="Heater mode"
            value={entity.state}
            options={modes.map((mode) => ({
              value: mode,
              label: heaterModeLabel(mode, kettle),
              disabled,
            }))}
            onChange={(next) => send('heater-mode', next)}
          />
        )}
      </Stack>
    );
  }

  if (domain === 'cover' || domain === 'valve') {
    const pos = typeof attrs.current_position === 'number' ? attrs.current_position : 0;
    return (
      <Stack gapPx={10}>
        {availableAction(snapshot, id, 'position', pos) && (
          <DeviceRange
            id={`control-${id}-position`}
            label="Position"
            value={pos}
            min={0}
            max={100}
            disabled={disabled}
            onCommit={(next) => send('position', next)}
          />
        )}
        <Row gapPx={8}>
          {(['open', 'stop', 'close'] as const).map((intent) =>
            availableAction(snapshot, id, intent) ? (
              <HausButton
                key={intent}
                id={`control-${id}-${intent}`}
                size="sm"
                variant="secondary"
                disabled={disabled}
                onPress={() => send(intent)}
              >
                {intent.slice(0, 1).toUpperCase() + intent.slice(1)}
              </HausButton>
            ) : null,
          )}
        </Row>
      </Stack>
    );
  }

  if (domain === 'media_player') {
    const vol =
      typeof attrs.volume_level === 'number' ? Math.round(attrs.volume_level * 100) : 0;
    const remoteEntity = [accessory.state, ...accessory.secondaryEntities].find(
      (item) => item.entity_id.startsWith('remote.') && !['unavailable', 'unknown'].includes(item.state),
    );
    const canRemote = remoteEntity
      ? Boolean(availableAction(snapshot, remoteEntity.entity_id, 'remote-command', 'select'))
      : false;

    return (
      <Stack gapPx={12}>
        {(typeof attrs.media_title === 'string' || typeof attrs.media_artist === 'string') && (
          <Stack gapPx={2}>
            {typeof attrs.media_title === 'string' && (
              <Text size={13} weight={600}>
                {attrs.media_title}
              </Text>
            )}
            {typeof attrs.media_artist === 'string' && (
              <Text size={12} tone="muted">
                {attrs.media_artist}
              </Text>
            )}
          </Stack>
        )}
        <Row gapPx={8} wrap>
          {availableAction(snapshot, id, 'media-previous') && (
            <HausButton
              id={`control-${id}-previous`}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => send('media-previous')}
            >
              Previous
            </HausButton>
          )}
          {availableAction(snapshot, id, 'play-pause') && (
            <HausButton
              id={`control-${id}-play-pause`}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => send('play-pause')}
            >
              {entity.state === 'playing' ? 'Pause' : 'Play'}
            </HausButton>
          )}
          {availableAction(snapshot, id, 'media-next') && (
            <HausButton
              id={`control-${id}-next`}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => send('media-next')}
            >
              Next
            </HausButton>
          )}
          {availableAction(snapshot, id, 'toggle') && (
            <HausButton
              id={`control-${id}-power`}
              size="sm"
              variant="ghost"
              disabled={disabled}
              onPress={() => send('toggle')}
            >
              {entity.state === 'off' ? 'Turn on' : 'Turn off'}
            </HausButton>
          )}
        </Row>
        {availableAction(snapshot, id, 'volume', vol / 100) && (
          <DeviceRange
            id={`control-${id}-volume`}
            label="Volume"
            value={vol}
            min={0}
            max={100}
            disabled={disabled}
            onCommit={(next) => send('volume', next / 100)}
          />
        )}
        {canRemote && remoteEntity && (
          <MediaRemotePanel
            disabled={disabled}
            onCommand={(cmd) => send('remote-command', cmd, remoteEntity.entity_id)}
          />
        )}
      </Stack>
    );
  }

  if (domain === 'fan') {
    const pct = typeof attrs.percentage === 'number' ? Math.round(attrs.percentage) : 0;
    return (
      <Stack gapPx={10}>
        {availableAction(snapshot, id, 'toggle') && (
          <Row justify="between" align="center">
            <Text size={13} weight={500}>
              Fan
            </Text>
            <HausSwitch
              id={`control-${id}-toggle`}
              checked={entity.state === 'on'}
              disabled={disabled}
              onChange={() => send('toggle')}
            />
          </Row>
        )}
        {availableAction(snapshot, id, 'percentage', pct) && (
          <DeviceRange
            id={`control-${id}-fan-speed`}
            label="Speed"
            value={pct}
            min={0}
            max={100}
            disabled={disabled}
            onCommit={(next) => send('percentage', next)}
          />
        )}
      </Stack>
    );
  }

  if (domain === 'lock') {
    const isLocked = entity.state === 'locked';
    const nextAction = isLocked ? 'unlock' : 'lock';
    return (
      <Stack gapPx={10}>
        {!lockConfirm ? (
          availableAction(snapshot, id, nextAction) && (
            <HausButton
              id={`control-${id}-lock-action`}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => setLockConfirm(nextAction)}
            >
              {isLocked ? 'Unlock' : 'Lock'}
            </HausButton>
          )
        ) : (
          <Row gapPx={8} align="center">
            <HausButton
              id={`control-${id}-lock-confirm`}
              size="sm"
              variant="danger"
              disabled={disabled}
              onPress={() => {
                send(lockConfirm);
                setLockConfirm(null);
              }}
            >
              {lockConfirm === 'unlock' ? 'Confirm unlock' : 'Confirm lock'}
            </HausButton>
            <HausButton
              id={`control-${id}-lock-cancel`}
              size="sm"
              variant="ghost"
              onPress={() => setLockConfirm(null)}
            >
              Cancel
            </HausButton>
          </Row>
        )}
      </Stack>
    );
  }

  if (domain === 'select' || domain === 'input_select') {
    const options = Array.isArray(attrs.options)
      ? attrs.options.filter((opt): opt is string => typeof opt === 'string')
      : [];
    return (
      <Stack gapPx={10}>
        {printerSection}
        {options.length > 0 && availableAction(snapshot, id, 'select', options[0]) && (
          <SelectInput
            id={`control-${id}-select`}
            ariaLabel="Option"
            value={entity.state}
            disabled={disabled}
            options={options.map((opt) => ({ value: opt, label: opt }))}
            onChange={(next) => send('select', next)}
          />
        )}
      </Stack>
    );
  }

  if (domain === 'number' || domain === 'input_number') {
    const val = Number(entity.state);
    const min = typeof attrs.min === 'number' ? attrs.min : 0;
    const max = typeof attrs.max === 'number' ? attrs.max : 100;
    const step = typeof attrs.step === 'number' ? attrs.step : 1;
    const unit = typeof attrs.unit_of_measurement === 'string' ? attrs.unit_of_measurement : '';
    if (Number.isFinite(val) && availableAction(snapshot, id, 'value', val)) {
      return (
        <DeviceRange
          id={`control-${id}-value`}
          label={device.name}
          value={val}
          min={min}
          max={max}
          step={step}
          unit={unit}
          disabled={disabled}
          onCommit={(next) => send('value', next)}
        />
      );
    }
  }

  if (domain === 'button' || domain === 'input_button' || domain === 'scene' || domain === 'script') {
    const intent = domain === 'scene' || domain === 'script' ? 'run' : 'press';
    if (availableAction(snapshot, id, intent)) {
      return (
        <Stack gapPx={10}>
          {printerSection}
          <HausButton
            id={`control-${id}-press`}
            size="sm"
            variant="secondary"
            disabled={disabled}
            onPress={() => send(intent)}
          >
            {intent === 'run' ? 'Run' : 'Press'}
          </HausButton>
        </Stack>
      );
    }
  }

  if (['switch', 'input_boolean', 'humidifier', 'automation'].includes(domain)) {
    if (availableAction(snapshot, id, 'toggle')) {
      return (
        <Stack gapPx={10}>
          {printerSection}
          <Row justify="between" align="center">
            <Text size={13} weight={500}>
              Power
            </Text>
            <HausSwitch
              id={`control-${id}-toggle`}
              checked={entity.state === 'on'}
              disabled={disabled}
              onChange={() => send('toggle')}
            />
          </Row>
        </Stack>
      );
    }
  }

  return printerSection;
}
