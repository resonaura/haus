/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { Box, useLiquidGlassSurface } from '@haus/ui';

/** Absolute, non-interactive backdrop. Mount first inside a positioned rounded panel. */
export function LiquidGlass({
  className = '',
  blur = 10,
  strength = 18,
  dispersion = 0.65,
}: {
  className?: string;
  blur?: number;
  strength?: number;
  dispersion?: number;
}) {
  const { ref, filterSvg, style } = useLiquidGlassSurface<HTMLElement>({
    settings: {
      enabled: true,
      refractionStrength: Math.max(0, Math.min(40, strength)) / 40,
      dispersion,
    },
  });
  const surfaceTokens = {
    '--liquid-glass-blur': `${Math.max(0, Math.min(32, blur))}px`,
    ...(style.backdropFilter ? { '--liquid-glass-filter': String(style.backdropFilter) } : {}),
  };
  return (
    <>
      {filterSvg}
      <Box
        boxRef={ref}
        ariaHidden
        className={`liquid-glass ${className}`.trim()}
        dataAttrs={{ 'data-refraction': String(Boolean(filterSvg)) }}
        surfaceTokens={surfaceTokens}
      >
        <Box className="liquid-glass__backdrop" />
        <Box className="liquid-glass__finish" />
      </Box>
    </>
  );
}
