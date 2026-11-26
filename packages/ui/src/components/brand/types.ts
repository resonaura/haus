/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { DeviceCategory } from '../../categories/index.js';

export type {
  BrandIconHint,
  BrandIconKind,
  BrandIconPort,
  BrandIconTileResult,
  BrandIconTileStyleRequest,
  RenderedBrandTile,
} from '../../primitives/brand-port.js';

/**
 * Platform-neutral device descriptor used by `@haus/ui` to resolve custom brand
 * silhouettes (Apple TV, HomePod, Nest, Samsung TV, Fire TV, eero), specialty
 * appliance glyphs (scale, kettle, window), and Lucide fallbacks identically
 * across Electron, GPUIX, and mobile.
 */
export interface DeviceBrandIconInput {
  readonly name: string;
  readonly primaryEntityId?: string;
  readonly category?: DeviceCategory | string;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly deviceType?: string;
  readonly deviceClass?: string;
  readonly powerStrip?: boolean;
  readonly buttonController?: boolean;
  readonly physicalHub?: boolean;
  readonly securityIconKey?: string;
  readonly isScale?: boolean;
  readonly isKettle?: boolean;
}

export interface DeviceBrandArtwork {
  readonly id:
    | 'apple-tv'
    | 'homepod'
    | 'homepod-mini'
    | 'nest-hub'
    | 'nest-mini'
    | 'nest-audio'
    | 'google'
    | 'firetv'
    | 'samsung-tv'
    | 'eero';
  readonly svg: string;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly aspectRatio: number;
}
