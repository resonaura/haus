/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  COMPILED_LIQUID_GLASS_GLSL,
  COMPILED_LIQUID_GLASS_WGSL,
} from '../generated/compiled-shaders.js';
import { colorToken, type ColorValue } from './geometry.js';

export type BlurQuality = 'low' | 'medium' | 'high';
export type VibrancyStyle = 'none' | 'ultra-thin' | 'thin' | 'regular' | 'thick' | 'chrome';
export type RimLightingPreset =
  'panel' | 'dock' | 'pill' | 'card' | 'medium' | 'control' | 'circle';
export type ShaderStage = 'backdrop' | 'surface' | 'overlay';

export interface BlurEffect {
  readonly radius: number;
  readonly quality?: BlurQuality;
}

export interface BackdropEffect {
  readonly blurRadius: number;
  readonly saturation?: number;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly vibrancy?: VibrancyStyle;
  readonly tintColor?: ColorValue;
  readonly tintOpacity?: number;
  readonly noiseOpacity?: number;
}

export interface RimLightingPass {
  readonly preset: RimLightingPreset;
  readonly specularIntensity: number;
  readonly diffuseDepth: number;
  readonly edgeDarkening: number;
  readonly cornerExponent: number;
}

export interface GradientStop {
  readonly offset: number;
  readonly color: ColorValue;
}

export interface RadialGradientGeometry {
  readonly centerX?: number;
  readonly centerY?: number;
  readonly radiusX?: number;
  readonly radiusY?: number;
  readonly shape?: 'ellipse' | 'circle';
}

export type ShaderUniformValue =
  | { readonly type: 'f32'; readonly value: number }
  | { readonly type: 'vec2'; readonly value: readonly [number, number] }
  | { readonly type: 'vec3'; readonly value: readonly [number, number, number] }
  | { readonly type: 'vec4'; readonly value: readonly [number, number, number, number] }
  | { readonly type: 'color'; readonly value: ColorValue }
  | {
      readonly type: 'builtin';
      readonly source: 'time' | 'resolution' | 'pointer' | 'cornerRadius' | 'dpr';
    };

export interface SvgRefractionFallback {
  readonly kind: 'liquid-glass-displacement';
  readonly blurRadius: number;
  readonly refractionStrength: number;
  readonly chromaticDispersion: number;
  readonly cornerExponent: number;
}

export interface ShaderBackendTargets {
  /** WGSL fragment shader for Rust `wgpu` renderer. */
  readonly wgsl?: string;
  /** GLSL ES 3.00 / SkSL fragment shader for WebGL / C++ Skia / OpenGL. */
  readonly glsl?: string;
  /** Procedural Chromium/Electron SVG backdrop displacement fallback. */
  readonly svgFilter?: SvgRefractionFallback;
}

/**
 * Cross-platform custom background/surface shader pass descriptor.
 * Allows any surface (modals, docks, hero cards, Liquid Glass backdrops) to declare
 * deterministic shader pipelines executable on Web, React Native/Skia, C++, and Rust wgpu.
 */
export interface ShaderPassDescriptor {
  readonly id: string;
  readonly stage: ShaderStage;
  readonly samplesBackdrop: boolean;
  readonly uniforms: Readonly<Record<string, ShaderUniformValue>>;
  readonly targets: ShaderBackendTargets;
  readonly fallbackBackdrop?: BackdropEffect;
}

export interface SolidMaterialIR {
  readonly kind: 'solid';
  readonly color: ColorValue;
  readonly blur?: BlurEffect;
}

export interface GradientMaterialIR {
  readonly kind: 'gradient';
  readonly gradientType: 'linear' | 'radial';
  readonly angleDeg: number;
  readonly stops: readonly GradientStop[];
  readonly blur?: BlurEffect;
  readonly radial?: RadialGradientGeometry;
}

export interface BlurMaterialIR {
  readonly kind: 'blur';
  readonly blur: BlurEffect;
  readonly tint?: ColorValue;
  readonly opacity?: number;
}

export interface BackdropMaterialIR {
  readonly kind: 'backdrop';
  readonly backdrop: BackdropEffect;
  readonly rimLighting?: RimLightingPass;
  readonly fallbackColor: ColorValue;
}

export interface ShaderMaterialIR {
  readonly kind: 'shader';
  readonly passes: readonly ShaderPassDescriptor[];
  readonly backdrop?: BackdropEffect;
  readonly rimLighting?: RimLightingPass;
  readonly fallbackColor: ColorValue;
}

export type MaterialIR =
  SolidMaterialIR | GradientMaterialIR | BlurMaterialIR | BackdropMaterialIR | ShaderMaterialIR;

export interface SurfaceMaterial {
  readonly kind: MaterialIR['kind'];
  toIR(): MaterialIR;
}

export class SolidMaterial implements SurfaceMaterial {
  readonly kind = 'solid' as const;
  constructor(
    readonly color: ColorValue,
    readonly blur?: BlurEffect,
  ) {}

  withBlur(radius: number, quality: BlurQuality = 'medium'): SolidMaterial {
    return new SolidMaterial(this.color, { radius, quality });
  }

  toIR(): SolidMaterialIR {
    return {
      kind: 'solid',
      color: this.color,
      ...(this.blur ? { blur: this.blur } : {}),
    };
  }
}

export class GradientMaterial implements SurfaceMaterial {
  readonly kind = 'gradient' as const;
  constructor(
    readonly stops: readonly GradientStop[],
    readonly angleDeg = 155,
    readonly gradientType: 'linear' | 'radial' = 'linear',
    readonly blur?: BlurEffect,
    readonly radial?: RadialGradientGeometry,
  ) {}

  toIR(): GradientMaterialIR {
    return {
      kind: 'gradient',
      gradientType: this.gradientType,
      angleDeg: this.angleDeg,
      stops: this.stops,
      ...(this.blur ? { blur: this.blur } : {}),
      ...(this.radial ? { radial: this.radial } : {}),
    };
  }
}

export class BlurMaterial implements SurfaceMaterial {
  readonly kind = 'blur' as const;
  constructor(
    readonly blur: BlurEffect,
    readonly tint?: ColorValue,
    readonly opacity = 1,
  ) {}

  toIR(): BlurMaterialIR {
    return {
      kind: 'blur',
      blur: this.blur,
      ...(this.tint ? { tint: this.tint } : {}),
      opacity: this.opacity,
    };
  }
}

export class BackdropMaterial implements SurfaceMaterial {
  readonly kind = 'backdrop' as const;
  constructor(
    readonly backdrop: BackdropEffect,
    readonly options: {
      readonly rimLighting?: RimLightingPass;
      readonly fallbackColor?: ColorValue;
    } = {},
  ) {}

  withRimLighting(rimLighting: RimLightingPass): BackdropMaterial {
    return new BackdropMaterial(this.backdrop, { ...this.options, rimLighting });
  }

  toIR(): BackdropMaterialIR {
    return {
      kind: 'backdrop',
      backdrop: this.backdrop,
      ...(this.options.rimLighting ? { rimLighting: this.options.rimLighting } : {}),
      fallbackColor: this.options.fallbackColor ?? colorToken('card'),
    };
  }
}

export class ShaderMaterial implements SurfaceMaterial {
  readonly kind = 'shader' as const;
  constructor(
    readonly passes: readonly ShaderPassDescriptor[],
    readonly options: {
      readonly backdrop?: BackdropEffect;
      readonly rimLighting?: RimLightingPass;
      readonly fallbackColor?: ColorValue;
    } = {},
  ) {}

  withPass(pass: ShaderPassDescriptor): ShaderMaterial {
    return new ShaderMaterial([...this.passes, pass], this.options);
  }

  toIR(): ShaderMaterialIR {
    return {
      kind: 'shader',
      passes: this.passes,
      ...(this.options.backdrop ? { backdrop: this.options.backdrop } : {}),
      ...(this.options.rimLighting ? { rimLighting: this.options.rimLighting } : {}),
      fallbackColor: this.options.fallbackColor ?? colorToken('card'),
    };
  }
}

/** WGSL fragment shader for Rust `wgpu` compiled from `packages/ui/src/shaders/liquid-glass.wgsl`. */
export const LIQUID_GLASS_WGSL = COMPILED_LIQUID_GLASS_WGSL;

/** GLSL ES 3.00 fragment shader for WebGL / C++ OpenGL / Skia compiled from `packages/ui/src/shaders/liquid-glass.frag.glsl`. */
export const LIQUID_GLASS_GLSL = COMPILED_LIQUID_GLASS_GLSL;

export interface LiquidGlassOptions {
  readonly blurRadius?: number;
  readonly refractionStrength?: number;
  readonly chromaticDispersion?: number;
  readonly saturation?: number;
  readonly tintColor?: ColorValue;
  readonly tintOpacity?: number;
  /** Built-in rim lighting preset, or `'none'` when the surface mounts an explicit `<GlassRim />`. */
  readonly rimPreset?: RimLightingPreset | 'none';
  readonly cornerExponent?: number;
}

/** First-class Liquid Glass backdrop material compiling to SVG refraction, WebGL/GLSL, and Rust WGSL. */
export class LiquidGlassMaterial implements SurfaceMaterial {
  readonly kind = 'shader' as const;
  private readonly inner: ShaderMaterial;

  constructor(options: LiquidGlassOptions = {}) {
    const blurRadius = Math.max(0, Math.min(48, options.blurRadius ?? 18));
    const refractionStrength = Math.max(0, Math.min(40, options.refractionStrength ?? 16));
    const chromaticDispersion = Math.max(0, Math.min(2, options.chromaticDispersion ?? 0.65));
    const saturation = options.saturation ?? 1.35;
    const tintColor = options.tintColor ?? colorToken('materialTop');
    const tintOpacity = options.tintOpacity ?? 0.24;
    const cornerExponent = options.cornerExponent ?? 1.4;
    const rimPreset = options.rimPreset ?? 'panel';

    const backdrop: BackdropEffect = {
      blurRadius,
      saturation,
      vibrancy: 'regular',
      tintColor,
      tintOpacity,
    };

    const pass: ShaderPassDescriptor = {
      id: 'haus.liquid-glass.v1',
      stage: 'backdrop',
      samplesBackdrop: true,
      uniforms: {
        resolution: { type: 'builtin', source: 'resolution' },
        cornerRadius: { type: 'builtin', source: 'cornerRadius' },
        cornerExponent: { type: 'f32', value: cornerExponent },
        refractionStrength: { type: 'f32', value: refractionStrength },
        dispersion: { type: 'f32', value: chromaticDispersion },
        blurRadius: { type: 'f32', value: blurRadius },
        tintOpacity: { type: 'f32', value: tintOpacity },
        tintColor: { type: 'color', value: tintColor },
      },
      targets: {
        wgsl: LIQUID_GLASS_WGSL,
        glsl: LIQUID_GLASS_GLSL,
        svgFilter: {
          kind: 'liquid-glass-displacement',
          blurRadius,
          refractionStrength,
          chromaticDispersion,
          cornerExponent,
        },
      },
      fallbackBackdrop: backdrop,
    };

    this.inner = new ShaderMaterial([pass], {
      backdrop,
      ...(rimPreset === 'none'
        ? {}
        : {
            rimLighting: {
              preset: rimPreset,
              specularIntensity: 0.96,
              diffuseDepth: 8,
              edgeDarkening: 0.085,
              cornerExponent,
            },
          }),
      fallbackColor: colorToken('card'),
    });
  }

  toIR(): ShaderMaterialIR {
    return this.inner.toIR();
  }
}

/** Extensible OOP registry for custom background/surface shaders shared across render backends. */
export class ShaderRegistry {
  private readonly shaders = new Map<string, ShaderPassDescriptor>();

  constructor(initial: readonly ShaderPassDescriptor[] = []) {
    for (const shader of initial) this.register(shader);
  }

  register(shader: ShaderPassDescriptor): this {
    if (!shader.id.trim()) throw new Error('ShaderPassDescriptor requires a non-empty id.');
    this.shaders.set(shader.id, shader);
    return this;
  }

  get(id: string): ShaderPassDescriptor | undefined {
    return this.shaders.get(id);
  }

  has(id: string): boolean {
    return this.shaders.has(id);
  }

  list(): readonly ShaderPassDescriptor[] {
    return Array.from(this.shaders.values());
  }
}

export function createDefaultShaderRegistry(): ShaderRegistry {
  const liquid = new LiquidGlassMaterial().toIR();
  return new ShaderRegistry(liquid.passes);
}
