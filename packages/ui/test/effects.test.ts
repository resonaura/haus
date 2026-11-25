/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { buildLightEffectOptions } from '@haus/core/device';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LightEffectsPanel, PowerStripPanel } from '../src/components/index.js';
import { insets } from '../src/ir/index.js';
import { HausUiProvider, ProgressiveBlur } from '../src/primitives/index.js';

describe('shared camera and device effects', () => {
  it('composes increasingly strong masked DOM blur and respects reduced transparency', () => {
    const blur = createElement(ProgressiveBlur, {
      maxRadius: 12,
      start: 0.35,
      style: { layout: { position: 'absolute', inset: insets(0) } },
    });
    const markup = renderToStaticMarkup(blur);
    expect(markup).toContain('backdrop-filter:blur(3px)');
    expect(markup).toContain('backdrop-filter:blur(12px)');
    expect(markup.match(/;mask-image:linear-gradient/g)).toHaveLength(3);
    const reduced = renderToStaticMarkup(
      createElement(HausUiProvider, { reducedTransparency: true }, blur),
    );
    expect(reduced).not.toContain('backdrop-filter');
  });

  it('uses circular individual buttons and exposes the unavailable state', () => {
    const markup = renderToStaticMarkup(
      createElement(PowerStripPanel, {
        outlets: [
          { id: 'desk', label: 'Desk', available: true, active: true, isMaster: false },
          { id: 'master', label: 'All Outlets', available: false, active: false, isMaster: true },
        ],
        onToggle() {},
      }),
    );
    expect(markup).toContain('aria-label="Individual outlets"');
    expect(markup).toMatch(
      /<button[^>]*width:90px[^>]*aria-label="Turn off Desk"[^>]*aria-pressed="true"/,
    );
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Turn on All Outlets"/);
    expect(markup).toContain('No response');
  });

  it('presents the active dynamic effect with its palette and an explicit stop action', () => {
    const markup = renderToStaticMarkup(
      createElement(LightEffectsPanel, {
        options: buildLightEffectOptions(['Aurora', 'Candle', 'None']),
        active: 'Aurora',
        stop: 'None',
        disabled: false,
        onSelect() {},
      }),
    );
    expect(markup).toContain('Available light effects');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('linear-gradient');
    expect(markup).toContain('>Stop<');
    expect(markup).not.toContain('>None<');
  });
});
