/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type * as React from 'react';
import { useHausUi } from './context.js';
import type { HostGlassRimProps } from '../renderers/host.js';

export type GlassRimProps = HostGlassRimProps;

/**
 * Shared analytical Liquid Glass rim lighting overlay (`CASDFKeyFillHighlightEffect`).
 * Renders the 9-slice + vibrancy mask on DOM/Electron and `glass-rim.wgsl` on GPUIX.
 */
export function GlassRim(props: GlassRimProps): React.ReactElement | null {
  const ctx = useHausUi();
  if (ctx.contentHost.renderGlassRim) {
    return ctx.contentHost.renderGlassRim(props, ctx);
  }
  return ctx.host.renderGlassRim ? ctx.host.renderGlassRim(props, ctx) : null;
}
