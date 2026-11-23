/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type LiquidGlassRecipeName =
  | 'dock'
  | 'toolbar'
  | 'sidebar'
  | 'hud'
  | 'menu'
  | 'dockTooltip'
  | 'altTab'
  | 'appIcons'
  | 'notification';

export interface RgbaUnitColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Haus Liquid Glass optical material recipe schema.
 */
export interface LiquidGlassRecipe {
  readonly blurRadius: number;
  readonly minBlurRadius?: number;
  readonly maxBlurRadius?: number;
  readonly saturation: number;
  readonly edgeWidth: number;
  readonly refractionStrength: number;
  readonly dispersion: number;
  readonly specularDial: number;
  readonly nativeRim?: boolean;
  readonly edgeGlowSpread?: number;
  readonly specularSoftness?: number;
  readonly edgeHighlight: number;
  readonly darkenedEdge: number;
  readonly ior: number;
  readonly frostAmount?: number;
  readonly sliderMode?: number;
  readonly minTintOpacity?: number;
  readonly maxTintOpacity?: number;
  readonly tintLight: RgbaUnitColor;
  readonly tintDark: RgbaUnitColor;
  readonly profile: 'pill' | 'dome';
  readonly cornerRadius?: number;
  readonly shapeExponent?: number;
}

const POPUP_GLASS: LiquidGlassRecipe = Object.freeze({
  blurRadius: 60,
  maxBlurRadius: 60,
  saturation: 1.9,
  edgeWidth: 12,
  refractionStrength: 0.08,
  dispersion: 0.01,
  specularDial: 0.1,
  edgeGlowSpread: 2.1,
  specularSoftness: 0.85,
  edgeHighlight: 0.14,
  darkenedEdge: 0.05,
  ior: 1.5,
  frostAmount: 1.0,
  sliderMode: 1.0,
  minTintOpacity: 0.25,
  maxTintOpacity: 0.55,
  tintLight: { r: 0.96, g: 0.96, b: 0.98, a: 0.45 },
  tintDark: { r: 0.14, g: 0.14, b: 0.16, a: 0.55 },
  profile: 'pill',
});

const DOCK_GLASS: LiquidGlassRecipe = Object.freeze({
  nativeRim: true,
  minBlurRadius: 2.8,
  blurRadius: 26.0,
  maxBlurRadius: 64.0,
  saturation: 1.25,
  edgeWidth: 13.28,
  refractionStrength: 0.85,
  dispersion: 0.025,
  specularDial: 0.65,
  edgeHighlight: 0.35,
  darkenedEdge: 0.0,
  ior: 1.5,
  frostAmount: 1.0,
  sliderMode: 0.5,
  minTintOpacity: 0.28,
  maxTintOpacity: 0.5,
  tintLight: { r: 0.98, g: 0.98, b: 1.0, a: 0.25 },
  tintDark: { r: 0.1, g: 0.1, b: 0.12, a: 0.28 },
  profile: 'pill',
  shapeExponent: 3.2,
});

/**
 * Built-in Haus Liquid Glass optical material presets.
 */
export const LIQUID_GLASS_RECIPES: Readonly<Record<LiquidGlassRecipeName, LiquidGlassRecipe>> =
  Object.freeze({
    sidebar: {
      blurRadius: 30,
      saturation: 1.85,
      edgeWidth: 14,
      refractionStrength: 0.5,
      dispersion: 0.15,
      specularDial: 0.6,
      edgeHighlight: 0.35,
      darkenedEdge: 0.06,
      ior: 1.5,
      tintLight: { r: 0.94, g: 0.94, b: 0.96, a: 0.62 },
      tintDark: { r: 0.14, g: 0.14, b: 0.16, a: 0.58 },
      profile: 'pill',
    },
    toolbar: {
      blurRadius: 20,
      saturation: 1.5,
      edgeWidth: 10,
      refractionStrength: 0.35,
      dispersion: 0.1,
      specularDial: 0.5,
      edgeHighlight: 0.3,
      darkenedEdge: 0.04,
      ior: 1.5,
      tintLight: { r: 0.96, g: 0.96, b: 0.97, a: 0.55 },
      tintDark: { r: 0.16, g: 0.16, b: 0.18, a: 0.5 },
      profile: 'pill',
    },
    hud: {
      blurRadius: 16,
      saturation: 2.1,
      edgeWidth: 16,
      refractionStrength: 0.7,
      dispersion: 0.25,
      specularDial: 0.8,
      edgeHighlight: 0.45,
      darkenedEdge: 0.08,
      ior: 1.5,
      tintLight: { r: 0.92, g: 0.92, b: 0.94, a: 0.5 },
      tintDark: { r: 0.12, g: 0.12, b: 0.14, a: 0.55 },
      profile: 'pill',
    },
    menu: { ...POPUP_GLASS },
    dock: { ...DOCK_GLASS },
    dockTooltip: {
      ...POPUP_GLASS,
      minBlurRadius: 2.2,
      blurRadius: 8.0,
      maxBlurRadius: 40.0,
      edgeWidth: 13.28,
      refractionStrength: 0.85,
      saturation: 1.25,
      edgeGlowSpread: 1.5,
      specularSoftness: 0.75,
      darkenedEdge: 0.0,
      frostAmount: 1.0,
      sliderMode: 0.25,
      minTintOpacity: 0.1,
      maxTintOpacity: 0.24,
      tintLight: { r: 0.98, g: 0.98, b: 1.0, a: 0.12 },
      tintDark: { r: 0.1, g: 0.1, b: 0.12, a: 0.18 },
    },
    altTab: { ...DOCK_GLASS, cornerRadius: 24 },
    appIcons: {
      nativeRim: true,
      blurRadius: 1.0,
      maxBlurRadius: 2.0,
      saturation: 1.25,
      edgeWidth: 9.6,
      refractionStrength: 0.95,
      dispersion: 0.01,
      specularDial: 0.65,
      edgeHighlight: 0.35,
      darkenedEdge: 0.0,
      ior: 1.5,
      frostAmount: 0.1,
      sliderMode: 0.5,
      maxTintOpacity: 0.1,
      tintLight: { r: 1.0, g: 1.0, b: 1.0, a: 0.0 },
      tintDark: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
      profile: 'pill',
    },
    notification: {
      blurRadius: 18,
      saturation: 2.0,
      edgeWidth: 14,
      refractionStrength: 0.45,
      dispersion: 0.15,
      specularDial: 0.65,
      edgeHighlight: 0.4,
      darkenedEdge: 0.06,
      ior: 1.5,
      tintLight: { r: 0.94, g: 0.94, b: 0.95, a: 0.55 },
      tintDark: { r: 0.14, g: 0.14, b: 0.15, a: 0.52 },
      profile: 'pill',
    },
  });

/** User-configurable Haus Liquid Glass optical parameters. */
export interface LiquidGlassSettings {
  readonly enabled: boolean;
  readonly recipe: LiquidGlassRecipeName;
  /** Blur strength slider (`0` = Low/Clear .. `1` = Frosted, default `0.5`). */
  readonly sliderMode: number;
  /** Convex bevel Snell's law refraction dial (`0` .. `1`, default `0.85`). */
  readonly refractionStrength: number;
  /** Perimeter bevel width in pt (`4` .. `28`, default `13.28`). */
  readonly edgeWidth: number;
  /** Chromatic aberration on prism bevel (`0` .. `0.35`, default `0.025`). */
  readonly dispersion: number;
  /** Rec. 709 backdrop saturation multiplier (`0.5` .. `2.2`, default `1.25`). */
  readonly saturation: number;
  /** Specular highlight dial (`0` .. `1`, default `0.65`). */
  readonly specularDial: number;
  /** Fresnel rim highlight intensity (`0` .. `1`, default `0.35`). */
  readonly edgeHighlight: number;
  /** Edge darkening factor (`0` .. `0.15`, default `0.0`). */
  readonly darkenedEdge: number;
  /** Physical glass Index of Refraction (`1.1` .. `2.0`, default `1.5`). */
  readonly ior: number;
  /** Analytical dual-band key/fill & diffuse rim lighting (`true` by default). */
  readonly nativeRim: boolean;
}

export const DEFAULT_LIQUID_GLASS_SETTINGS: LiquidGlassSettings = Object.freeze({
  enabled: true,
  recipe: 'dock',
  sliderMode: 0.5,
  refractionStrength: 0.85,
  edgeWidth: 13.28,
  dispersion: 0.025,
  saturation: 1.25,
  specularDial: 0.65,
  edgeHighlight: 0.35,
  darkenedEdge: 0.0,
  ior: 1.5,
  nativeRim: true,
});

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
}

export function sanitizeLiquidGlassSettings(input: unknown): LiquidGlassSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_LIQUID_GLASS_SETTINGS;
  }
  const raw = input as Record<string, unknown>;
  const recipeKey =
    typeof raw.recipe === 'string' && raw.recipe in LIQUID_GLASS_RECIPES
      ? (raw.recipe as LiquidGlassRecipeName)
      : DEFAULT_LIQUID_GLASS_SETTINGS.recipe;
  const preset = LIQUID_GLASS_RECIPES[recipeKey];

  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    recipe: recipeKey,
    sliderMode: clampNum(raw.sliderMode, 0, 1, preset.sliderMode ?? 0.5),
    refractionStrength: clampNum(raw.refractionStrength, 0, 1, preset.refractionStrength),
    edgeWidth: clampNum(raw.edgeWidth, 4, 28, preset.edgeWidth),
    dispersion: clampNum(raw.dispersion, 0, 0.35, preset.dispersion),
    saturation: clampNum(raw.saturation, 0.5, 2.2, preset.saturation),
    specularDial: clampNum(raw.specularDial, 0, 1, preset.specularDial),
    edgeHighlight: clampNum(raw.edgeHighlight, 0, 1, preset.edgeHighlight),
    darkenedEdge: clampNum(raw.darkenedEdge, 0, 0.15, preset.darkenedEdge),
    ior: clampNum(raw.ior, 1.1, 2.0, preset.ior),
    nativeRim:
      typeof raw.nativeRim === 'boolean' ? raw.nativeRim : Boolean(preset.nativeRim ?? true),
  };
}

/** Evaluates backdrop blur radius and frost amount from the `0..1` Blur strength slider. */
export function glassMaterialControls(
  recipe: LiquidGlassRecipe,
  value?: number,
): { readonly amount: number; readonly blurRadius: number; readonly frostAmount: number } {
  const amount = Math.max(
    0,
    Math.min(1, Number.isFinite(value) ? (value as number) : (recipe.sliderMode ?? 0.5)),
  );
  const minBlur = recipe.minBlurRadius ?? 2.8;
  const maxBlur = recipe.maxBlurRadius ?? 64.0;
  const blurRadius = minBlur + (maxBlur - minBlur) * Math.pow(amount, 1.3);
  return { amount, blurRadius, frostAmount: 1.0 };
}

/** Resolves shader uniforms from a `LiquidGlassSettings` profile and theme state. */
export function uniformsFromLiquidGlassSettings(
  settings: LiquidGlassSettings,
  scaleFactor: number,
  isDark: boolean,
  cornerRadiusPx = 32,
): Readonly<Record<string, number>> {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const recipe = LIQUID_GLASS_RECIPES[settings.recipe] ?? LIQUID_GLASS_RECIPES.dock;
  const tint = isDark ? recipe.tintDark : recipe.tintLight;
  const material = glassMaterialControls(recipe, settings.sliderMode);
  const minTint = recipe.minTintOpacity ?? tint.a ?? (isDark ? 0.28 : 0.25);
  const maxTint = recipe.maxTintOpacity ?? Math.min(isDark ? 0.55 : 0.5, minTint * 1.8);
  const tintA = minTint + (maxTint - minTint) * Math.pow(material.amount, 1.3);

  return {
    u_corner_radius: cornerRadiusPx * scale,
    u_shape_mode: 0,
    u_tip_height: 0,
    u_tip_width: 0,
    u_shape_exponent: recipe.shapeExponent ?? 3.2,
    u_native_rim: settings.nativeRim ? 1 : 0,
    u_scale: scale,
    u_ior: settings.ior,
    u_bevel_width: settings.edgeWidth * scale,
    u_refraction_dial: settings.refractionStrength,
    u_dispersion: settings.dispersion,
    u_saturation: settings.saturation,
    u_edge_highlight: settings.edgeHighlight,
    u_specular_dial: settings.specularDial,
    u_edge_glow_spread: recipe.edgeGlowSpread ?? 1,
    u_specular_softness: recipe.specularSoftness ?? 0,
    u_darkened_edge: settings.darkenedEdge,
    u_slider_mode: material.amount,
    u_blur_radius: material.blurRadius,
    u_frost_amount: 1.0,
    u_tint_r: tint.r,
    u_tint_g: tint.g,
    u_tint_b: tint.b,
    u_tint_a: tintA,
    u_opacity: 1.0,
    u_is_dark: isDark ? 1.0 : 0.0,
  };
}

/** Analytical continuous-corner supercircle SDF (`hausGlassShape`). */
export function evaluateHausGlassShape(
  px: number,
  py: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
): { readonly distance: number; readonly normalX: number; readonly normalY: number } {
  const r = Math.max(Math.min(Math.abs(radius), Math.min(halfWidth, halfHeight)), 0.0001);
  const extent = r * 1.5286649465560913;
  const blendX = Math.max(0, Math.min(1, (halfWidth / r - 1.52866) / -0.52866));
  const blendY = Math.max(0, Math.min(1, (halfHeight / r - 1.52866) / -0.52866));
  const normalExtent = extent + (r - extent) * Math.max(blendX, blendY);

  const absX = Math.abs(px);
  const absY = Math.abs(py);
  const cornerX = absX - halfWidth + normalExtent;
  const cornerY = absY - halfHeight + normalExtent;

  const qx = Math.max((absX - halfWidth + extent) / extent, 0.0);
  const qy = Math.max((absY - halfHeight + extent) / extent, 0.0);
  const major = Math.max(qx, qy);
  const minor = Math.min(qx, qy);
  const t = major > 0.0 ? Math.max(0, Math.min(1, minor / major)) : 0.0;
  const polynomial =
    (((3.1560099124908447 - t * 0.9260540008544922) * t - 3.6412200927734375) * t +
      1.268030047416687) *
      t +
    0.2685309946537018;
  const magnitude = Math.hypot(qx, qy);
  const continuous =
    magnitude + 1.0 - 1.0 / (1.0 - t * t * Math.max(0, Math.min(1, magnitude)) * polynomial);
  const cx = Math.max(qx * 1.5286649465560913 - 0.5286650061607361, 0.0);
  const cy = Math.max(qy * 1.5286649465560913 - 0.5286650061607361, 0.0);
  const circular = Math.hypot(cx, cy) * 0.6541655659675598 + 0.3458344340324402;
  const orientation = qy > qx ? 1.0 : -1.0;
  const weight = Math.max(0, Math.min(1, 0.5 - orientation + orientation * t));
  const distX = continuous + (circular - continuous) * blendX;
  const distY = continuous + (circular - continuous) * blendY;
  const distance =
    (distX + (distY - distX) * weight - 1.0) * extent + Math.min(Math.max(cornerX, cornerY), 0.0);

  const nxRaw = Math.max(cornerX, 0.0);
  const nyRaw = Math.max(cornerY, 0.0);
  const nLen = Math.hypot(nxRaw, nyRaw);
  const signX = px < 0 ? -1 : 1;
  const signY = py < 0 ? -1 : 1;
  const normalX = (nLen > 0.0 ? nxRaw / nLen : cornerX > cornerY ? 1.0 : 0.0) * signX;
  const normalY = (nLen > 0.0 ? nyRaw / nLen : cornerX > cornerY ? 0.0 : 1.0) * signY;
  return { distance, normalX, normalY };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.00001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const displacementCache = new Map<
  string,
  { readonly dataUrl: string; readonly maxScalePx: number }
>();

/**
 * Generates an `<feImage>` displacement map PNG implementing Snell's law convex bevel lens refraction:
 * - `inside >= zR` (flat interior of the platter): `dispEdge === 0` (`R=128, G=128` -> zero distortion)
 * - `0 <= inside < zR` (perimeter bevel): `snellDev = tan(asin(0.98*u) - asin(0.98*u/ior)) * 1.29253`
 */
export function buildLiquidGlassDisplacementMap(options: {
  readonly width: number;
  readonly height: number;
  readonly cornerRadius: number;
  readonly settings: LiquidGlassSettings;
}): { readonly dataUrl: string; readonly maxScalePx: number } | null {
  if (typeof document === 'undefined') return null;
  const w = Math.max(32, Math.min(1600, Math.round(options.width)));
  const h = Math.max(24, Math.min(480, Math.round(options.height)));
  const r = Math.max(4, Math.min(Math.min(w, h) * 0.5, options.cornerRadius));
  const { edgeWidth, refractionStrength, ior } = options.settings;
  const zR = Math.max(edgeWidth, 4.0);
  const maxScalePx = Number((Math.min(zR * 1.25, 20.0) * refractionStrength * 1.35).toFixed(2));

  const key = `${w}x${h}:r${r.toFixed(1)}:z${zR.toFixed(2)}:s${refractionStrength.toFixed(2)}:ior${ior.toFixed(2)}`;
  const cached = displacementCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const halfW = w * 0.5;
  const halfH = h * 0.5;

  for (let y = 0; y < h; y += 1) {
    const py = y + 0.5 - halfH;
    const normPy = Math.max(-1, Math.min(1, py / Math.max(halfH, 1)));
    for (let x = 0; x < w; x += 1) {
      const px = x + 0.5 - halfW;
      const idx = (y * w + x) * 4;
      const shape = evaluateHausGlassShape(px, py, halfW, halfH, r);
      const inside = -shape.distance;

      if (inside >= zR || inside < -1.5 || maxScalePx <= 0.01) {
        data[idx] = 128;
        data[idx + 1] = 128;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
        continue;
      }

      const normPx = Math.max(-1, Math.min(1, px / Math.max(halfW, 1)));
      const cornerLen = Math.hypot(normPx, normPy) || 1;
      const nOutRawX = shape.normalX * 0.85 + (normPx / cornerLen) * 0.15;
      const nOutRawY = shape.normalY * 0.85 + (normPy / cornerLen) * 0.15;
      const nOutLen = Math.hypot(nOutRawX, nOutRawY) || 1;
      const nOutX = nOutRawX / nOutLen;
      const nOutY = nOutRawY / nOutLen;

      const u = Math.max(0, Math.min(1, 1.0 - inside / zR));
      const sinI = u * 0.98;
      const snellDev = Math.tan(Math.asin(sinI) - Math.asin(sinI / Math.max(1.05, ior))) * 1.29253;
      const innerFade = smoothstep(0.0, 1.5, zR - inside);
      const outerMask = inside < 0 ? smoothstep(-1.5, 0.0, inside) : 1.0;
      const dispEdge = Math.min(1.0, snellDev * innerFade * outerMask);

      data[idx] = Math.max(0, Math.min(255, Math.round(128 + -nOutX * dispEdge * 127)));
      data[idx + 1] = Math.max(0, Math.min(255, Math.round(128 + -nOutY * dispEdge * 127)));
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const result = { dataUrl: canvas.toDataURL('image/png'), maxScalePx };
  if (displacementCache.size > 24) {
    const oldest = displacementCache.keys().next().value;
    if (oldest) displacementCache.delete(oldest);
  }
  displacementCache.set(key, result);
  return result;
}
