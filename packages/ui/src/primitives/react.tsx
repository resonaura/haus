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
import type { ThemeMode, UiNode, UiStyleSpec } from '../ir/node.js';
import type { RenderContext } from '../renderers/contract.js';
import { NativeSceneGraphRenderer, type HausSceneGraphIR } from '../renderers/native-ir.js';
import {
  compileStyleToReactCss,
  ReactDomRenderer,
  renderSvgShaderDefs,
} from '../renderers/react-dom.js';
import {
  ReactNativeRenderer,
  type ReactNativeElementDescriptor,
} from '../renderers/react-native.js';
import {
  BadgeBlueprint,
  ButtonBlueprint,
  GlassSurfaceBlueprint,
  ModalBlueprint,
  ProgressBarBlueprint,
  QrCardBlueprint,
  SplitPaneBlueprint,
  SurfaceBlueprint,
  UpdateCardBlueprint,
  type BadgeBlueprintProps,
  type ButtonBlueprintProps,
  type GlassSurfaceBlueprintProps,
  type ModalBlueprintProps,
  type ProgressBarBlueprintProps,
  type QrCardBlueprintProps,
  type SplitPaneBlueprintProps,
  type SurfaceBlueprintProps,
  type UpdateCardBlueprintProps,
} from './blueprints.js';

const DEFAULT_DARK_THEME = createHausUiTheme('dark');
const DEFAULT_LIGHT_THEME = createHausUiTheme('light');

function readViewportMetrics(): ViewportMetrics {
  if (typeof window === 'undefined') {
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
  const reducedMotion =
    hasMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedTransparency =
    hasMatchMedia && window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
  const highContrast = hasMatchMedia && window.matchMedia('(prefers-contrast: more)').matches;
  return {
    width: window.innerWidth || 1440,
    height: window.innerHeight || 900,
    dpr: window.devicePixelRatio || 1,
    reducedMotion,
    reducedTransparency,
    highContrast,
  };
}

export interface HausUiContextValue extends RenderContext {
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
    if (existing || typeof window === 'undefined') return undefined;
    const onResize = () => setFallbackViewport(readViewportMetrics());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [existing]);

  return React.useMemo<HausUiContextValue>(() => {
    if (existing) return existing;
    const isLight =
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme') === 'light';
    const theme = isLight ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const ctx: RenderContext = {
      theme,
      viewport: fallbackViewport,
      shaderRegistry: DEFAULT_SHADER_REGISTRY,
    };
    return {
      ...ctx,
      domRenderer: DOM_RENDERER,
      nativeRenderer: NATIVE_RENDERER,
      reactNativeRenderer: RN_RENDERER,
      compileToNativeIR: (node: UiNode) => NATIVE_RENDERER.render(node, ctx),
      compileToReactNative: (node: UiNode) => RN_RENDERER.render(node, ctx),
    };
  }, [existing, fallbackViewport]);
}

export interface HausUiProviderProps {
  readonly mode?: ThemeMode;
  readonly customShaders?: readonly ShaderPassDescriptor[];
  readonly children?: React.ReactNode;
}

export function HausUiProvider({
  mode = 'dark',
  customShaders,
  children,
}: HausUiProviderProps): React.ReactElement {
  const [viewport, setViewport] = React.useState<ViewportMetrics>(readViewportMetrics);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setViewport(readViewportMetrics());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shaderRegistry = React.useMemo(() => {
    const reg = createDefaultShaderRegistry();
    for (const shader of customShaders ?? []) {
      reg.register(shader);
    }
    return reg;
  }, [customShaders]);

  const value = React.useMemo<HausUiContextValue>(() => {
    const theme = mode === 'light' ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    const ctx: RenderContext = { theme, viewport, shaderRegistry };
    return {
      ...ctx,
      domRenderer: DOM_RENDERER,
      nativeRenderer: NATIVE_RENDERER,
      reactNativeRenderer: RN_RENDERER,
      compileToNativeIR: (node: UiNode) => NATIVE_RENDERER.render(node, ctx),
      compileToReactNative: (node: UiNode) => RN_RENDERER.render(node, ctx),
    };
  }, [mode, viewport, shaderRegistry]);

  return (
    <HausUiContext.Provider value={value}>
      {renderSvgShaderDefs(shaderRegistry)}
      {children}
    </HausUiContext.Provider>
  );
}

/** Renders any pure OOP `UiNode` scene graph into the DOM. */
export function HausNodeView({ node }: { readonly node: UiNode }): React.ReactElement {
  const ctx = useHausUi();
  return ctx.domRenderer.render(node, ctx);
}

const SURFACE_BLUEPRINT = new SurfaceBlueprint();
const GLASS_BLUEPRINT = new GlassSurfaceBlueprint();
const BUTTON_BLUEPRINT = new ButtonBlueprint();
const BADGE_BLUEPRINT = new BadgeBlueprint();
const SPLIT_BLUEPRINT = new SplitPaneBlueprint();
const MODAL_BLUEPRINT = new ModalBlueprint();
const PROGRESS_BLUEPRINT = new ProgressBarBlueprint();
const UPDATE_BLUEPRINT = new UpdateCardBlueprint();
const QR_BLUEPRINT = new QrCardBlueprint();

export interface HausSurfaceProps extends Omit<SurfaceBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausSurface({
  className,
  children,
  ...blueprintProps
}: HausSurfaceProps): React.ReactElement {
  const ctx = useHausUi();
  const node = SURFACE_BLUEPRINT.build(blueprintProps, ctx.theme);
  const { style, shaderId } = compileStyleToReactCss(node.style, ctx);
  return (
    <div
      id={node.id}
      className={className}
      style={style}
      data-haus-kind="surface"
      data-haus-shader={shaderId}
    >
      {children}
    </div>
  );
}

export interface HausGlassSurfaceProps extends Omit<GlassSurfaceBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausGlassSurface({
  className,
  children,
  ...blueprintProps
}: HausGlassSurfaceProps): React.ReactElement {
  const ctx = useHausUi();
  const node = GLASS_BLUEPRINT.build(blueprintProps, ctx.theme);
  const { style, shaderId } = compileStyleToReactCss(node.style, ctx);
  return (
    <div
      id={node.id}
      className={className}
      style={style}
      data-haus-kind="glass-surface"
      data-haus-shader={shaderId}
    >
      {children}
    </div>
  );
}

export interface HausButtonProps extends Omit<ButtonBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausButton({
  className,
  children,
  label,
  disabled,
  onPress,
  ...rest
}: HausButtonProps): React.ReactElement {
  const ctx = useHausUi();
  const node = BUTTON_BLUEPRINT.build({ label, disabled, onPress, ...rest }, ctx.theme);
  const { style } = compileStyleToReactCss(node.style, ctx);
  return (
    <button
      id={node.id}
      type="button"
      className={className}
      style={style}
      disabled={disabled}
      onClick={disabled ? undefined : onPress}
      data-haus-kind="button"
    >
      {children ?? label}
    </button>
  );
}

export function HausBadge(props: BadgeBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = BADGE_BLUEPRINT.build(props, ctx.theme);
  return ctx.domRenderer.render(node, ctx);
}

export interface HausCardProps {
  readonly id?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly badge?: { readonly label: string; readonly tone?: BadgeBlueprintProps['tone'] };
  readonly glass?: boolean;
  readonly paddingPx?: number;
  readonly style?: UiStyleSpec;
  readonly className?: string;
  readonly headerRight?: React.ReactNode;
  readonly children?: React.ReactNode;
}

export function HausCard({
  id,
  title,
  subtitle,
  badge,
  glass = true,
  paddingPx = 14,
  style,
  className,
  headerRight,
  children,
}: HausCardProps): React.ReactElement {
  const SurfaceComp = glass ? HausGlassSurface : HausSurface;
  return (
    <SurfaceComp id={id} paddingPx={paddingPx} style={style} className={className}>
      {(title || subtitle || badge || headerRight) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            marginBottom: children ? '10px' : 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            {title && (
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                }}
              >
                {title}
              </div>
            )}
            {subtitle && <div style={{ fontSize: '11.5px', opacity: 0.72 }}>{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {badge && <HausBadge label={badge.label} tone={badge.tone} />}
            {headerRight}
          </div>
        </div>
      )}
      {children}
    </SurfaceComp>
  );
}

export interface HausSplitPaneProps extends Omit<SplitPaneBlueprintProps, 'children'> {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function HausSplitPane({
  className,
  children,
  ...rest
}: HausSplitPaneProps): React.ReactElement {
  const ctx = useHausUi();
  const childCount = React.Children.count(children);
  const placeholderNodes = Array.from({ length: Math.max(1, childCount) }, () =>
    SURFACE_BLUEPRINT.build({}, ctx.theme),
  );
  const node = SPLIT_BLUEPRINT.build(
    { ...rest, children: placeholderNodes },
    ctx.theme,
    ctx.viewport,
  );
  const { style } = compileStyleToReactCss(node.style, ctx);
  return (
    <div id={node.id} className={className} style={style} data-haus-kind="split">
      {children}
    </div>
  );
}

export interface HausModalProps extends Omit<
  ModalBlueprintProps,
  'children' | 'headerActions' | 'footer'
> {
  readonly className?: string;
  readonly headerActions?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly children?: React.ReactNode;
}

export function HausModal({
  className,
  title,
  subtitle,
  size = 'adaptive',
  glass = true,
  richContentCount,
  style: customStyle,
  headerActions,
  footer,
  children,
}: HausModalProps): React.ReactElement {
  const ctx = useHausUi();
  const node = MODAL_BLUEPRINT.build(
    {
      title,
      subtitle,
      size,
      glass,
      richContentCount: richContentCount ?? React.Children.count(children),
      style: customStyle,
    },
    ctx.theme,
    ctx.viewport,
  );
  const { style, shaderId } = compileStyleToReactCss(node.style, ctx);
  return (
    <section
      className={className}
      style={style}
      role="dialog"
      aria-label={title}
      data-haus-kind="modal"
      data-haus-shader={shaderId}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>{title}</h2>
          {subtitle && <span style={{ fontSize: '13px', opacity: 0.75 }}>{subtitle}</span>}
        </div>
        {headerActions}
      </header>
      {children}
      {footer}
    </section>
  );
}

export function HausProgressBar(props: ProgressBarBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = PROGRESS_BLUEPRINT.build(props);
  return ctx.domRenderer.render(node, ctx);
}

export function HausUpdateCard(props: UpdateCardBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = UPDATE_BLUEPRINT.build(props, ctx.theme, ctx.viewport);
  return ctx.domRenderer.render(node, ctx);
}

export function HausQrCard(props: QrCardBlueprintProps): React.ReactElement {
  const ctx = useHausUi();
  const node = QR_BLUEPRINT.build(props, ctx.theme);
  return ctx.domRenderer.render(node, ctx);
}
