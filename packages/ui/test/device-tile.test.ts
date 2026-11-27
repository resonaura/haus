/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describeLightEffect } from '@haus/core/device';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeviceTile, parseCssColor } from '../src/components/index.js';
import { rgba } from '../src/ir/index.js';
import { HausUiProvider } from '../src/primitives/index.js';

describe('shared 1:1 DeviceTile', () => {
  it('renders layered desktop glass surface, radial wash, swatch, badges, and muted unavailable body', () => {
    const activeMarkup = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(DeviceTile, {
          desktop: true,
          active: true,
          available: true,
          name: 'Floor Lamp',
          subtitle: 'Living Room',
          state: '80% · 2700 K',
          category: 'lights',
          accent: rgba(255, 190, 90, 1),
          colorSwatch: rgba(255, 190, 90, 1),
          favorite: true,
          groupCount: 3,
          battery: { level: 15, charging: false },
          sourceBadge: 'Hue',
          onQuick() {},
          onOpen() {},
          onMore() {},
        }),
      ),
    );
    expect(activeMarkup).toContain('data-haus-device-tile="shared"');
    expect(activeMarkup).toContain('linear-gradient(150deg');
    expect(activeMarkup).toContain('radial-gradient(ellipse at 0% 0%');
    expect(activeMarkup).toContain('light-color-swatch');
    expect(activeMarkup).toContain('light-group-count');
    expect(activeMarkup).toContain('>3<');
    expect(activeMarkup).toContain('battery-tile-reading is-low');
    expect(activeMarkup).toContain('>Hue<');
    expect(activeMarkup).toContain('Favorite');
    expect(activeMarkup).toContain('tile-more');
    expect(activeMarkup).toMatch(
      /class="accessory-icon"[^>]*border-top-left-radius:999px[^>]*corner-shape:round/,
    );
    expect(activeMarkup).toMatch(
      /class="light-color-swatch"[^>]*border-top-left-radius:999px[^>]*corner-shape:round/,
    );

    const unavailableMarkup = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'light' },
        createElement(DeviceTile, {
          desktop: true,
          active: false,
          available: false,
          name: 'Hallway Sensor',
          subtitle: 'Hallway',
          state: 'Unavailable',
          battery: { level: 85, charging: false },
        }),
      ),
    );
    expect(unavailableMarkup).toMatch(/class="tile-body"[^>]*opacity:0\.65/);
    // Idle OFF optimization: no wash nodes mounted when inactive at rest.
    expect(unavailableMarkup).not.toContain('device-tile-wash');
    // High non-charging battery hides until hover (`opacity:0`), distinct from tile-body's 0.65.
    expect(unavailableMarkup).toMatch(/class="battery-tile-reading[^"]*"[^>]*opacity:0(?![.\d])/);
    // Steady ON optimization: single unblurred wash node at rest (`blur` omitted when scale === 1).
    expect(activeMarkup).toContain('class="device-tile-wash"');
    expect(activeMarkup).not.toContain('device-tile-wash-inner');
    expect(activeMarkup).not.toContain('filter:blur');
  });

  it('renders dynamic light effect washes, effect badge, and restore action while preserving compact mode', () => {
    const effect = {
      ...describeLightEffect('Aurora'),
      value: 'Aurora',
      label: 'Aurora',
    };
    const fxMarkup = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(DeviceTile, {
          desktop: true,
          active: true,
          available: true,
          name: 'Ceiling Strip',
          state: 'On · Aurora',
          lightEffect: effect,
          onRestore() {},
          onMore() {},
        }),
      ),
    );
    expect(fxMarkup).toContain('data-light-effect="aurora"');
    expect(fxMarkup).toContain('light-effect-badge');
    expect(fxMarkup).toContain('tile-restore');
    expect(fxMarkup).toContain('Restore to app');
    expect(fxMarkup).toContain('min-height:185px');

    const compactMarkup = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'light' },
        createElement(DeviceTile, {
          compact: true,
          available: false,
          name: 'Compact Lamp',
          category: 'lights',
          categoryLabel: 'Light',
          state: 'Off',
        }),
      ),
    );
    expect(compactMarkup).toContain('Unavailable');
    expect(compactMarkup).not.toContain('data-haus-device-tile');
  });

  it('parses CSS hex and rgb/rgba strings cleanly', () => {
    expect(parseCssColor('#ffcc2e')).toEqual(rgba(255, 204, 46, 1));
    expect(parseCssColor('#0f8')).toEqual(rgba(0, 255, 136, 1));
    expect(parseCssColor('rgb(255, 160, 80)')).toEqual(rgba(255, 160, 80, 1));
    expect(parseCssColor('rgba(18, 18, 18, 0.94)')).toEqual(rgba(18, 18, 18, 0.94));
    expect(parseCssColor('var(--cat-lights)')).toBeUndefined();
  });

  it('enforces inverse motion-blur law: smaller inner wash scale produces stronger blur and full size has 0 blur', async () => {
    const { buildWashTransitionMotion, effectMotionFor, washBlurForScale } =
      await import('../src/components/devices/tile-theme.js');
    // Strict monotonic inverse relationship: smaller scale => larger blur, scale >= 1 => 0 blur.
    expect(washBlurForScale(1)).toBe(0);
    expect(washBlurForScale(1.04)).toBe(0);
    expect(washBlurForScale(0.95)).toBeGreaterThan(0);
    expect(washBlurForScale(0.85)).toBeGreaterThan(washBlurForScale(0.95));
    expect(washBlurForScale(0.72)).toBeGreaterThan(washBlurForScale(0.85));
    expect(washBlurForScale(0.72)).toBe(28);

    const activating = buildWashTransitionMotion(true, false);
    expect(activating.initial).toEqual({ opacity: 0, scale: 0.72, blur: 28 });
    expect(activating.animate).toEqual({ opacity: 1, scale: 1, blur: 0 });
    expect(activating.propertyDurationsMs?.blur).toBe(activating.propertyDurationsMs?.transform);
    expect(activating.propertyEases?.blur).toEqual(activating.propertyEases?.transform);

    const deactivating = buildWashTransitionMotion(false, false);
    expect(deactivating.initial).toEqual({ opacity: 1, scale: 1, blur: 0 });
    expect(deactivating.animate).toEqual({ opacity: 0, scale: 0.72, blur: 28 });
    expect(deactivating.propertyDurationsMs?.blur).toBe(
      deactivating.propertyDurationsMs?.transform,
    );
    expect(deactivating.propertyEases?.blur).toEqual(deactivating.propertyEases?.transform);

    // Dynamic breathing/pulsing effects also blur inversely with scale and hit 0 blur when scale >= 1.
    const pulse = effectMotionFor('pulse', false);
    expect(pulse?.animate.scale).toEqual([0.91, 1.04, 0.91]);
    expect(pulse?.animate.blur).toEqual([washBlurForScale(0.91), 0, washBlurForScale(0.91)]);

    const reducedTransparency = buildWashTransitionMotion(true, true);
    expect(reducedTransparency.animate.blur).toBeUndefined();
  });
});
