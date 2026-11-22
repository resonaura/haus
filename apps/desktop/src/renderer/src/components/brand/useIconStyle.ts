/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { useSyncExternalStore } from 'react';
import {
  DEFAULT_ICON_STYLE,
  resolveIconStyle,
  sanitizeIconStyle,
  type ResolvedIconStyle,
} from '@haus/icons';

function readDocumentIconStyle(): ResolvedIconStyle {
  if (typeof document === 'undefined') {
    return resolveIconStyle(DEFAULT_ICON_STYLE, false);
  }
  const dataset = document.documentElement.dataset;
  const systemDark = dataset.theme === 'dark';
  const settings = sanitizeIconStyle({
    appearance: dataset.iconAppearance,
    variation: dataset.iconVariation,
    tintColor: dataset.iconTintColor,
  });
  return resolveIconStyle(settings, systemDark);
}

const SERVER_FALLBACK_STYLE: ResolvedIconStyle = resolveIconStyle(DEFAULT_ICON_STYLE, false);

let cachedStyle: ResolvedIconStyle = readDocumentIconStyle();
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function stylesEqual(a: ResolvedIconStyle, b: ResolvedIconStyle): boolean {
  return (
    a.appearance === b.appearance &&
    a.variation === b.variation &&
    a.tintColor === b.tintColor &&
    a.tintHex === b.tintHex
  );
}

function syncCachedStyle(): void {
  const next = readDocumentIconStyle();
  if (stylesEqual(next, cachedStyle)) return;
  cachedStyle = next;
  for (const listener of listeners) listener();
}

function ensureDocumentObserver(): void {
  if (observer || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }
  observer = new MutationObserver(syncCachedStyle);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      'data-theme',
      'data-icon-appearance',
      'data-icon-variation',
      'data-icon-tint-color',
    ],
  });
}

function subscribe(listener: () => void): () => void {
  ensureDocumentObserver();
  syncCachedStyle();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ResolvedIconStyle {
  return cachedStyle;
}

function getServerSnapshot(): ResolvedIconStyle {
  return SERVER_FALLBACK_STYLE;
}

/**
 * Shared singleton observer hook returning the active resolved GNOME/macOS icon style
 * (`default`, `dark`, `clear`, `tinted` × resolved light/dark variation × resolved tint hex).
 * Uses `useSyncExternalStore` with stable cached identity to avoid mount-time double renders.
 */
export function useIconStyle(): ResolvedIconStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
