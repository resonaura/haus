/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  BackdropMaterial,
  BadgeBlueprint,
  ButtonBlueprint,
  colorToken,
  COMPILED_HEROUI_RECIPES,
  corners,
  createDefaultShaderRegistry,
  createHausUiTheme,
  DEFAULT_VIEWPORT,
  GlassSurfaceBlueprint,
  HeroUiSourceCompiler,
  insets,
  LiquidGlassMaterial,
  ModalBlueprint,
  NativeSceneGraphRenderer,
  px,
  QrCardBlueprint,
  ReactDomRenderer,
  ReactNativeRenderer,
  rgba,
  ShaderMaterial,
  SplitPaneBlueprint,
  TailwindAstCompiler,
  UpdateCardBlueprint,
  type RenderContext,
  type ShaderPassDescriptor,
} from '../src/index.js';

function createContext(overrides?: Partial<RenderContext['viewport']>): RenderContext {
  return {
    theme: createHausUiTheme('dark'),
    viewport: {
      ...DEFAULT_VIEWPORT,
      ...overrides,
    },
    shaderRegistry: createDefaultShaderRegistry(),
  };
}

describe('@haus/ui cross-renderer OOP UI system', () => {
  it('compiles Tailwind + HeroUI utilities into renderer-agnostic UiStyleSpec IR', () => {
    const tw = new TailwindAstCompiler();
    const spec = tw.compileClassList(
      'flex flex-col gap-4 p-6 rounded-2xl backdrop-blur-xl border hover:opacity-90 disabled:opacity-50 md:flex-row lg:grid-cols-2',
    );

    expect(spec.layout?.display).toBe('flex');
    expect(spec.layout?.direction).toBe('column');
    expect(spec.layout?.gap).toEqual(px(16));
    expect(spec.layout?.padding).toEqual(insets(24));
    expect(spec.corners?.topLeft).toBe(22);
    expect(spec.corners?.shape).toBe('superellipse');
    expect(spec.material?.kind).toBe('backdrop');
    expect(spec.states?.hover?.opacity).toBeCloseTo(0.9);
    expect(spec.states?.disabled?.opacity).toBeCloseTo(0.5);
    expect(spec.responsive?.md?.layout?.direction).toBe('row');
    expect(spec.responsive?.lg?.layout?.gridColumns).toBe(2);
  });

  it('compiles HeroUI CSS @apply rules and tailwind-variants tv() sources via HeroUiSourceCompiler', () => {
    const compiler = new HeroUiSourceCompiler();
    const blocks = compiler.compileComponentCss(
      '.card { @apply flex flex-col gap-3 p-4 rounded-xl border backdrop-blur-md; --card-radius: 16px; }',
    );
    const cardBlock = blocks.get('.card');
    expect(cardBlock).toBeDefined();
    expect(cardBlock?.compiledStyle.layout?.display).toBe('flex');
    expect(cardBlock?.compiledStyle.material?.kind).toBe('backdrop');

    const tvParsed = compiler.parseTvStylesFile(
      'hero-btn',
      `const button = tv({
        base: "inline-flex items-center justify-center rounded-xl px-4 py-2 font-semibold",
        slots: { icon: "w-4 h-4" }
      });`,
    );
    expect(tvParsed.componentName).toBe('hero-btn');
    expect(tvParsed.baseClass).toContain('inline-flex');
    expect(tvParsed.slots.icon).toBe('w-4 h-4');
    expect(COMPILED_HEROUI_RECIPES.length).toBeGreaterThanOrEqual(6);
  });

  it('supports LiquidGlassMaterial and custom background shaders across React DOM, React Native, and Rust/C++ Native IR', () => {
    const ctx = createContext({ width: 1440, height: 900 });
    const glassBlueprint = new GlassSurfaceBlueprint();
    const buttonBlueprint = new ButtonBlueprint();

    const customShader: ShaderPassDescriptor = {
      id: 'haus.aurora-glass.v1',
      stage: 'backdrop',
      samplesBackdrop: true,
      uniforms: {
        intensity: { type: 'f32', value: 0.75 },
        tint: { type: 'color', value: rgba(56, 189, 248, 0.35) },
      },
      targets: {
        wgsl: '@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(0.2, 0.7, 1.0, 0.35); }',
        glsl: 'void main() { fragColor = vec4(0.2, 0.7, 1.0, 0.35); }',
      },
    };
    ctx.shaderRegistry.register(customShader);

    const tree = glassBlueprint.build(
      {
        id: 'eero-glass-panel',
        variant: 'liquid-glass',
        blurPx: 24,
        refractionStrength: 18,
        chromaticDispersion: 0.8,
        children: [
          glassBlueprint.build(
            {
              id: 'custom-aurora-header',
              variant: 'custom-shader',
              customShader,
              children: [
                buttonBlueprint.build(
                  {
                    id: 'install-fw-btn',
                    label: 'Install v7.18.0',
                    variant: 'primary',
                    size: 'md',
                  },
                  ctx.theme,
                ),
              ],
            },
            ctx.theme,
          ),
        ],
      },
      ctx.theme,
    );

    // 1. React DOM Renderer
    const domRenderer = new ReactDomRenderer();
    const domElement = domRenderer.render(tree, ctx);
    expect(domElement.props['data-haus-shader']).toBe('haus.liquid-glass.v1');
    expect(domElement.props.style.backdropFilter).toContain('blur(24px)');
    expect(domElement.props.style['--haus-corner-exponent']).toBe('1.4');

    // Reduced transparency fallback disables backdropFilter cleanly
    const reducedCtx = createContext({ reducedTransparency: true });
    const reducedDom = domRenderer.render(tree, reducedCtx);
    expect(reducedDom.props.style.backdropFilter).toBeUndefined();

    // 2. React Native Renderer
    const rnRenderer = new ReactNativeRenderer();
    const rnTree = rnRenderer.render(tree, ctx);
    expect(rnTree.component).toBe('ShaderSurfaceView');
    expect(rnTree.style.borderCurve).toBe('continuous');
    expect(rnTree.shaderPass?.id).toBe('haus.liquid-glass.v1');
    expect(rnTree.backdropEffect?.blurRadius).toBe(24);
    const childShaderView = rnTree.children[0];
    expect(typeof childShaderView).toBe('object');
    if (typeof childShaderView === 'object') {
      expect(childShaderView.shaderPass?.id).toBe('haus.aurora-glass.v1');
    }

    // 3. Rust wgpu/Taffy & C++ Skia/Yoga Native Scene Graph IR
    const nativeRenderer = new NativeSceneGraphRenderer();
    const ir = nativeRenderer.render(tree, ctx);
    expect(ir.schema).toBe('haus.ui.ir/v1');
    expect(ir.nodes.length).toBe(3);
    expect(ir.shaders.length).toBe(2);
    expect(ir.shaders[0]?.shaderId).toBe('haus.liquid-glass.v1');
    expect(ir.shaders[0]?.wgslSource).toContain('superellipse_sdf');
    expect(ir.shaders[0]?.glslSource).toContain('superellipseSdf');
    expect(ir.shaders[1]?.shaderId).toBe('haus.aurora-glass.v1');

    const rootNode = ir.nodes[0];
    expect(rootNode?.paint.fillKind).toBe('shader');
    expect(rootNode?.paint.corners.superellipseExponent).toBe(1.4);
    expect(rootNode?.paint.backdrop?.blurRadiusPx).toBe(24);
    expect(rootNode?.paint.rimLight?.preset).toBe('card');
  });

  it('adapts ModalBlueprint, SplitPaneBlueprint, UpdateCardBlueprint, and QrCardBlueprint across screen sizes', () => {
    const modal = new ModalBlueprint();
    const split = new SplitPaneBlueprint();
    const updateCard = new UpdateCardBlueprint();
    const qrCard = new QrCardBlueprint();
    const badge = new BadgeBlueprint();

    const narrowCtx = createContext({ width: 620, height: 800 });
    const wideCtx = createContext({ width: 1600, height: 1000 });

    const panes = [
      updateCard.build(
        {
          title: 'Narnia eero 6 Firmware',
          installedVersion: 'v7.17.4',
          latestVersion: 'v7.18.0',
          updateAvailable: true,
          releaseSummary: 'Stability and Thread border router improvements.',
          canInstall: true,
          canSkip: true,
        },
        wideCtx.theme,
        wideCtx.viewport,
      ),
      qrCard.build(
        {
          title: 'Crawford Primary Wi-Fi',
          ssid: 'Crawford',
          isGuest: false,
          imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
        },
        wideCtx.theme,
      ),
      badge.build({ label: 'Online', tone: 'success' }, wideCtx.theme),
    ];

    const narrowSplit = split.build(
      { columns: 'adaptive', minColumnWidthPx: 340, children: panes },
      narrowCtx.theme,
      narrowCtx.viewport,
    );
    const wideSplit = split.build(
      { columns: 'adaptive', minColumnWidthPx: 340, children: panes },
      wideCtx.theme,
      wideCtx.viewport,
    );

    expect(narrowSplit.style.layout?.gridColumns).toBe(1);
    expect(wideSplit.style.layout?.gridColumns).toBe(3);

    const narrowModal = modal.build(
      { title: 'Crawford Network', size: 'adaptive', richContentCount: 4, children: [narrowSplit] },
      narrowCtx.theme,
      narrowCtx.viewport,
    );
    const wideModal = modal.build(
      { title: 'Crawford Network', size: 'adaptive', richContentCount: 4, children: [wideSplit] },
      wideCtx.theme,
      wideCtx.viewport,
    );

    const nativeRenderer = new NativeSceneGraphRenderer();
    const narrowIR = nativeRenderer.render(narrowModal, narrowCtx);
    const wideIR = nativeRenderer.render(wideModal, wideCtx);

    const narrowW = narrowIR.nodes[0]?.layout.width.value ?? 0;
    const wideW = wideIR.nodes[0]?.layout.width.value ?? 0;
    expect(wideW).toBeGreaterThan(narrowW);

    // Ensure BackdropMaterial and ShaderMaterial serialize deterministically
    const backdropMat = new BackdropMaterial({
      blurRadius: 16,
      tintColor: colorToken('materialTop'),
    });
    const shaderMat = new ShaderMaterial(new LiquidGlassMaterial().toIR().passes, {
      backdrop: backdropMat.backdrop,
    });
    expect(backdropMat.toIR().kind).toBe('backdrop');
    expect(shaderMat.toIR().kind).toBe('shader');
  });
});
