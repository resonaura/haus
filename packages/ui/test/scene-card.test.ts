/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SceneCard } from '../src/components/index.js';
import { HausUiProvider } from '../src/primitives/index.js';

describe('unified SceneCard', () => {
  it('shares DeviceTile 26px superellipse frame, blurred light preview, and non-button frosted icon', () => {
    const html = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(SceneCard, {
          id: 'scene-movie',
          name: 'Living Room Movie time',
          title: 'Movie time',
          room: 'Living Room',
          source: 'Hue',
          colors: ['rgb(255, 185, 110)', 'rgb(190, 120, 255)', 'rgb(80, 160, 255)'],
          count: 3,
          active: true,
          match: true,
          onContextOptions() {},
          onActivate() {},
        }),
      ),
    );

    // Unified shared marker + 26px continuous card corner radius matching DeviceTile.
    expect(html).toContain('data-haus-scene-card="shared"');
    expect(html).toContain('data-haus-glass-rim="managed"');
    expect(html).toMatch(
      /class="mood-card is-active-scene"[^>]*border-top-left-radius:26px[^>]*corner-shape:superellipse\(1\.4\)/,
    );

    // Real blurred light-field artwork (no inline SVG gradient hack).
    expect(html).not.toContain('data:image/svg+xml');
    expect(html).toMatch(/class="scene-artwork-blur"[^>]*filter:blur\(26px\)/);

    // Icon badge is a non-interactive frosted squircle <div> (NOT a <button>).
    expect(html).toMatch(
      /<div[^>]*class="mood-icon"[^>]*border-top-left-radius:9px[^>]*backdrop-filter:blur\(12px\)[^>]*pointer-events:none/,
    );
    expect(html).not.toMatch(/<button[^>]*class="mood-icon"/);

    // Active + source badges, circular color swatches, and top-right options trigger.
    expect(html).toContain('scene-source-badge');
    expect(html).toContain('scene-active-badge');
    expect(html).toContain('3 accessories · Settings match');
    expect(html).toMatch(/class="mood-details"[^>]*border-top-left-radius:999px/);
  });

  it('renders dark scenes cleanly without light orbs when colors are empty', () => {
    const html = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(SceneCard, {
          name: 'Away',
          title: 'Away',
          room: 'Whole home',
          colors: [],
          count: 0,
          dark: true,
          onActivate() {},
        }),
      ),
    );
    expect(html).toContain('mood-card is-dark-scene');
    expect(html).not.toContain('scene-artwork-blur');
    expect(html).toContain('scene-artwork-stage');
    expect(html).toContain('Whole home');
  });
});
