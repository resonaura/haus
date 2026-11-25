/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { createHausUiTheme } from '../generated/index.js';
import type { ViewportMetrics } from '../ir/geometry.js';
import { createDefaultShaderRegistry, type ShaderPassDescriptor } from '../ir/materials.js';
import type { ThemeMode, UiNode } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import { DOM_HOST_ADAPTER } from '../renderers/dom-host.js';
import { ensureDomResetStyle } from '../renderers/dom-reset.js';
import type { UiContentHost, UiHostAdapter } from '../renderers/host.js';
import { NativeSceneGraphRenderer, type HausSceneGraphIR } from '../renderers/native-ir.js';
import { ReactDomRenderer } from '../renderers/react-dom.js';
import {
  ReactNativeRenderer,
  type ReactNativeElementDescriptor,
} from '../renderers/react-native.js';
import type { HausStyleSheet, StyleSlotMap } from '../styles/sheet.js';

const DEFAULT_DARK_THEME = createHausUiTheme('dark');
const DEFAULT_LIGHT_THEME = createHausUiTheme('light');

function readDocumentThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function readViewportMetrics(): ViewportMetrics {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      width: 1440,
      height: 900,
      dpr: 2,
      reducedMotion: false,
      reducedTransparency: false,
      highContrast: false,
    };
  }
  const hasMatchMedia = typeof window.matchMedia === 'function';
  return {
    width: window.innerWidth || 1440,
    height: window.innerHeight || 900,
    dpr: window.devicePixelRatio || 1,
    reducedMotion: hasMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    reducedTransparency:
      hasMatchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches,
    highContrast: hasMatchMedia && window.matchMedia('(prefers-contrast: more)').matches,
  };
}

export interface HausUiContextValue extends RenderContext {
  readonly host: UiHostAdapter;
  readonly contentHost: UiContentHost;
  readonly portal?: (node: React.ReactNode) => React.ReactNode;
  readonly domRenderer: ReactDomRenderer;
  readonly nativeRenderer: NativeSceneGraphRenderer;
  readonly reactNativeRenderer: ReactNativeRenderer;
  readonly compileToNativeIR: (node: UiNode) => HausSceneGraphIR;
  readonly compileToReactNative: (node: UiNode) => ReactNativeElementDescriptor;
}

const DEFAULT_SHADER_REGISTRY = createDefaultShaderRegistry();
const DOM_RENDERER = new ReactDomRenderer();
const NATIVE_RENDERER = new NativeSceneGraphRenderer();
const RN_RENDERER = new ReactNativeRenderer();

const HausUiContext = React.createContext<HausUiContextValue | null>(null);

export function useHausUi(): HausUiContextValue {
  const existing = React.useContext(HausUiContext);
  const [fallbackViewport, setFallbackViewport] =
    React.useState<ViewportMetrics>(readViewportMetrics);

  React.useEffect(() => {
    if (existing || typeof document === 'undefined' || typeof window === 'undefined')
      return undefined;
    const onResize = () => setFallbackViewport(readViewportMetrics());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [existing]);

  return React.useMemo<HausUiContextValue>(() => {
    if (existing) return existing;
    const theme = readDocumentThemeMode() === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const ctx: RenderContext = {
      theme,
      viewport: fallbackViewport,
      shaderRegistry: DEFAULT_SHADER_REGISTRY,
    };
    return {
      ...ctx,
      host: DOM_HOST_ADAPTER,
      contentHost: DOM_HOST_ADAPTER,
      domRenderer: DOM_RENDERER,
      nativeRenderer: NATIVE_RENDERER,
      reactNativeRenderer: RN_RENDERER,
      compileToNativeIR: (node: UiNode) => NATIVE_RENDERER.render(node, ctx),
      compileToReactNative: (node: UiNode) => RN_RENDERER.render(node, ctx),
    };
  }, [existing, fallbackViewport]);
}

/** Resolves a pure TypeScript `HausStyleSheet` against the active theme and viewport. */
export function useHausStyles<TSlots extends StyleSlotMap, TProps = void>(
  sheet: HausStyleSheet<TSlots, TProps>,
  props: TProps,
): TSlots {
  const { theme, viewport } = useHausUi();
  return sheet.resolve(theme, props, viewport);
}

export function HausUiThemeScope({
  mode,
  children,
}: {
  readonly mode: ThemeMode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const parent = useHausUi();
  const value = React.useMemo(() => {
    if (parent.theme.mode === mode) return parent;
    const theme = mode === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const context = { theme, viewport: parent.viewport, shaderRegistry: parent.shaderRegistry };
    return {
      ...parent,
      ...context,
      compileToNativeIR: (node: UiNode) => parent.nativeRenderer.render(node, context),
      compileToReactNative: (node: UiNode) => parent.reactNativeRenderer.render(node, context),
    };
  }, [parent, mode]);
  return <HausUiContext.Provider value={value}>{children}</HausUiContext.Provider>;
}

export interface HausUiProviderProps {
  readonly mode?: ThemeMode | 'auto';
  readonly reducedTransparency?: boolean;
  readonly host?: UiHostAdapter;
  readonly contentHost?: UiContentHost;
  readonly portal?: (node: React.ReactNode) => React.ReactNode;
  readonly customShaders?: readonly ShaderPassDescriptor[];
  readonly children?: React.ReactNode;
}

export function HausUiProvider({
  mode = 'auto',
  reducedTransparency,
  host = DOM_HOST_ADAPTER,
  contentHost = host,
  portal,
  customShaders,
  children,
}: HausUiProviderProps): React.ReactElement {
  const readDom = host === contentHost && host.target === 'react-dom';
  const [viewport, setViewport] = React.useState<ViewportMetrics>(readViewportMetrics);
  const [autoMode, setAutoMode] = React.useState<ThemeMode>(() =>
    readDom && mode === 'auto' ? readDocumentThemeMode() : 'dark',
  );

  React.useEffect(() => {
    if (!readDom || typeof document === 'undefined' || typeof window === 'undefined')
      return undefined;
    ensureDomResetStyle(document);
    const onResize = () => setViewport(readViewportMetrics());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [readDom]);

  React.useEffect(() => {
    if (
      mode !== 'auto' ||
      !readDom ||
      typeof document === 'undefined' ||
      typeof MutationObserver === 'undefined'
    )
      return undefined;
    setAutoMode(readDocumentThemeMode());
    const observer = new MutationObserver(() => setAutoMode(readDocumentThemeMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [mode, readDom]);

  const shaderRegistry = React.useMemo(() => {
    if (!customShaders?.length) return DEFAULT_SHADER_REGISTRY;
    const reg = createDefaultShaderRegistry();
    for (const shader of customShaders) {
      reg.register(shader);
    }
    return reg;
  }, [customShaders]);

  const resolvedMode: ThemeMode = mode === 'auto' ? autoMode : mode;
  const effectiveViewport = React.useMemo<ViewportMetrics>(
    () => (reducedTransparency === undefined ? viewport : { ...viewport, reducedTransparency }),
    [reducedTransparency, viewport],
  );

  const value = React.useMemo<HausUiContextValue>(() => {
    const theme = resolvedMode === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const ctx: RenderContext = { theme, viewport: effectiveViewport, shaderRegistry };
    return {
      ...ctx,
      host,
      contentHost,
      portal,
      domRenderer: DOM_RENDERER,
      nativeRenderer: NATIVE_RENDERER,
      reactNativeRenderer: RN_RENDERER,
      compileToNativeIR: (node: UiNode) => NATIVE_RENDERER.render(node, ctx),
      compileToReactNative: (node: UiNode) => RN_RENDERER.render(node, ctx),
    };
  }, [resolvedMode, effectiveViewport, shaderRegistry, host, contentHost, portal]);

  return (
    <HausUiContext.Provider value={value}>
      {host === contentHost ? (host.renderShaderDefs?.(shaderRegistry) ?? null) : null}
      {children}
    </HausUiContext.Provider>
  );
}
