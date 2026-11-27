/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import type { LightEffectOption } from '@haus/core/device';
import { pct, rgba } from '../../../ir/geometry.js';
import { HausSlider, Stack } from '../../../primitives/index.js';
import { LightColorPanel, type LightColorPresetItem } from '../light-controls.js';
import { LightEffectsPanel } from '../light-effects.js';
import { LightGroupPanel, type LightGroupMemberItem } from '../specialty-controls.js';
import {
  DeviceModalHeroBanner,
  DeviceModalSurfaceCard,
  DevicePresetPills,
} from './surfaces.js';

export function LightModalPanel({
  idPrefix,
  deviceName,
  active,
  stateSubtitle,
  brightnessPct,
  rgb,
  hue,
  saturation,
  kelvin,
  minKelvin = 2000,
  maxKelvin = 6500,
  canToggle,
  canBrightness,
  canColor,
  canTemperature,
  effects = [],
  activeEffect,
  stopEffect,
  groupMembers,
  disabled,
  presets,
  onToggle,
  onBrightness,
  onColorRgb,
  onColorHsv,
  onTemperature,
  onSelectEffect,
  onOpenMember,
  onSeparateGroup,
}: {
  readonly idPrefix: string;
  readonly deviceName: string;
  readonly active: boolean;
  readonly stateSubtitle?: string;
  readonly brightnessPct: number;
  readonly rgb: readonly [number, number, number];
  readonly hue: number;
  readonly saturation: number;
  readonly kelvin?: number;
  readonly minKelvin?: number;
  readonly maxKelvin?: number;
  readonly canToggle: boolean;
  readonly canBrightness: boolean;
  readonly canColor: boolean;
  readonly canTemperature: boolean;
  readonly effects?: readonly LightEffectOption[];
  readonly activeEffect?: string;
  readonly stopEffect?: string;
  readonly groupMembers?: readonly LightGroupMemberItem[];
  readonly disabled: boolean;
  readonly presets: readonly LightColorPresetItem[];
  readonly onToggle?: () => void;
  readonly onBrightness?: (pctValue: number) => void;
  readonly onColorRgb: (rgb: [number, number, number]) => void;
  readonly onColorHsv: (hue: number, sat: number) => void;
  readonly onTemperature: (kelvin: number) => void;
  readonly onSelectEffect?: (effect: string) => void;
  readonly onOpenMember?: (id: string) => void;
  readonly onSeparateGroup?: () => void;
}) {
  const [draftBright, setDraftBright] = useState<number>();
  useEffect(() => {
    setDraftBright(undefined);
  }, [brightnessPct, active]);

  const shownBrightness = draftBright ?? (active ? brightnessPct : 0);
  const bulbAccent = active ? rgba(rgb[0], rgb[1], rgb[2], 1) : undefined;

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalHeroBanner
        id={`${idPrefix}-toggle`}
        title={
          active
            ? canBrightness
              ? `On · ${shownBrightness}%`
              : 'On'
            : 'Off'
        }
        subtitle={
          stateSubtitle ??
          (groupMembers?.length
            ? `${groupMembers.length} lights synchronized`
            : active && kelvin
              ? `${kelvin} K white tone`
              : deviceName)
        }
        iconName={groupMembers?.length ? 'layers' : 'lightbulb'}
        active={active}
        accentColor={bulbAccent}
        disabled={disabled || !canToggle}
        switchChecked={active}
        onToggle={canToggle ? onToggle : undefined}
      />

      {canBrightness && onBrightness && (
        <DeviceModalSurfaceCard title="Brightness">
          <HausSlider
            id={`${idPrefix}-brightness`}
            label="Output"
            valueLabel={`${shownBrightness}%`}
            value={shownBrightness}
            min={0}
            max={100}
            size="lg"
            accentColor={bulbAccent}
            disabled={disabled}
            onChange={setDraftBright}
            onChangeEnd={(next) => {
              setDraftBright(undefined);
              onBrightness(next);
            }}
          />
          <DevicePresetPills
            idPrefix={`${idPrefix}-dim`}
            disabled={disabled}
            items={[
              { label: '10%', value: 10, active: active && Math.abs(shownBrightness - 10) <= 4 },
              { label: '35%', value: 35, active: active && Math.abs(shownBrightness - 35) <= 4 },
              { label: '70%', value: 70, active: active && Math.abs(shownBrightness - 70) <= 4 },
              { label: '100%', value: 100, active: active && shownBrightness >= 96 },
            ]}
            onSelect={onBrightness}
          />
        </DeviceModalSurfaceCard>
      )}

      {(canColor || canTemperature) && (
        <DeviceModalSurfaceCard title={canColor ? 'Colour & white tone' : 'White temperature'}>
          <LightColorPanel
            idPrefix={idPrefix}
            rgb={rgb}
            hue={hue}
            saturation={saturation}
            kelvin={kelvin}
            minKelvin={minKelvin}
            maxKelvin={maxKelvin}
            canColor={canColor}
            canTemperature={canTemperature}
            disabled={disabled}
            presets={presets}
            onColorRgb={onColorRgb}
            onColorHsv={onColorHsv}
            onTemperature={onTemperature}
          />
        </DeviceModalSurfaceCard>
      )}

      {effects.some((opt) => !opt.isStatic) && onSelectEffect && (
        <DeviceModalSurfaceCard title="Dynamic atmosphere">
          <LightEffectsPanel
            idPrefix={idPrefix}
            options={effects}
            active={activeEffect}
            stop={stopEffect}
            disabled={disabled}
            onSelect={onSelectEffect}
          />
        </DeviceModalSurfaceCard>
      )}

      {groupMembers && groupMembers.length > 0 && onOpenMember && onSeparateGroup && (
        <DeviceModalSurfaceCard>
          <LightGroupPanel
            members={groupMembers}
            disabled={disabled}
            onOpenMember={onOpenMember}
            onSeparate={onSeparateGroup}
          />
        </DeviceModalSurfaceCard>
      )}
    </Stack>
  );
}
