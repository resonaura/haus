/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computePopoverPosition } from '../src/renderers/dom-popover.js';
import { DOM_HOST_ADAPTER, DomHostAdapter } from '../src/renderers/dom-host.js';
import { HausPopover, HausUiProvider } from '../src/index.js';

describe('DOM portal popover positioning and rendering', () => {
  it('flips placement when overflowing and clamps inside viewport bounds', () => {
    const bottomOverflow = computePopoverPosition({
      anchor: { top: 820, left: 20, right: 160, bottom: 860, width: 140, height: 40 },
      surface: { width: 280, height: 240 },
      viewport: { width: 1280, height: 900 },
      placement: 'bottom',
      align: 'start',
    });
    expect(bottomOverflow.placement).toBe('top');
    expect(bottomOverflow.top).toBe(820 - 8 - 240);
    expect(bottomOverflow.left).toBe(20);

    const endClamped = computePopoverPosition({
      anchor: { top: 40, left: 1180, right: 1272, bottom: 72, width: 92, height: 32 },
      surface: { width: 280, height: 200 },
      viewport: { width: 1280, height: 900 },
      placement: 'bottom',
      align: 'start',
    });
    expect(endClamped.placement).toBe('bottom');
    expect(endClamped.top).toBe(80);
    expect(endClamped.left).toBe(1280 - 280 - 8);
  });

  it('delegates open DOM HausPopover surface through ctx.portal as fixed overlay above modals', () => {
    let portaledNode: React.ReactNode = null;
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        {
          mode: 'dark',
          host: DOM_HOST_ADAPTER,
          portal: (node) => {
            portaledNode = node;
            return React.createElement('div', { 'data-portal-slot': 'true' }, node);
          },
        },
        React.createElement(HausPopover, {
          id: 'test-calendar-popover',
          open: true,
          placement: 'bottom',
          className: 'custom-popover-surface',
          onOpenChange: () => undefined,
          trigger: React.createElement('button', { type: 'button' }, 'Open'),
          children: React.createElement('span', null, 'Portal content'),
        }),
      ),
    );

    expect(portaledNode).not.toBeNull();
    expect(html).toContain('data-haus-kind="popover-anchor"');
    expect(html).toContain('data-portal-slot="true"');
    const portalHtml = renderToStaticMarkup(
      React.createElement(React.Fragment, null, portaledNode),
    );
    expect(portalHtml).toContain('id="test-calendar-popover"');
    expect(portalHtml).toContain('class="custom-popover-surface"');
    expect(portalHtml).toContain('data-haus-kind="popover"');
    expect(portalHtml).toContain('position:fixed');
    expect(portalHtml).toContain('z-index:1100');
  });

  it('invokes only the topmost subscribeEscape handler in LIFO order', () => {
    const target = new EventTarget();
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const previousWindow = Reflect.get(globalThis, 'window');
    Reflect.set(globalThis, 'window', target);

    try {
      const adapter = new DomHostAdapter();
      const events: string[] = [];
      const unsubscribeModal = adapter.subscribeEscape(() => events.push('modal'));
      const unsubscribePopover = adapter.subscribeEscape(() => events.push('popover'));

      const dispatchEscape = () => {
        const event = new Event('keydown', { cancelable: true });
        Reflect.set(event, 'key', 'Escape');
        target.dispatchEvent(event);
        return event;
      };

      const first = dispatchEscape();
      expect(first.defaultPrevented).toBe(true);
      expect(events).toEqual(['popover']);

      unsubscribePopover();
      const second = dispatchEscape();
      expect(second.defaultPrevented).toBe(true);
      expect(events).toEqual(['popover', 'modal']);

      unsubscribeModal();
      const third = dispatchEscape();
      expect(third.defaultPrevented).toBe(false);
      expect(events).toEqual(['popover', 'modal']);
    } finally {
      if (hadWindow) Reflect.set(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });
});
