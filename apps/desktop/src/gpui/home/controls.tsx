/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { friendlyEntityLabel } from '@haus/core/transport';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { formatTemperature } from '@haus/ha/view/format-temperature';
import { heaterModeLabel, isKettle, knownTemperature } from '@haus/ha/view/water-heater';
import {
  ButtonRemoteModalPanel,
  ClimateModalPanel,
  CoverModalPanel,
  FanModalPanel,
  LockModalPanel,
  MediaModalPanel,
  SensorValueModalPanel,
  SwitchActionModalPanel,
  type DeviceMetricPill,
} from '@haus/ui/components';
import { Stack } from '@haus/ui/primitives';
import type { DeviceControl } from './cards.js';
import {
  LightControlsSection,
  NetworkSection,
  PowerStripSection,
  PrinterSuppliesSection,
} from './controls-specialty.js';
import { availableAction, type DeviceIntent, type HomeDevice } from './model.js';

function humanizeState(raw: string): string {
  const cleaned = raw.replaceAll('_', ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : 'Ready';
}

function collectEntityMetrics(
  primary: HassEntity,
  secondaries: readonly HassEntity[],
  deviceName: string,
): DeviceMetricPill[] {
  const out: DeviceMetricPill[] = [];
  for (const item of secondaries) {
    if (['unavailable', 'unknown'].includes(item.state)) continue;
    const d = item.entity_id.split('.')[0];
    if (d !== 'sensor' && d !== 'binary_sensor') continue;
    const unit =
      typeof item.attributes.unit_of_measurement === 'string'
        ? ` ${item.attributes.unit_of_measurement}`
        : '';
    out.push({
      label: friendlyEntityLabel(item, deviceName),
      value: `${item.state}${unit}`,
    });
    if (out.length >= 4) break;
  }
  if (out.length === 0) {
    for (const [k, v] of Object.entries(primary.attributes)) {
      if (
        ['friendly_name', 'icon', 'supported_features', 'unit_of_measurement', 'device_class'].includes(
          k,
        )
      )
        continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out.push({ label: humanizeState(k), value: String(v) });
        if (out.length >= 4) break;
      }
    }
  }
  return out;
}

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
  const { accessory, id } = device;
  const entity = accessory.state;
  const domain = id.split('.')[0] ?? '';
  const attrs = entity.attributes;
  const idPrefix = `control-${id}`;
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

  if (accessory.buttonController || domain === 'event') {
    const controls = [accessory.state, ...accessory.secondaryEntities]
      .filter((item) => item.entity_id.startsWith('event.'))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id, undefined, { numeric: true }));
    return (
      <ButtonRemoteModalPanel
        buttons={controls.map((ctrl, idx) => ({
          id: ctrl.entity_id,
          label: friendlyEntityLabel(ctrl, accessory.name) || `Button ${idx + 1}`,
          rotary: /rotary|dial/i.test(ctrl.entity_id),
          lastAction:
            typeof ctrl.attributes.event_type === 'string'
              ? humanizeState(ctrl.attributes.event_type)
              : undefined,
          gestures: Array.isArray(ctrl.attributes.event_types)
            ? ctrl.attributes.event_types
                .filter((t): t is string => typeof t === 'string')
                .map((t) => t.replaceAll('_', ' '))
            : undefined,
        }))}
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
    const unit = snapshot.config.unit_system?.temperature ?? '°';
    const currentFormatted = formatTemperature(
      attrs.current_temperature,
      attrs.suggested_display_precision,
    );
    const temp =
      typeof attrs.temperature === 'number'
        ? attrs.temperature
        : typeof attrs.current_temperature === 'number'
          ? attrs.current_temperature
          : 21;
    const min = typeof attrs.min_temp === 'number' ? attrs.min_temp : 7;
    const max = typeof attrs.max_temp === 'number' ? attrs.max_temp : 35;
    const step = typeof attrs.target_temp_step === 'number' ? attrs.target_temp_step : 0.5;
    const ranged = entity.state === 'heat_cool';
    const lowTarget = typeof attrs.target_temp_low === 'number' ? attrs.target_temp_low : min;
    const highTarget = typeof attrs.target_temp_high === 'number' ? attrs.target_temp_high : max;
    const modes = Array.isArray(attrs.hvac_modes)
      ? attrs.hvac_modes.filter((item): item is string => typeof item === 'string')
      : [];

    return (
      <ClimateModalPanel
        idPrefix={idPrefix}
        mode={entity.state}
        modes={modes.map((m) => ({ value: m, label: humanizeState(m) }))}
        currentTempLabel={currentFormatted ? `${currentFormatted}${unit}` : undefined}
        targetTemp={temp}
        lowTarget={lowTarget}
        highTarget={highTarget}
        ranged={ranged}
        minTemp={min}
        maxTemp={max}
        step={step}
        unit={unit}
        canSetTemperature={Boolean(availableAction(snapshot, id, 'climate-temperature', temp))}
        canSetMode={modes.length > 0 && Boolean(availableAction(snapshot, id, 'hvac-mode', modes[0]))}
        disabled={disabled}
        onTargetTemp={(next) => send('climate-temperature', next)}
        onTargetRange={(low, high) =>
          send('climate-temperature', { target_temp_low: low, target_temp_high: high })
        }
        onModeChange={(next) => send('hvac-mode', next)}
      />
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
      <ClimateModalPanel
        idPrefix={idPrefix}
        mode={entity.state}
        modes={modes.map((m) => ({ value: m, label: heaterModeLabel(m, kettle) }))}
        currentTempLabel={currentTemp !== undefined ? `${currentTemp}°` : undefined}
        targetTemp={targetTemp}
        minTemp={min}
        maxTemp={max}
        step={1}
        unit="°"
        kettle={kettle}
        canSetTemperature={
          targetTemp !== undefined &&
          Boolean(availableAction(snapshot, id, 'water-temperature', targetTemp))
        }
        canSetMode={modes.length > 0 && Boolean(availableAction(snapshot, id, 'heater-mode', modes[0]))}
        disabled={disabled}
        onTargetTemp={(next) => send('water-temperature', next)}
        onModeChange={(next) => send('heater-mode', next)}
      />
    );
  }

  if (domain === 'cover' || domain === 'valve') {
    const pos =
      typeof attrs.current_position === 'number'
        ? attrs.current_position
        : entity.state === 'closed'
          ? 0
          : 100;
    return (
      <CoverModalPanel
        idPrefix={idPrefix}
        position={pos}
        stateLabel={humanizeState(entity.state)}
        isValve={domain === 'valve'}
        canPosition={Boolean(availableAction(snapshot, id, 'position', pos))}
        canOpen={Boolean(availableAction(snapshot, id, 'open'))}
        canStop={Boolean(availableAction(snapshot, id, 'stop'))}
        canClose={Boolean(availableAction(snapshot, id, 'close'))}
        disabled={disabled}
        onPosition={(next) => send('position', next)}
        onOpen={() => send('open')}
        onStop={() => send('stop')}
        onClose={() => send('close')}
      />
    );
  }

  if (domain === 'media_player') {
    const vol =
      typeof attrs.volume_level === 'number' ? Math.round(attrs.volume_level * 100) : 0;
    const remoteEntity = [accessory.state, ...accessory.secondaryEntities].find(
      (item) =>
        item.entity_id.startsWith('remote.') && !['unavailable', 'unknown'].includes(item.state),
    );
    const canRemote = remoteEntity
      ? Boolean(availableAction(snapshot, remoteEntity.entity_id, 'remote-command', 'select'))
      : false;

    return (
      <MediaModalPanel
        idPrefix={idPrefix}
        title={typeof attrs.media_title === 'string' ? attrs.media_title : device.name}
        subtitle={
          typeof attrs.media_artist === 'string'
            ? attrs.media_artist
            : humanizeState(entity.state)
        }
        appName={typeof attrs.app_name === 'string' ? attrs.app_name : undefined}
        playing={entity.state === 'playing'}
        poweredOn={entity.state !== 'off' && entity.state !== 'standby'}
        volumePct={vol}
        canPrevious={Boolean(availableAction(snapshot, id, 'media-previous'))}
        canPlayPause={Boolean(availableAction(snapshot, id, 'play-pause'))}
        canNext={Boolean(availableAction(snapshot, id, 'media-next'))}
        canPower={Boolean(availableAction(snapshot, id, 'toggle'))}
        canVolume={Boolean(availableAction(snapshot, id, 'volume', vol / 100))}
        canRemote={canRemote}
        disabled={disabled}
        onPrevious={() => send('media-previous')}
        onPlayPause={() => send('play-pause')}
        onNext={() => send('media-next')}
        onPower={() => send('toggle')}
        onVolume={(next) => send('volume', next / 100)}
        onRemoteCommand={
          remoteEntity ? (cmd) => send('remote-command', cmd, remoteEntity.entity_id) : undefined
        }
      />
    );
  }

  if (domain === 'fan') {
    const pctVal = typeof attrs.percentage === 'number' ? Math.round(attrs.percentage) : 0;
    const step = typeof attrs.percentage_step === 'number' ? attrs.percentage_step : 1;
    return (
      <FanModalPanel
        idPrefix={idPrefix}
        active={entity.state === 'on'}
        percentage={pctVal}
        step={step}
        canToggle={Boolean(availableAction(snapshot, id, 'toggle'))}
        canPercentage={Boolean(availableAction(snapshot, id, 'percentage', pctVal))}
        disabled={disabled}
        onToggle={() => send('toggle')}
        onPercentage={(next) => send('percentage', next)}
      />
    );
  }

  if (domain === 'lock') {
    const isLocked = entity.state === 'locked';
    const nextAction = isLocked ? 'unlock' : 'lock';
    return (
      <LockModalPanel
        idPrefix={idPrefix}
        deviceName={device.name}
        locked={isLocked}
        transitioning={entity.state === 'locking' || entity.state === 'unlocking'}
        canToggle={Boolean(availableAction(snapshot, id, nextAction))}
        disabled={disabled}
        onConfirmAction={(intent) => send(intent)}
      />
    );
  }

  if (domain === 'select' || domain === 'input_select') {
    const options = Array.isArray(attrs.options)
      ? attrs.options.filter((opt): opt is string => typeof opt === 'string')
      : [];
    return (
      <Stack gapPx={12}>
        {printerSection}
        <SensorValueModalPanel
          idPrefix={idPrefix}
          reading={humanizeState(entity.state)}
          subtitle="Active mode selection"
          iconName={device.iconName}
          disabled={disabled}
          select={
            options.length > 0 && availableAction(snapshot, id, 'select', options[0])
              ? {
                  label: 'Option',
                  value: entity.state,
                  options,
                  onChange: (next) => send('select', next),
                }
              : undefined
          }
        />
      </Stack>
    );
  }

  if (domain === 'number' || domain === 'input_number') {
    const val = Number(entity.state);
    const min = typeof attrs.min === 'number' ? attrs.min : 0;
    const max = typeof attrs.max === 'number' ? attrs.max : 100;
    const step = typeof attrs.step === 'number' ? attrs.step : 1;
    const unit = typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : '';
    if (Number.isFinite(val)) {
      return (
        <SensorValueModalPanel
          idPrefix={idPrefix}
          reading={`${val}${unit}`}
          subtitle={device.name}
          iconName={device.iconName}
          disabled={disabled}
          slider={
            availableAction(snapshot, id, 'value', val)
              ? {
                  label: device.name,
                  value: val,
                  min,
                  max,
                  step,
                  unit,
                  onCommit: (next) => send('value', next),
                }
              : undefined
          }
        />
      );
    }
  }

  if (domain === 'button' || domain === 'input_button' || domain === 'scene' || domain === 'script') {
    const intent = domain === 'scene' || domain === 'script' ? 'run' : 'press';
    return (
      <Stack gapPx={12}>
        {printerSection}
        <SwitchActionModalPanel
          idPrefix={idPrefix}
          kind={intent}
          active={false}
          stateLabel="Ready"
          iconName={domain === 'scene' ? 'sparkles' : device.iconName}
          disabled={disabled}
          onActivate={availableAction(snapshot, id, intent) ? () => send(intent) : undefined}
        />
      </Stack>
    );
  }

  if (['switch', 'input_boolean', 'humidifier', 'automation'].includes(domain)) {
    const active = entity.state === 'on';
    return (
      <Stack gapPx={12}>
        {printerSection}
        <SwitchActionModalPanel
          idPrefix={idPrefix}
          kind="toggle"
          active={active}
          stateLabel={active ? 'On' : 'Off'}
          iconName="power"
          metrics={collectEntityMetrics(entity, accessory.secondaryEntities, accessory.name)}
          disabled={disabled}
          onActivate={availableAction(snapshot, id, 'toggle') ? () => send('toggle') : undefined}
        />
      </Stack>
    );
  }

  return (
    <Stack gapPx={12}>
      {printerSection}
      <SensorValueModalPanel
        idPrefix={idPrefix}
        reading={device.state}
        subtitle={device.categoryLabel ?? 'Live sensor reading'}
        iconName={device.iconName}
        metrics={collectEntityMetrics(entity, accessory.secondaryEntities, accessory.name)}
      />
    </Stack>
  );
}
