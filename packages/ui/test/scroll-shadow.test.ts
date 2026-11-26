/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  computeScrollShadowRampPx,
  computeScrollShadowTargets,
  createHausUiTheme,
  DEFAULT_SCROLL_SHADOW_SIZE_PX,
  DEFAULT_SCROLL_SHADOW_TRANSITION_MS,
  HAUS_DOM_SCROLL_SHADOW_CSS,
  HausScrollArea,
  HausUiProvider,
  resolveScrollShadowEdges,
  SCROLL_SHADOW_PRESETS,
} from '../src/index.js';
import { buildGpuiScrollViewStyle, GPUIX_CONTENT_HOST } from '../src/gpui/index.js';

describe('scroll shadow unified math & presets', () => {
  it('exposes consistent default size, transition duration, and presets', () => {
    expect(DEFAULT_SCROLL_SHADOW_SIZE_PX).toBe(24);
    expect(DEFAULT_SCROLL_SHADOW_TRANSITION_MS).toBe(180);
    expect(SCROLL_SHADOW_PRESETS).toEqual({
      main: 36,
      sidebar: 28,
      rail: 26,
      default: 24,
    });
  });

  it('clamps ramp distance and matches GPUI fade target curve at edges and midpoint', () => {
    expect(computeScrollShadowRampPx(10)).toBe(8);
    expect(computeScrollShadowRampPx(24)).toBe(12);
    expect(computeScrollShadowRampPx(36)).toBe(18);
    expect(computeScrollShadowRampPx(60)).toBe(20);

    // Non-scrollable (max <= 1px) yields 0 on both edges.
    expect(computeScrollShadowTargets({ offsetPx: 0, maxOffsetPx: 0.8, sizePx: 36 })).toEqual({
      start: 0,
      end: 0,
      startPx: 0,
      endPx: 0,
    });

    // At top of a scrollable container: start = 0, end = full size.
    expect(computeScrollShadowTargets({ offsetPx: 0, maxOffsetPx: 400, sizePx: 36 })).toEqual({
      start: 0,
      end: 1,
      startPx: 0,
      endPx: 36,
    });

    // Halfway through top ramp (9px of 18px ramp): start = 0.5 -> 18px.
    expect(computeScrollShadowTargets({ offsetPx: 9, maxOffsetPx: 400, sizePx: 36 })).toEqual({
      start: 0.5,
      end: 1,
      startPx: 18,
      endPx: 36,
    });

    // At bottom: start = full size, end = 0.
    expect(computeScrollShadowTargets({ offsetPx: 400, maxOffsetPx: 400, sizePx: 36 })).toEqual({
      start: 1,
      end: 0,
      startPx: 36,
      endPx: 0,
    });

    // Edge toggles selectively suppress start or end fade.
    expect(
      computeScrollShadowTargets({
        offsetPx: 200,
        maxOffsetPx: 400,
        sizePx: 36,
        startEnabled: false,
        endEnabled: true,
      }),
    ).toEqual({ start: 0, end: 1, startPx: 0, endPx: 36 });
  });

  it('resolves active edges per orientation', () => {
    expect(resolveScrollShadowEdges('vertical')).toEqual({
      start: true,
      end: true,
      activeEdges: ['top', 'bottom'],
    });
    expect(resolveScrollShadowEdges('horizontal')).toEqual({
      start: true,
      end: true,
      activeEdges: ['left', 'right'],
    });
    expect(resolveScrollShadowEdges('vertical', ['bottom'])).toEqual({
      start: false,
      end: true,
      activeEdges: ['bottom'],
    });
  });
});

describe('DOM & GPUIX scroll shadow adapters', () => {
  it('defines @property length transitions, smoothstep stops, and reduced-motion override in DOM CSS', () => {
    expect(HAUS_DOM_SCROLL_SHADOW_CSS).toContain('@property --haus-ss-start');
    expect(HAUS_DOM_SCROLL_SHADOW_CSS).toContain('@property --haus-ss-end');
    expect(HAUS_DOM_SCROLL_SHADOW_CSS).toContain("syntax: '<length>'");
    expect(HAUS_DOM_SCROLL_SHADOW_CSS).toContain('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(HAUS_DOM_SCROLL_SHADOW_CSS).toContain('prefers-reduced-motion: reduce');
  });

  it('emits smooth transition attributes on DomScrollView and respects isEnabled and reducedMotion', () => {
    const enabledHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        null,
        React.createElement(HausScrollArea, {
          orientation: 'vertical',
          size: SCROLL_SHADOW_PRESETS.main,
          transitionMs: 220,
        }),
      ),
    );
    expect(enabledHtml).toContain('data-haus-scroll-shadow="true"');
    expect(enabledHtml).toContain('--haus-ss-duration:220ms');
    expect(enabledHtml).toContain('overflow-y:auto');

    const disabledHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        null,
        React.createElement(HausScrollArea, {
          orientation: 'vertical',
          isEnabled: false,
        }),
      ),
    );
    expect(disabledHtml).not.toContain('data-haus-scroll-shadow="true"');
    expect(disabledHtml).toContain('overflow-y:auto');

    const reducedMotionHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { viewport: { reducedMotion: true } },
        React.createElement(HausScrollArea, {
          orientation: 'horizontal',
          size: SCROLL_SHADOW_PRESETS.rail,
        }),
      ),
    );
    expect(reducedMotionHtml).toContain('data-orientation="horizontal"');
    expect(reducedMotionHtml).toContain('--haus-ss-duration:0ms');
  });

  it('forwards fade mode, transitionMs, edges, and scrollability cleanly in GPUIX host', () => {
    const context = {
      theme: createHausUiTheme('dark'),
      viewport: {
        width: 1280,
        height: 800,
        dpr: 2,
        reducedMotion: false,
        reducedTransparency: false,
        highContrast: false,
      },
    } as Parameters<NonNullable<typeof GPUIX_CONTENT_HOST.renderScrollView>>[1];

    const fadeStyle = buildGpuiScrollViewStyle(
      { orientation: 'vertical', shadowSizePx: 36, edges: ['bottom'], transitionMs: 200 },
      context,
    );
    expect(fadeStyle.overflowY).toBe('scroll');
    expect(fadeStyle.scrollShadow).toEqual({
      enabled: true,
      mode: 'fade',
      size: 36,
      transitionMs: 200,
      edges: ['bottom'],
    });
    expect(
      GPUIX_CONTENT_HOST.renderScrollView!(
        { orientation: 'vertical', shadowSizePx: 36, edges: ['bottom'], transitionMs: 200 },
        context,
      ),
    ).toBeTruthy();

    // isEnabled=false disables the scroll shadow mask without breaking scrollability.
    const noShadowStyle = buildGpuiScrollViewStyle(
      { orientation: 'vertical', isEnabled: false },
      context,
    );
    expect(noShadowStyle.overflowY).toBe('scroll');
    expect(noShadowStyle.scrollShadow).toBeUndefined();

    // reducedMotion forces transitionMs: 0.
    const reducedStyle = buildGpuiScrollViewStyle(
      { orientation: 'horizontal' },
      { ...context, viewport: { ...context.viewport, reducedMotion: true } },
    );
    expect(reducedStyle.scrollShadow).toEqual({
      enabled: true,
      mode: 'fade',
      size: 24,
      transitionMs: 0,
      edges: ['left', 'right'],
    });
  });
});
