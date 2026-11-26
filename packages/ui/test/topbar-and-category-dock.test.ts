/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopTopbar, HomeCategoryDock, SidebarLayout } from '../src/components/index.js';
import { HausUiProvider } from '../src/primitives/context.js';
import {
  keepElementVisibleInScroll,
  scrollContainerTo,
  type HausScrollHandle,
} from '../src/renderers/scroll-handle.js';

describe('Unified DesktopTopbar, HomeCategoryDock, scrollTo, and sidebar without fold', () => {
  it('renders unified DesktopTopbar matching Electron styling without portable fork', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark', viewportWidth: 1280, viewportHeight: 840 },
        React.createElement(DesktopTopbar, {
          homeName: 'Willow House',
          heading: 'Overview',
          demo: true,
          userName: 'Alex',
          notificationCount: 2,
          hasAttention: true,
          onSearch: () => undefined,
          onNotifications: () => undefined,
          onSettings: () => undefined,
        }),
      ),
    );

    expect(html).toContain('data-haus-topbar="shared"');
    expect(html).toContain('data-haus-topbar-profile="shared"');
    expect(html).toContain('min-height:61px');
    expect(html).toContain('DEMO HOME');
    expect(html).toContain('Willow House');
    expect(html).toContain('Overview');
    expect(html).toContain('border-top-left-radius:999px');
    // No mobile menu button when onOpenNavigation is omitted on desktop.
    expect(html).not.toContain('topbar-navigation');
  });

  it('renders sticky HomeCategoryDock with top-down progressive blur, All pill, divider, and categories', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark', viewportWidth: 1280, viewportHeight: 840 },
        React.createElement(HomeCategoryDock, {
          categories: [
            { id: 'lights', name: 'Lights', summary: '3 on' },
            { id: 'climate', name: 'Climate', summary: '21.5°' },
            { id: 'servers', name: 'Servers', summary: 'Storage & services' },
          ],
          selected: 'lights',
          onSelect: () => undefined,
        }),
      ),
    );

    expect(html).toContain('data-haus-category-layer="shared"');
    expect(html).toContain('data-haus-category-dock="shared"');
    expect(html).toContain('data-haus-category-filter="shared"');
    expect(html).toContain('position:sticky');
    expect(html).toContain('top:0px');
    // Top-down progressive blur 3-layer masks matching Electron's home-overview.scss
    expect(html).toContain('blur(18px)');
    expect(html).toContain('blur(9px)');
    expect(html).toContain('blur(3px)');
    expect(html).toContain('linear-gradient(#000 20%, transparent 75%)');
    expect(html).toContain('home-category-divider');
    expect(html).toContain('Your home');
    expect(html).toContain('Servers');
    expect(html).toContain('aria-pressed="true"');
  });

  it('renders SidebarLayout without the removed collapse/fold button', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark', viewportWidth: 1280, viewportHeight: 840 },
        React.createElement(
          SidebarLayout<'home' | 'servers'>,
          {
            items: [
              { id: 'home', label: 'Home', icon: 'house' },
              { id: 'servers', label: 'Servers', icon: 'server' },
            ],
            selected: 'home',
            onSelect: () => undefined,
          },
          React.createElement('div', null, 'Body'),
        ),
      ),
    );

    expect(html).toContain('sidebar-home');
    expect(html).toContain('sidebar-servers');
    expect(html).not.toContain('sidebar-toggle');
    expect(html).not.toContain('Collapse sidebar');
    expect(html).not.toContain('Expand sidebar');
  });

  it('scrollContainerTo and keepElementVisibleInScroll work on both GPUIX handles and DOM boxes', () => {
    const scrollTo = vi.fn();
    const scrollElementIntoView = vi.fn(() => true);
    const gpuiHandle: HausScrollHandle = {
      scrollTo,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 400,
      clientHeight: 60,
      scrollWidth: 900,
      scrollHeight: 60,
      scrollElementIntoView,
    };

    expect(scrollContainerTo(gpuiHandle, { top: 0, left: 0, behavior: 'instant' })).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });

    const target = { id: 42 };
    expect(
      keepElementVisibleInScroll(gpuiHandle, target, {
        axis: 'x',
        align: 'center',
        reducedMotion: false,
      }),
    ).toBe(true);
    expect(scrollElementIntoView).toHaveBeenCalledWith(target, {
      axis: 'x',
      align: 'center',
      behavior: 'smooth',
    });

    const domScrollTo = vi.fn();
    const domContainer = {
      scrollTo: domScrollTo,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 300,
      clientHeight: 60,
      scrollWidth: 800,
      scrollHeight: 60,
      getBoundingClientRect: () => ({ left: 100, top: 70, width: 300, height: 60 }),
    };
    const domButton = {
      offsetWidth: 100,
      offsetHeight: 50,
      getBoundingClientRect: () => ({ left: 550, top: 75, width: 100, height: 50 }),
    };
    expect(
      keepElementVisibleInScroll(domContainer, domButton, {
        axis: 'x',
        align: 'center',
        reducedMotion: true,
      }),
    ).toBe(true);
    // left = 550 - 100 + 0 = 450; centered = 450 - (300 - 100) / 2 = 350
    expect(domScrollTo).toHaveBeenCalledWith({ left: 350, behavior: 'instant' });
  });
});
