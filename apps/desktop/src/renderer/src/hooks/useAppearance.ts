/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_LIQUID_GLASS_SETTINGS,
  sanitizeLiquidGlassSettings,
  uniformsFromLiquidGlassSettings,
  type LiquidGlassSettings,
} from '@haus/ui';
import { syncDocumentGlassRimLighting } from '../components/ui/glass-rim-lighting';
import type { Preferences } from '../model/preferences';

export interface ActiveLiquidGlassState {
  readonly isDark: boolean;
  readonly settings: LiquidGlassSettings;
}

let activeLiquidGlassState: ActiveLiquidGlassState = {
  isDark: true,
  settings: DEFAULT_LIQUID_GLASS_SETTINGS,
};
const liquidGlassListeners = new Set<() => void>();

function subscribeLiquidGlass(listener: () => void): () => void {
  liquidGlassListeners.add(listener);
  return () => liquidGlassListeners.delete(listener);
}

function getLiquidGlassSnapshot(): ActiveLiquidGlassState {
  return activeLiquidGlassState;
}

function setActiveLiquidGlassState(next: ActiveLiquidGlassState): void {
  if (
    activeLiquidGlassState.isDark === next.isDark &&
    JSON.stringify(activeLiquidGlassState.settings) === JSON.stringify(next.settings)
  ) {
    return;
  }
  activeLiquidGlassState = next;
  for (const listener of liquidGlassListeners) {
    listener();
  }
}

/** Subscribes any component to the live `LiquidGlassSettings` & dark/light theme state. */
export function useActiveLiquidGlass(): ActiveLiquidGlassState {
  return useSyncExternalStore(subscribeLiquidGlass, getLiquidGlassSnapshot, getLiquidGlassSnapshot);
}

export function useAppearance(preference: 'system' | 'light' | 'dark') {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference;
}

/** Applies active theme, icon style attributes, and analytical Liquid Glass shader parameters. */
export function useDocumentAppearance(
  appearance: 'light' | 'dark',
  preferences: Pick<
    Preferences,
    'iconAppearance' | 'iconVariation' | 'iconTintColor' | 'liquidGlass'
  >,
): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const isDark = appearance === 'dark';
    root.dataset.theme = appearance;
    root.classList.toggle('dark', isDark);
    root.dataset.iconAppearance = preferences.iconAppearance ?? 'default';
    root.dataset.iconVariation = preferences.iconVariation ?? 'auto';
    root.dataset.iconTintColor = preferences.iconTintColor ?? 'automatic';

    const lg = sanitizeLiquidGlassSettings(preferences.liquidGlass);
    setActiveLiquidGlassState({ isDark, settings: lg });

    const uniforms = uniformsFromLiquidGlassSettings(lg, 1, isDark, 32);
    root.dataset.liquidGlass = lg.enabled ? 'true' : 'false';
    root.style.setProperty('--haus-lg-slider-mode', String(lg.sliderMode));
    root.style.setProperty('--haus-lg-blur-radius', `${Math.round(uniforms.u_blur_radius)}px`);
    root.style.setProperty('--haus-lg-saturation', `${Math.round(lg.saturation * 100)}%`);
    root.style.setProperty('--haus-lg-bevel-width', `${lg.edgeWidth}px`);
    root.style.setProperty('--haus-lg-refraction', String(lg.refractionStrength));
    root.style.setProperty('--haus-lg-dispersion', String(lg.dispersion));

    if (lg.enabled) {
      const r = Math.round(uniforms.u_tint_r * 255);
      const g = Math.round(uniforms.u_tint_g * 255);
      const b = Math.round(uniforms.u_tint_b * 255);
      const a = Number(uniforms.u_tint_a.toFixed(3));
      root.style.setProperty('--dock-glass', `rgba(${r}, ${g}, ${b}, ${a})`);
    } else {
      root.style.removeProperty('--dock-glass');
    }

    syncDocumentGlassRimLighting(isDark);
  }, [
    appearance,
    preferences.iconAppearance,
    preferences.iconVariation,
    preferences.iconTintColor,
    preferences.liquidGlass,
  ]);

  useEffect(() => {
    const onResize = () => syncDocumentGlassRimLighting(appearance === 'dark');
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [appearance]);
}
