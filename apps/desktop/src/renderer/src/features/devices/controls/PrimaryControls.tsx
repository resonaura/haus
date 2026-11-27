/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  LIGHT_COLOUR_PRESETS,
  friendlyEntityLabel,
  hsvToRgb,
  rgbToHsv,
} from '@haus/core/transport';
import {
  lightActiveEffect,
  lightColor,
  lightDisableEffect,
  lightEffectOptions,
  lightProfile,
  lightStateDescription,
  lightTemperature,
} from '@haus/core/optimistic';
import {
  ClimateModalPanel,
  CoverModalPanel,
  DEVICE_ICONS,
  FanModalPanel,
  LightModalPanel,
  LockModalPanel,
  MediaModalPanel,
  SensorValueModalPanel,
  SwitchActionModalPanel,
  type DeviceMetricPill,
  type UiIconName,
} from '@haus/ui/components';
import {
  buildAction,
  resolveCapabilities,
  type HausAccessory,
  type HassEntity,
  type Snapshot,
} from '../../../model';
import { binaryStateDescription } from '../../../model/device-appearance';
import { formatTemperature } from '../../../model/format-temperature';
import { WaterHeaterControls } from './WaterHeaterControls';
import { numeric, strings, humanize } from './control-values';

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

function resolveLightRgb(entity: HassEntity): [number, number, number] {
  const css = lightColor(entity);
  if (css) {
    const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const raw = entity.attributes.rgb_color;
  if (Array.isArray(raw) && raw.length >= 3 && raw.every((c) => typeof c === 'number')) {
    return [Math.round(raw[0]), Math.round(raw[1]), Math.round(raw[2])];
  }
  return [255, 224, 178];
}

function collectMetrics(
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
    out.push({ label: friendlyEntityLabel(item, deviceName), value: `${item.state}${unit}` });
    if (out.length >= 4) break;
  }
  if (out.length === 0) {
    for (const [key, value] of Object.entries(primary.attributes)) {
      if (['friendly_name', 'icon', 'supported_features', 'unit_of_measurement'].includes(key))
        continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out.push({ label: humanize(key), value: String(value) });
        if (out.length >= 4) break;
      }
    }
  }
  return out;
}

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
  const idPrefix = `electron-control-${entity.entity_id}`;
  const capabilities = resolveCapabilities(entity, snapshot.services);
  const has = (capability: string) => capabilities.includes(capability);
  const availableServices = Object.keys(snapshot.services[domain] ?? {});
  const active = !['off', 'closed', 'locked', 'idle', 'unavailable', 'unknown'].includes(
    entity.state,
  );
  const categoryIcon: UiIconName =
    accessory.category && accessory.category in DEVICE_ICONS
      ? DEVICE_ICONS[accessory.category as keyof typeof DEVICE_ICONS]
      : 'activity';

  if (domain === 'light') {
    const profile = lightProfile(entity);
    const rgb = resolveLightRgb(entity);
    const hs = Array.isArray(attrs.hs_color) ? attrs.hs_color : undefined;
    const [hsvH, hsvS] =
      hs && hs.length >= 2 && typeof hs[0] === 'number' && typeof hs[1] === 'number'
        ? [Math.round(hs[0]), Math.round(hs[1])]
        : rgbToHsv(rgb[0], rgb[1], rgb[2]);
    const effects = lightEffectOptions(entity);
    return (
      <LightModalPanel
        idPrefix={idPrefix}
        deviceName={accessory.name}
        active={entity.state === 'on'}
        stateSubtitle={lightStateDescription(entity)}
        brightnessPct={entity.state === 'off' ? 0 : Math.round(numeric(attrs.brightness, 0) / 2.55)}
        rgb={rgb}
        hue={hsvH}
        saturation={hsvS}
        kelvin={lightTemperature(entity)}
        minKelvin={numeric(attrs.min_color_temp_kelvin, 2000)}
        maxKelvin={numeric(attrs.max_color_temp_kelvin, 6500)}
        canToggle={has('toggle')}
        canBrightness={has('brightness')}
        canColor={profile.color && has('color')}
        canTemperature={profile.temperature && has('temperature')}
        effects={has('effect') ? effects : []}
        activeEffect={lightActiveEffect(entity)}
        stopEffect={lightDisableEffect(entity)}
        disabled={disabled}
        presets={LIGHT_COLOUR_PRESETS}
        onToggle={() => act('toggle')}
        onBrightness={(next) => act('brightness', next)}
        onColorRgb={(nextRgb) => act('color', nextRgb)}
        onColorHsv={(nextHue, nextSat) => act('color', hsvToRgb(nextHue, nextSat))}
        onTemperature={(nextKelvin) => act('temperature', nextKelvin)}
        onSelectEffect={(effect) => act('effect', effect)}
      />
    );
  }

  if (['switch', 'input_boolean', 'humidifier', 'automation'].includes(domain)) {
    return (
      <SwitchActionModalPanel
        idPrefix={idPrefix}
        kind="toggle"
        active={active}
        stateLabel={active ? 'On' : 'Off'}
        iconName="power"
        metrics={collectMetrics(entity, accessory.secondaryEntities, accessory.name)}
        disabled={disabled}
        onActivate={has('toggle') ? () => act('toggle') : undefined}
      />
    );
  }

  if (domain === 'climate') {
    const unit = snapshot.config.unit_system?.temperature ?? '°C';
    const currentFormatted = formatTemperature(
      attrs.current_temperature,
      attrs.suggested_display_precision,
    );
    const minTemp = numeric(attrs.min_temp, 7);
    const maxTemp = numeric(attrs.max_temp, 35);
    const step = numeric(attrs.target_temp_step, 0.5);
    const targetTemp = numeric(attrs.temperature, numeric(attrs.current_temperature, 20));
    const ranged = entity.state === 'heat_cool';
    const lowTarget = numeric(attrs.target_temp_low, minTemp);
    const highTarget = numeric(attrs.target_temp_high, maxTemp);

    return (
      <ClimateModalPanel
        idPrefix={idPrefix}
        mode={entity.state}
        modes={strings(attrs.hvac_modes).map((m) => ({ value: m, label: humanize(m) }))}
        currentTempLabel={currentFormatted ? `${currentFormatted}${unit}` : undefined}
        targetTemp={targetTemp}
        lowTarget={lowTarget}
        highTarget={highTarget}
        ranged={ranged}
        minTemp={minTemp}
        maxTemp={maxTemp}
        step={step}
        unit={unit}
        canSetTemperature={has('climate-temperature')}
        canSetMode={has('hvac-mode')}
        disabled={disabled}
        onTargetTemp={(next) => act('climate-temperature', next)}
        onTargetRange={(low, high) =>
          act('climate-temperature', { target_temp_low: low, target_temp_high: high })
        }
        onModeChange={(next) => act('hvac-mode', next)}
      />
    );
  }

  if (domain === 'cover' || domain === 'valve') {
    const pos = numeric(attrs.current_position, entity.state === 'closed' ? 0 : 100);
    return (
      <CoverModalPanel
        idPrefix={idPrefix}
        position={pos}
        stateLabel={humanize(entity.state)}
        isValve={domain === 'valve'}
        canPosition={has('position')}
        canOpen={has('open')}
        canStop={has('stop')}
        canClose={has('close')}
        disabled={disabled}
        onPosition={(next) => act('position', next)}
        onOpen={() => act('open')}
        onStop={() => act('stop')}
        onClose={() => act('close')}
      />
    );
  }

  if (domain === 'water_heater') {
    return (
      <WaterHeaterControls
        accessory={accessory}
        entity={entity}
        snapshot={snapshot}
        disabled={disabled}
        act={act}
      />
    );
  }

  if (domain === 'media_player') {
    return (
      <MediaModalPanel
        idPrefix={idPrefix}
        title={typeof attrs.media_title === 'string' ? attrs.media_title : accessory.name}
        subtitle={typeof attrs.media_artist === 'string' ? attrs.media_artist : humanize(entity.state)}
        appName={typeof attrs.app_name === 'string' ? attrs.app_name : undefined}
        playing={entity.state === 'playing'}
        poweredOn={entity.state !== 'off' && entity.state !== 'standby'}
        volumePct={Math.round(numeric(attrs.volume_level, 0) * 100)}
        canPrevious={availableServices.includes('media_previous_track')}
        canPlayPause={has('play-pause')}
        canNext={availableServices.includes('media_next_track')}
        canPower={has('toggle')}
        canVolume={has('volume')}
        canRemote={false}
        disabled={disabled}
        onPrevious={() => explicitService('media_previous_track')}
        onPlayPause={() => act('play-pause')}
        onNext={() => explicitService('media_next_track')}
        onPower={() => act('toggle')}
        onVolume={(next) => act('volume', next / 100)}
      />
    );
  }

  if (domain === 'fan') {
    return (
      <FanModalPanel
        idPrefix={idPrefix}
        active={active}
        percentage={numeric(attrs.percentage, 0)}
        step={numeric(attrs.percentage_step, 1)}
        canToggle={has('toggle')}
        canPercentage={has('percentage')}
        disabled={disabled}
        onToggle={() => act('toggle')}
        onPercentage={(next) => act('percentage', next)}
      />
    );
  }

  if (domain === 'lock') {
    const locked = entity.state === 'locked';
    const nextIntent = locked ? 'unlock' : 'lock';
    return (
      <LockModalPanel
        idPrefix={idPrefix}
        deviceName={accessory.name}
        locked={locked}
        transitioning={['locking', 'unlocking'].includes(entity.state)}
        canToggle={has(nextIntent)}
        disabled={disabled}
        onConfirmAction={(intent) => act(intent)}
      />
    );
  }

  if (has('run') || has('press')) {
    const intent = has('run') ? 'run' : 'press';
    return (
      <SwitchActionModalPanel
        idPrefix={idPrefix}
        kind={intent}
        active={false}
        stateLabel="Ready"
        iconName={domain === 'scene' ? 'sparkles' : categoryIcon}
        disabled={disabled}
        onActivate={() => act(intent)}
      />
    );
  }

  if (has('select')) {
    return (
      <SensorValueModalPanel
        idPrefix={idPrefix}
        reading={humanize(entity.state)}
        subtitle="Active selection"
        iconName={categoryIcon}
        disabled={disabled}
        select={{
          label: 'Selection',
          value: entity.state,
          options: strings(attrs.options),
          onChange: (next) => act('select', next),
        }}
      />
    );
  }

  if (has('value')) {
    const min = numeric(attrs.min, 0);
    const max = numeric(attrs.max, 100);
    const step = numeric(attrs.step, 1);
    const val = numeric(entity.state, min);
    const unit = typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : '';
    return (
      <SensorValueModalPanel
        idPrefix={idPrefix}
        reading={['unavailable', 'unknown'].includes(entity.state) ? '—' : `${val}${unit}`}
        subtitle={accessory.name}
        iconName={categoryIcon}
        disabled={disabled}
        slider={{
          label: 'Value',
          value: val,
          min,
          max,
          step,
          unit,
          onCommit: (next) => act('value', next),
        }}
      />
    );
  }

  const unit = typeof attrs.unit_of_measurement === 'string' ? ` ${attrs.unit_of_measurement}` : '';
  return (
    <SensorValueModalPanel
      idPrefix={idPrefix}
      reading={`${binaryStateDescription(entity) ?? humanize(entity.state)}${unit}`}
      subtitle="Live device state"
      iconName={categoryIcon}
      metrics={collectMetrics(entity, accessory.secondaryEntities, accessory.name)}
    />
  );
}
