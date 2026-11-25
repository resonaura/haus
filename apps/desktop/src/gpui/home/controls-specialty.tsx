/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import {
  LIGHT_COLOUR_PRESETS,
  classifyNetworkStates,
  extractPrinterSupplies,
  friendlyEntityLabel,
  hsvToRgb,
  rgbToHsv,
} from '@haus/core/transport';
import { lightColor } from '@haus/ha/light-color';
import { presentPowerOutlets } from '@haus/ha/view/device-relationships';
import {
  lightActiveEffect,
  lightDisableEffect,
  lightEffectOptions,
  lightProfile,
  lightStateDescription,
  lightTemperature,
} from '@haus/ha/light-profile';
import type { HassEntity, Snapshot } from '@haus/ha/types';
import { HausSlider, HausSwitch, Row, Stack, Text } from '@haus/ui/primitives';
import {
  LightColorPanel,
  LightEffectsPanel,
  LightGroupPanel,
  NetworkDetailsPanel,
  PowerStripPanel,
  PrinterSuppliesPanel,
} from '@haus/ui/components';
import {
  availableAction,
  availableDeviceActions,
  type DeviceIntent,
  type HomeDevice,
} from './model.js';
import type { DeviceControl } from './cards.js';

export interface RangeProps {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly disabled: boolean;
  readonly onCommit: (value: number) => void;
}

export function DeviceRange({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  unit = '%',
  disabled,
  onCommit,
}: RangeProps) {
  const [draft, setDraft] = useState<number>();
  const shown = draft ?? Math.min(max, Math.max(min, value));

  return (
    <HausSlider
      id={id}
      label={label}
      valueLabel={`${shown}${unit}`}
      value={shown}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={setDraft}
      onChangeEnd={(next) => {
        setDraft(undefined);
        if (next !== value) onCommit(next);
      }}
    />
  );
}

function resolveLightRgb(entity: HassEntity): [number, number, number] {
  const css = lightColor(entity);
  if (css) {
    const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(css);
    if (match) {
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }
  }
  const raw = entity.attributes.rgb_color;
  if (Array.isArray(raw) && raw.length >= 3 && raw.every((c) => typeof c === 'number')) {
    return [Math.round(raw[0]), Math.round(raw[1]), Math.round(raw[2])];
  }
  return [255, 224, 178];
}

function metricValue(entity?: HassEntity): string | undefined {
  if (!entity || ['unavailable', 'unknown'].includes(entity.state)) return undefined;
  const unit =
    typeof entity.attributes.unit_of_measurement === 'string'
      ? ` ${entity.attributes.unit_of_measurement}`
      : '';
  return `${entity.state}${unit}`;
}

export function LightControlsSection({
  device,
  snapshot,
  disabled,
  onControl,
  onOpenMember,
  onSeparateLightGroup,
}: {
  readonly device: HomeDevice;
  readonly snapshot: Snapshot;
  readonly disabled: boolean;
  readonly onControl: DeviceControl;
  readonly onOpenMember?: (id: string) => void;
  readonly onSeparateLightGroup?: (groupKey: string) => void;
}) {
  const { accessory, id } = device;
  const entity = accessory.state;
  const profile = lightProfile(entity);
  const lightGroup = accessory.lightGroup;
  const target = lightGroup ? lightGroup.members.map((member) => member.primaryEntityId) : id;

  const sendTargets = (intent: DeviceIntent, value?: unknown) => {
    if (availableDeviceActions(snapshot, target, intent, value).length)
      onControl(target, intent, value);
  };

  const canToggle = availableDeviceActions(snapshot, target, 'toggle').length > 0;
  const canBrightness =
    profile.brightness && availableDeviceActions(snapshot, target, 'brightness', 50).length > 0;
  const rawBrightness =
    typeof entity.attributes.brightness === 'number'
      ? Math.round(Math.max(0, Math.min(255, entity.attributes.brightness)) / 2.55)
      : 0;

  const rgb = resolveLightRgb(entity);
  const hs = Array.isArray(entity.attributes.hs_color) ? entity.attributes.hs_color : undefined;
  const [hsvH, hsvS] =
    hs && hs.length >= 2 && typeof hs[0] === 'number' && typeof hs[1] === 'number'
      ? [Math.round(hs[0]), Math.round(hs[1])]
      : rgbToHsv(rgb[0], rgb[1], rgb[2]);

  const minKelvin =
    typeof entity.attributes.min_color_temp_kelvin === 'number'
      ? entity.attributes.min_color_temp_kelvin
      : 2000;
  const maxKelvin =
    typeof entity.attributes.max_color_temp_kelvin === 'number'
      ? entity.attributes.max_color_temp_kelvin
      : 6500;
  const effects = lightEffectOptions(entity).filter(
    (item) => availableDeviceActions(snapshot, target, 'effect', item.value).length > 0,
  );
  const activeEffect = lightActiveEffect(entity);
  const disableEffect = lightDisableEffect(entity);

  return (
    <Stack gapPx={12}>
      {canToggle && (
        <Row justify="between" align="center">
          <Text size={13} weight={500}>
            Power
          </Text>
          <HausSwitch
            id={`control-${id}-toggle`}
            checked={entity.state === 'on'}
            disabled={disabled}
            aria-label={`Toggle ${device.name}`}
            onChange={() => sendTargets('toggle')}
          />
        </Row>
      )}
      {canBrightness && (
        <DeviceRange
          id={`control-${id}-brightness`}
          label="Brightness"
          value={entity.state === 'on' ? rawBrightness : 0}
          min={0}
          max={100}
          disabled={disabled}
          onCommit={(next) => sendTargets('brightness', next)}
        />
      )}
      <LightColorPanel
        idPrefix={`control-${id}`}
        rgb={rgb}
        hue={hsvH}
        saturation={hsvS}
        kelvin={lightTemperature(entity)}
        minKelvin={minKelvin}
        maxKelvin={maxKelvin}
        canColor={profile.color}
        canTemperature={profile.temperature}
        disabled={disabled}
        presets={LIGHT_COLOUR_PRESETS}
        onColorRgb={(nextRgb) => sendTargets('color', nextRgb)}
        onColorHsv={(nextHue, nextSat) => sendTargets('color', hsvToRgb(nextHue, nextSat))}
        onTemperature={(nextKelvin) => sendTargets('temperature', nextKelvin)}
      />
      <LightEffectsPanel
        idPrefix={`control-${id}`}
        options={effects}
        active={activeEffect}
        stop={disableEffect}
        disabled={disabled}
        onSelect={(effect) => sendTargets('effect', effect)}
      />
      {lightGroup && onSeparateLightGroup && (
        <LightGroupPanel
          members={lightGroup.members.map((member) => ({
            id: member.primaryEntityId,
            name: member.name,
            state: lightStateDescription(member.state),
          }))}
          disabled={disabled}
          onOpenMember={(memberId) => onOpenMember?.(memberId)}
          onSeparate={() => onSeparateLightGroup(lightGroup.key)}
        />
      )}
    </Stack>
  );
}

export function PowerStripSection({
  device,
  snapshot,
  disabled,
  onControl,
}: {
  readonly device: HomeDevice;
  readonly snapshot: Snapshot;
  readonly disabled: boolean;
  readonly onControl: DeviceControl;
}) {
  const { accessory } = device;
  const outlets = presentPowerOutlets(
    [accessory.state, ...accessory.secondaryEntities],
    accessory.name,
  );
  return (
    <PowerStripPanel
      outlets={outlets}
      disabled={disabled}
      onToggle={(outletId) => {
        if (availableAction(snapshot, outletId, 'toggle')) {
          onControl(outletId, 'toggle');
        }
      }}
    />
  );
}

export function NetworkSection({
  device,
  snapshot,
  disabled,
  onControl,
  onManage,
}: {
  readonly device: HomeDevice;
  readonly snapshot: Snapshot;
  readonly disabled: boolean;
  readonly onControl: DeviceControl;
  readonly onManage?: (url: string) => void;
}) {
  const { accessory } = device;
  const net = classifyNetworkStates(accessory.state, accessory.secondaryEntities);
  const metrics: Array<{ label: string; value: string }> = [];
  const addMetric = (label: string, source?: HassEntity) => {
    const val = metricValue(source);
    if (val) metrics.push({ label, value: val });
  };
  addMetric('Clients', net.clientsEntity);
  addMetric('Guest clients', net.guestClientsEntity);
  addMetric('Download', net.downloadSpeedEntity);
  addMetric('Upload', net.uploadSpeedEntity);
  addMetric('Public IP', net.publicIpEntity);
  addMetric('Gateway', net.gatewayIpEntity);
  addMetric('Mesh', net.meshQualityEntity);

  const actions = [
    ...net.switchEntities.map((item) => ({
      id: item.entity_id,
      label: friendlyEntityLabel(item, accessory.name),
      kind: 'switch' as const,
      active: item.state === 'on',
      disabled: ['unavailable', 'unknown'].includes(item.state),
    })),
    ...net.buttonEntities.map((item) => ({
      id: item.entity_id,
      label: friendlyEntityLabel(item, accessory.name),
      kind: 'button' as const,
      disabled: item.state === 'unavailable',
    })),
  ];

  return (
    <NetworkDetailsPanel
      statusLabel={net.statusEntity.state}
      healthy={['on', 'connected', 'online', 'home'].includes(net.statusEntity.state.toLowerCase())}
      metrics={metrics}
      actions={actions}
      managementUrl={accessory.managementUrl}
      disabled={disabled}
      onToggleSwitch={(eid) => {
        if (availableAction(snapshot, eid, 'toggle')) onControl(eid, 'toggle');
      }}
      onPressButton={(eid) => {
        if (availableAction(snapshot, eid, 'press')) onControl(eid, 'press');
      }}
      onManage={onManage}
    />
  );
}

export function PrinterSuppliesSection({ device }: { readonly device: HomeDevice }) {
  const supplies = extractPrinterSupplies(
    [device.accessory.state, ...device.accessory.secondaryEntities],
    device.accessory.name,
  );
  if (supplies.length === 0) return null;
  return <PrinterSuppliesPanel supplies={supplies} />;
}
