/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { useState } from 'react';
import { colorToken, corners, insets, px, rgba } from '../../ir/geometry.js';
import {
  DEFAULT_LIQUID_GLASS_SETTINGS,
  glassMaterialControls,
  LIQUID_GLASS_RECIPES,
  sanitizeLiquidGlassSettings,
  type LiquidGlassRecipeName,
  type LiquidGlassSettings,
} from '../../ir/liquid-glass-shader.js';
import { SolidMaterial } from '../../ir/materials.js';
import { HausButton, HausSlider, HausSwitch } from '../../primitives/controls.js';
import { Divider, Grid, Row, Stack, Text } from '../../primitives/elements.js';
import { HausSelect } from '../../primitives/overlays.js';

const RECIPE_LABELS: ReadonlyArray<{
  readonly value: LiquidGlassRecipeName;
  readonly label: string;
}> = [
  { value: 'dock', label: 'Dock & Category Bar' },
  { value: 'toolbar', label: 'Toolbar' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'hud', label: 'HUD & Control Center' },
  { value: 'menu', label: 'Menus & Popovers' },
  { value: 'notification', label: 'Notifications' },
  { value: 'dockTooltip', label: 'Tooltip Capsule' },
  { value: 'altTab', label: 'Switcher Platter' },
  { value: 'appIcons', label: 'Icon Lens' },
];

export interface LiquidGlassSettingsPanelProps {
  readonly value?: Partial<LiquidGlassSettings>;
  readonly onChange: (next: LiquidGlassSettings) => void;
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
    <Stack gapPx={12}>
      <Divider />
      <Row justify="between">
        <Stack gapPx={2} style={{ layout: { flexGrow: 1, minWidth: px(0) } }}>
          <Text size={13.5} weight={600}>
            Liquid Glass
          </Text>
          <Text tone="muted" size={11.5}>
            Optical bevel refraction, prism dispersion, and rim lighting on navigation bars
          </Text>
        </Stack>
        <HausSwitch
          id="liquid-glass-enabled"
          aria-label="Enable Liquid Glass"
          isSelected={settings.enabled}
          onChange={(enabled) => update({ enabled })}
        />
      </Row>

      <HausSlider
        id="liquid-glass-blur"
        label="Blur strength"
        aria-label="Blur strength"
        value={settings.sliderMode}
        min={0}
        max={1}
        step={0.01}
        disabled={!settings.enabled}
        valueLabel={`${Math.round(settings.sliderMode * 100)}% · ${material.blurRadius.toFixed(1)} pt`}
        minLabel="Low"
        maxLabel="Frosted"
        onChange={(sliderMode) => update({ sliderMode })}
      />

      {settings.enabled && (
        <Stack gapPx={12}>
          <Row justify="between">
            <Text size={13}>Material profile</Text>
            <HausSelect
              id="liquid-glass-recipe"
              aria-label="Liquid Glass material profile"
              value={settings.recipe}
              options={RECIPE_LABELS}
              onChange={(recipe) => applyRecipePreset(recipe)}
            />
          </Row>

          <Row justify="between">
            <HausButton
              id="liquid-glass-advanced"
              variant="ghost"
              size="sm"
              onPress={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? 'Hide shader parameters' : 'Tune optical shader parameters'}
            </HausButton>
            {showAdvanced && (
              <HausButton
                variant="secondary"
                size="sm"
                onPress={() => applyRecipePreset(settings.recipe)}
              >
                Reset preset
              </HausButton>
            )}
          </Row>

          {showAdvanced && (
            <Stack
              gapPx={12}
              style={{
                layout: { padding: insets(12) },
                material: new SolidMaterial(rgba(128, 128, 128, 0.08)),
                border: { width: 1, color: colorToken('borderSubtle') },
                corners: corners(14),
              }}
            >
              <Grid columns={2} minColumnWidthPx={200} gapPx={14}>
                <HausSlider
                  label="Refraction strength"
                  value={settings.refractionStrength}
                  min={0}
                  max={1}
                  step={0.01}
                  valueLabel={settings.refractionStrength.toFixed(2)}
                  onChange={(refractionStrength) => update({ refractionStrength })}
                />
                <HausSlider
                  label="Bevel width"
                  value={settings.edgeWidth}
                  min={4}
                  max={28}
                  step={0.25}
                  valueLabel={`${settings.edgeWidth.toFixed(2)} pt`}
                  onChange={(edgeWidth) => update({ edgeWidth })}
                />
                <HausSlider
                  label="Chromatic dispersion"
                  value={settings.dispersion}
                  min={0}
                  max={0.35}
                  step={0.005}
                  valueLabel={settings.dispersion.toFixed(3)}
                  onChange={(dispersion) => update({ dispersion })}
                />
                <HausSlider
                  label="Backdrop saturation"
                  value={settings.saturation}
                  min={0.5}
                  max={2.2}
                  step={0.05}
                  valueLabel={`${settings.saturation.toFixed(2)}×`}
                  onChange={(saturation) => update({ saturation })}
                />
                <HausSlider
                  label="Specular highlight"
                  value={settings.specularDial}
                  min={0}
                  max={1}
                  step={0.05}
                  valueLabel={settings.specularDial.toFixed(2)}
                  onChange={(specularDial) => update({ specularDial })}
                />
                <HausSlider
                  label="Rim highlight"
                  value={settings.edgeHighlight}
                  min={0}
                  max={1}
                  step={0.05}
                  valueLabel={settings.edgeHighlight.toFixed(2)}
                  onChange={(edgeHighlight) => update({ edgeHighlight })}
                />
                <HausSlider
                  label="Edge darkening"
                  value={settings.darkenedEdge}
                  min={0}
                  max={0.15}
                  step={0.005}
                  valueLabel={settings.darkenedEdge.toFixed(3)}
                  onChange={(darkenedEdge) => update({ darkenedEdge })}
                />
                <HausSlider
                  label="Index of refraction (IOR)"
                  value={settings.ior}
                  min={1.1}
                  max={2.0}
                  step={0.05}
                  valueLabel={settings.ior.toFixed(2)}
                  onChange={(ior) => update({ ior })}
                />
              </Grid>
              <Row justify="between" style={{ layout: { padding: { top: px(4) } } }}>
                <Text size={12}>Analytical dual-band rim lighting</Text>
                <HausSwitch
                  aria-label="Analytical dual-band rim lighting"
                  size="sm"
                  isSelected={settings.nativeRim}
                  onChange={(nativeRim) => update({ nativeRim })}
                />
              </Row>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}
