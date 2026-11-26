/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { IconAppearance, ResolvedIconStyle, ResolvedIconVariation } from '@haus/icons';

export type BrandIconKind =
  'integration' | 'addon' | 'app' | 'hacs' | 'homebridge' | 'scrypted' | 'plugin';

export interface BrandIconHint {
  readonly name?: string;
  readonly supportedBy?: string;
  readonly repositoryUrl?: string;
  readonly repository?: string;
  readonly category?: string;
  readonly addonSlug?: string;
  readonly addonConfigPath?: string;
}

export interface BrandIconTileStyleRequest {
  readonly appearance: IconAppearance;
  readonly variation: ResolvedIconVariation;
  readonly tintHex: string;
  readonly size: number;
}

export interface BrandIconTileResult {
  readonly dataUri?: string | null;
  readonly rendered?: boolean;
  readonly layout?: 'fill' | 'inset';
  readonly revision?: string;
}

export interface RenderedBrandTile {
  readonly dataUrl: string;
  readonly layout: 'fill' | 'inset';
  /** Symmetrical per-side canvas bleed fraction when an outer alpha drop-shadow is composited into `dataUrl`. */
  readonly shadowBleedFraction?: number;
}

export interface DecoratedBrandTile {
  readonly dataUrl: string;
  readonly bleedFraction: number;
}

/**
 * Platform-neutral host port for resolving and locally rasterizing integration,
 * app, add-on, and plugin brand icon tiles across Electron, GPUIX, and mobile.
 */
export interface BrandIconPort {
  /** Fast path: server/Hub-rendered or `@haus/icons/node` `IconRenderService`-rendered enclosure tile. */
  resolveTile?(
    kind: BrandIconKind,
    id: string,
    style: BrandIconTileStyleRequest,
    hint?: BrandIconHint,
  ): Promise<BrandIconTileResult | null>;
  /** Raw source logo URI (PNG/SVG/JPEG) from Hub, Home Assistant, or brand catalog. */
  resolveSource?(
    kind: BrandIconKind,
    id: string,
    dark: boolean,
    hint?: BrandIconHint,
  ): Promise<string | null>;
  /** Local tile rasterizer backed by `@haus/icons` enclosure SDF, contour lighting & glass rim. */
  renderLocalTile?(
    rawSource: string,
    style: ResolvedIconStyle,
    size: number,
  ): Promise<RenderedBrandTile | null>;
  /**
   * Optional host drop-shadow compositor for renderers without CSS `filter: drop-shadow(...)`
   * (e.g. GPUIX). Returns a symmetrically bleed-padded data URL so the continuous-supercircle
   * shadow matches Electron's `.brand-icon-tile` drop-shadow without clipping.
   */
  applyTileShadow?(
    dataUrl: string,
    size: number,
    dark: boolean,
  ): Promise<DecoratedBrandTile | null>;
  /** Optional explicit icon style (defaults to `default` matching active theme mode). */
  readonly iconStyle?: ResolvedIconStyle;
  /** Optional subscription invoked when server icon cache revision changes. */
  subscribeInvalidation?(listener: (revision?: string) => void): () => void;
}
