/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { syncDocumentGlassRimLighting } from '../components/ui/glass-rim-lighting';
import type { Preferences } from '../model/preferences';

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

/** Applies active theme, icon style attributes, and analytical Liquid Glass rim lighting. */
export function useDocumentAppearance(
  appearance: 'light' | 'dark',
  preferences: Pick<Preferences, 'iconAppearance' | 'iconVariation' | 'iconTintColor'>,
): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance;
    root.classList.toggle('dark', appearance === 'dark');
    root.dataset.iconAppearance = preferences.iconAppearance ?? 'default';
    root.dataset.iconVariation = preferences.iconVariation ?? 'auto';
    root.dataset.iconTintColor = preferences.iconTintColor ?? 'automatic';
    syncDocumentGlassRimLighting(appearance === 'dark');
  }, [
    appearance,
    preferences.iconAppearance,
    preferences.iconVariation,
    preferences.iconTintColor,
  ]);

  useEffect(() => {
    const onResize = () => syncDocumentGlassRimLighting(appearance === 'dark');
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [appearance]);
}
