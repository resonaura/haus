/* @jsxImportSource @gpuix/react */
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { HostProgressiveBlurProps } from '../renderers/host.js';
import type { RenderContext } from '../renderers/contract.js';
import { COMPILED_PROGRESSIVE_BLUR_WGSL } from '../generated/compiled-shaders.js';
import { styleFor } from './style.js';

export function renderProgressiveBlur(
  { maxRadius, start, edge = 'bottom', style }: HostProgressiveBlurProps,
  context: RenderContext,
) {
  return (
    <div
      style={{
        ...styleFor(style, context),
        pointerEvents: 'none',
        shader: {
          label: 'haus.progressive-blur.v1',
          wgsl: COMPILED_PROGRESSIVE_BLUR_WGSL,
          samplesBackdrop: true,
          backdropBlurRadius: maxRadius,
          params: [start, edge === 'top' ? 1 : 0],
        },
      }}
    />
  );
}
