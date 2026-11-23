/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useState } from 'react';
import { Button, Switch } from '@heroui/react';
import {
  DEFAULT_LIQUID_GLASS_SETTINGS,
  glassMaterialControls,
  LIQUID_GLASS_RECIPES,
  sanitizeLiquidGlassSettings,
  type LiquidGlassRecipeName,
  type LiquidGlassSettings,
} from '@haus/ui';
import type { LiquidGlassPreference } from '../../model/preferences';

const RECIPE_LABELS: ReadonlyArray<{
  readonly id: LiquidGlassRecipeName;
  readonly label: string;
}> = [
  { id: 'dock', label: 'Dock & Category Bar' },
  { id: 'toolbar', label: 'Toolbar' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'hud', label: 'HUD & Control Center' },
  { id: 'menu', label: 'Menus & Popovers' },
  { id: 'notification', label: 'Notifications' },
  { id: 'dockTooltip', label: 'Tooltip Capsule' },
  { id: 'altTab', label: 'Switcher Platter' },
  { id: 'appIcons', label: 'Icon Lens' },
];

export interface LiquidGlassSettingsPanelProps {
  readonly value?: LiquidGlassPreference;
  readonly onChange: (next: LiquidGlassPreference) => void;
}

export function LiquidGlassSettingsPanel({ value, onChange }: LiquidGlassSettingsPanelProps) {
  const settings = sanitizeLiquidGlassSettings(value ?? DEFAULT_LIQUID_GLASS_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeRecipe = LIQUID_GLASS_RECIPES[settings.recipe] ?? LIQUID_GLASS_RECIPES.dock;
  const material = glassMaterialControls(activeRecipe, settings.sliderMode);

  const update = (patch: Partial<LiquidGlassSettings>) => {
    const merged = sanitizeLiquidGlassSettings({ ...settings, ...patch });
    onChange({ ...merged });
  };

  const applyRecipePreset = (recipeId: LiquidGlassRecipeName) => {
    const preset = LIQUID_GLASS_RECIPES[recipeId];
    onChange({
      enabled: settings.enabled,
      recipe: recipeId,
      sliderMode: preset.sliderMode ?? 0.5,
      refractionStrength: preset.refractionStrength,
      edgeWidth: preset.edgeWidth,
      dispersion: preset.dispersion,
      saturation: preset.saturation,
      specularDial: preset.specularDial,
      edgeHighlight: preset.edgeHighlight,
      darkenedEdge: preset.darkenedEdge,
      ior: preset.ior,
      nativeRim: Boolean(preset.nativeRim ?? true),
    });
  };

  return (
    <div
      className="liquid-glass-settings"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        paddingTop: '8px',
        borderTop: '1px solid var(--line, rgba(128, 128, 128, 0.16))',
      }}
    >
      <div className="settings-row">
        <div>
          <span style={{ display: 'block', fontWeight: 600 }}>Liquid Glass</span>
          <small style={{ opacity: 0.68, fontSize: '11.5px' }}>
            Optical bevel refraction, prism dispersion, and rim lighting on navigation bars
          </small>
        </div>
        <Switch
          aria-label="Enable Liquid Glass"
          isSelected={settings.enabled}
          onChange={(enabled) => update({ enabled })}
        >
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          opacity: settings.enabled ? 1 : 0.45,
          pointerEvents: settings.enabled ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12.5px',
          }}
        >
          <span style={{ fontWeight: 500 }}>Blur strength</span>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '11.5px',
              opacity: 0.78,
            }}
          >
            {Math.round(settings.sliderMode * 100)}% · {material.blurRadius.toFixed(1)} pt
          </span>
        </div>
        <input
          type="range"
          aria-label="Blur strength"
          min={0}
          max={1}
          step={0.01}
          value={settings.sliderMode}
          disabled={!settings.enabled}
          onChange={(e) => update({ sliderMode: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            opacity: 0.65,
          }}
        >
          <span>Low</span>
          <span>Frosted</span>
        </div>
      </div>

      {settings.enabled && (
        <>
          <div className="settings-row">
            <span>Material profile</span>
            <select
              aria-label="Liquid Glass material profile"
              value={settings.recipe}
              onChange={(e) => applyRecipePreset(e.target.value as LiquidGlassRecipeName)}
              style={{
                padding: '6px 10px',
                borderRadius: '10px',
                border: '1px solid var(--line, rgba(128, 128, 128, 0.24))',
                background: 'rgba(128, 128, 128, 0.08)',
                color: 'inherit',
                fontSize: '12.5px',
              }}
            >
              {RECIPE_LABELS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'inherit',
                fontSize: '12px',
                opacity: 0.78,
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              {showAdvanced ? 'Hide shader parameters' : 'Tune optical shader parameters'}
            </button>
            {showAdvanced && (
              <Button variant="ghost" size="sm" onPress={() => applyRecipePreset(settings.recipe)}>
                Reset preset
              </Button>
            )}
          </div>

          {showAdvanced && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: '10px 16px',
                padding: '10px 12px',
                borderRadius: '14px',
                background: 'rgba(128, 128, 128, 0.07)',
              }}
            >
              <SliderControl
                label="Refraction strength"
                value={settings.refractionStrength}
                min={0}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(refractionStrength) => update({ refractionStrength })}
              />
              <SliderControl
                label="Bevel width"
                value={settings.edgeWidth}
                min={4}
                max={28}
                step={0.25}
                format={(v) => `${v.toFixed(2)} pt`}
                onChange={(edgeWidth) => update({ edgeWidth })}
              />
              <SliderControl
                label="Chromatic dispersion"
                value={settings.dispersion}
                min={0}
                max={0.35}
                step={0.005}
                format={(v) => v.toFixed(3)}
                onChange={(dispersion) => update({ dispersion })}
              />
              <SliderControl
                label="Backdrop saturation"
                value={settings.saturation}
                min={0.5}
                max={2.2}
                step={0.05}
                format={(v) => `${v.toFixed(2)}×`}
                onChange={(saturation) => update({ saturation })}
              />
              <SliderControl
                label="Specular highlight"
                value={settings.specularDial}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(specularDial) => update({ specularDial })}
              />
              <SliderControl
                label="Rim highlight"
                value={settings.edgeHighlight}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(edgeHighlight) => update({ edgeHighlight })}
              />
              <SliderControl
                label="Edge darkening"
                value={settings.darkenedEdge}
                min={0}
                max={0.15}
                step={0.005}
                format={(v) => v.toFixed(3)}
                onChange={(darkenedEdge) => update({ darkenedEdge })}
              />
              <SliderControl
                label="Index of refraction (IOR)"
                value={settings.ior}
                min={1.1}
                max={2.0}
                step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(ior) => update({ ior })}
              />
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '4px',
                }}
              >
                <span style={{ fontSize: '12px' }}>Analytical dual-band rim lighting</span>
                <Switch
                  aria-label="Analytical dual-band rim lighting"
                  isSelected={settings.nativeRim}
                  onChange={(nativeRim) => update({ nativeRim })}
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (v: number) => string;
  readonly onChange: (next: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11.5px',
        }}
      >
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', opacity: 0.75 }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
