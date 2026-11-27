/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useEffect, useState } from 'react';
import {
  colorToken,
  corners,
  insets,
  pct,
  px,
  rgba,
} from '../../../ir/geometry.js';
import { SolidMaterial } from '../../../ir/materials.js';
import {
  Box,
  HausSegmentedControl,
  HausSlider,
  Pressable,
  Row,
  SelectInput,
  Stack,
  Text,
} from '../../../primitives/index.js';
import { UiIcon } from '../../icon.js';
import { DeviceModalSurfaceCard, DevicePresetPills } from './surfaces.js';

function useDraftNumber(value: number) {
  const [draft, setDraft] = useState<number>();
  useEffect(() => {
    setDraft(undefined);
  }, [value]);
  return [draft ?? value, setDraft] as const;
}

export interface ClimateModalModeOption {
  readonly value: string;
  readonly label: string;
}

export function ClimateModalPanel({
  idPrefix,
  mode,
  modes,
  currentTempLabel,
  targetTemp,
  lowTarget,
  highTarget,
  ranged = false,
  minTemp = 7,
  maxTemp = 35,
  step = 0.5,
  unit = '°',
  kettle = false,
  canSetTemperature,
  canSetMode,
  disabled,
  onTargetTemp,
  onTargetRange,
  onModeChange,
}: {
  readonly idPrefix: string;
  readonly mode: string;
  readonly modes: readonly ClimateModalModeOption[];
  readonly currentTempLabel?: string;
  readonly targetTemp?: number;
  readonly lowTarget?: number;
  readonly highTarget?: number;
  readonly ranged?: boolean;
  readonly minTemp?: number;
  readonly maxTemp?: number;
  readonly step?: number;
  readonly unit?: string;
  readonly kettle?: boolean;
  readonly canSetTemperature: boolean;
  readonly canSetMode: boolean;
  readonly disabled: boolean;
  readonly onTargetTemp?: (next: number) => void;
  readonly onTargetRange?: (low: number, high: number) => void;
  readonly onModeChange?: (mode: string) => void;
}) {
  const safeTarget = targetTemp ?? minTemp;
  const safeLow = lowTarget ?? minTemp;
  const safeHigh = highTarget ?? maxTemp;
  const [shownTarget, setDraftTarget] = useDraftNumber(safeTarget);
  const [shownLow, setDraftLow] = useDraftNumber(safeLow);
  const [shownHigh, setDraftHigh] = useDraftNumber(safeHigh);

  const isOff = mode === 'off';
  const warmAccent =
    mode === 'cool' ? rgba(56, 189, 248, 1) : !isOff ? rgba(251, 146, 60, 1) : undefined;

  const adjustStep = (delta: number) => {
    if (!onTargetTemp || disabled || !canSetTemperature) return;
    const clamped = Math.max(
      minTemp,
      Math.min(maxTemp, Math.round((shownTarget + delta) * 10) / 10),
    );
    onTargetTemp(clamped);
  };

  const presets = kettle
    ? [
        { label: '70° Tea', value: 70 },
        { label: '80° Green', value: 80 },
        { label: '92° Coffee', value: 92 },
        { label: '100° Boil', value: 100 },
      ].filter((p) => p.value >= minTemp && p.value <= maxTemp)
    : [
        { label: `18${unit}`, value: 18 },
        { label: `20${unit}`, value: 20 },
        { label: `22${unit}`, value: 22 },
        { label: `24${unit}`, value: 24 },
      ].filter((p) => p.value >= minTemp && p.value <= maxTemp);

  return (
    <Stack gapPx={12} style={{ layout: { width: pct(100) } }}>
      <DeviceModalSurfaceCard
        title={kettle ? 'Water temperature' : 'Thermostat'}
        badge={currentTempLabel ? `Now ${currentTempLabel}` : undefined}
      >
        <Row
          justify="between"
          align="center"
          gapPx={12}
          style={{ layout: { width: pct(100), padding: insets(6, 0, 4, 0) } }}
        >
          {!ranged && canSetTemperature ? (
            <Pressable
              id={`${idPrefix}-temp-minus`}
              ariaLabel="Decrease target temperature"
              disabled={disabled || shownTarget <= minTemp}
              onActivate={() => adjustStep(-step)}
              style={{
                layout: { width: px(42), height: px(42), alignItems: 'center', justifyContent: 'center' },
                corners: corners(999, 'round'),
                material: new SolidMaterial(colorToken('controlFill')),
                border: { width: 1, color: colorToken('border') },
                opacity: disabled || shownTarget <= minTemp ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                states: {
                  hover: { material: new SolidMaterial(colorToken('controlFillHover')) },
                  pressed: { transform: { scale: 0.94 } },
                },
              }}
            >
              <UiIcon name="minus" size={18} />
            </Pressable>
          ) : (
            <Box style={{ layout: { width: px(42) } }} />
          )}

          <Stack align="center" gapPx={2}>
            <Text size={32} weight={600} style={{ typography: { tabularNums: true, lineHeight: 1.1 } }}>
              {ranged
                ? `${shownLow}${unit} – ${shownHigh}${unit}`
                : targetTemp !== undefined
                  ? `${shownTarget}${unit}`
                  : (currentTempLabel ?? '—')}
            </Text>
            <Text size={11.5} tone="muted">
              {isOff ? 'System off' : ranged ? 'Comfort range' : 'Target temperature'}
            </Text>
          </Stack>

          {!ranged && canSetTemperature ? (
            <Pressable
              id={`${idPrefix}-temp-plus`}
              ariaLabel="Increase target temperature"
              disabled={disabled || shownTarget >= maxTemp}
              onActivate={() => adjustStep(step)}
              style={{
                layout: { width: px(42), height: px(42), alignItems: 'center', justifyContent: 'center' },
                corners: corners(999, 'round'),
                material: new SolidMaterial(colorToken('controlFill')),
                border: { width: 1, color: colorToken('border') },
                opacity: disabled || shownTarget >= maxTemp ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
                states: {
                  hover: { material: new SolidMaterial(colorToken('controlFillHover')) },
                  pressed: { transform: { scale: 0.94 } },
                },
              }}
            >
              <UiIcon name="plus" size={18} />
            </Pressable>
          ) : (
            <Box style={{ layout: { width: px(42) } }} />
          )}
        </Row>

        {canSetTemperature && ranged && onTargetRange && (
          <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
            <HausSlider
              id={`${idPrefix}-temp-low`}
              label="Heat below"
              valueLabel={`${shownLow}${unit}`}
              value={shownLow}
              min={minTemp}
              max={shownHigh}
              step={step}
              accentColor={rgba(251, 146, 60, 1)}
              disabled={disabled}
              onChange={setDraftLow}
              onChangeEnd={(next) => {
                setDraftLow(undefined);
                onTargetRange(next, shownHigh);
              }}
            />
            <HausSlider
              id={`${idPrefix}-temp-high`}
              label="Cool above"
              valueLabel={`${shownHigh}${unit}`}
              value={shownHigh}
              min={shownLow}
              max={maxTemp}
              step={step}
              accentColor={rgba(56, 189, 248, 1)}
              disabled={disabled}
              onChange={setDraftHigh}
              onChangeEnd={(next) => {
                setDraftHigh(undefined);
                onTargetRange(shownLow, next);
              }}
            />
          </Stack>
        )}

        {canSetTemperature && !ranged && targetTemp !== undefined && onTargetTemp && (
          <Stack gapPx={10} style={{ layout: { width: pct(100) } }}>
            <HausSlider
              id={`${idPrefix}-temperature`}
              label="Target"
              valueLabel={`${shownTarget}${unit}`}
              value={shownTarget}
              min={minTemp}
              max={maxTemp}
              step={step}
              size="lg"
              accentColor={warmAccent}
              disabled={disabled}
              onChange={setDraftTarget}
              onChangeEnd={(next) => {
                setDraftTarget(undefined);
                if (next !== safeTarget) onTargetTemp(next);
              }}
            />
            {presets.length > 0 && (
              <DevicePresetPills
                idPrefix={idPrefix}
                disabled={disabled}
                items={presets.map((p) => ({
                  ...p,
                  active: Math.abs(shownTarget - p.value) < step * 0.6,
                }))}
                onSelect={(val) => onTargetTemp(val)}
              />
            )}
          </Stack>
        )}
      </DeviceModalSurfaceCard>

      {canSetMode && modes.length > 0 && onModeChange && (
        <DeviceModalSurfaceCard title="Mode">
          {modes.length <= 5 ? (
            <HausSegmentedControl
              id={`${idPrefix}-mode`}
              aria-label={kettle ? 'Heater mode' : 'HVAC mode'}
              value={mode}
              options={modes.map((m) => ({ value: m.value, label: m.label, disabled }))}
              onChange={onModeChange}
              style={{ layout: { width: pct(100) } }}
            />
          ) : (
            <SelectInput
              id={`${idPrefix}-mode`}
              ariaLabel={kettle ? 'Heater mode' : 'HVAC mode'}
              value={mode}
              disabled={disabled}
              options={modes.map((m) => ({ value: m.value, label: m.label }))}
              onChange={onModeChange}
            />
          )}
        </DeviceModalSurfaceCard>
      )}
    </Stack>
  );
}
