/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDemoServersState } from '@haus/core/transport';
import {
  CameraPreviewTile,
  formatSnapshotAge,
  ServerDetailView,
  ServersOverviewView,
  SidebarLayout,
  snapshotAgeSeconds,
} from '../src/components/index.js';
import { serverPanelSurface } from '../src/components/servers/server-surfaces.js';
import { HausUiProvider } from '../src/primitives/index.js';

describe('shared CameraPreviewTile and Servers UI parity', () => {
  it('formats snapshot age units compactly and handles invalid timestamps', () => {
    expect(snapshotAgeSeconds(0, 10_000)).toBeUndefined();
    expect(snapshotAgeSeconds(1000, 5500)).toBe(4);
    expect(formatSnapshotAge(0)).toBe('0s');
    expect(formatSnapshotAge(59)).toBe('59s');
    expect(formatSnapshotAge(60)).toBe('1m');
    expect(formatSnapshotAge(7200)).toBe('2h');
    expect(formatSnapshotAge(3 * 86_400)).toBe('3d');
  });

  it('renders CameraPreviewTile with flex column layout, hover-hidden metadata, and offline overlay', () => {
    const restHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(CameraPreviewTile, {
          name: 'Front Door',
          label: 'Front Door',
          room: 'Entryway',
          demo: true,
          onOpen: () => undefined,
        }),
      ),
    );
    expect(restHtml).toContain('data-haus-camera-tile="shared"');
    expect(restHtml).toContain('data-haus-glass-rim="managed"');
    expect(restHtml).toContain('display:flex');
    expect(restHtml).toContain('flex-direction:column');
    expect(restHtml).toContain('border-top-left-radius:26px');
    expect(restHtml).toContain('Preview');
    expect(restHtml).not.toContain('Camera offline');

    const offlineHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(CameraPreviewTile, {
          name: 'Garden Cam',
          label: 'Garden Cam',
          room: 'Garden',
          offline: true,
          updatedAt: Date.now() - 45_000,
          onOpen: () => undefined,
        }),
      ),
    );
    expect(offlineHtml).toContain('aria-label="Camera offline"');
    expect(offlineHtml).toContain('Offline');
  });

  it('renders ServersOverviewView and ServerDetailView with glass cards, sparklines, and DuoBar gauges', () => {
    const demo = buildDemoServersState();
    const overviewHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ServersOverviewView, {
          servers: demo.servers,
          onRefresh: () => undefined,
          onSelectServer: () => undefined,
        }),
      ),
    );
    expect(overviewHtml).toContain('Utility');
    expect(overviewHtml).toContain('Garage');
    expect(overviewHtml).toContain('Willow Hub');
    expect(overviewHtml).toContain('Garage NVR Node');
    expect(overviewHtml).toContain('data-haus-device-tile="shared"');
    expect(overviewHtml).toContain('CPU 18% · RAM 40%');

    const first = demo.servers[0]!;
    const detailHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ServerDetailView, {
          server: first,
          history: demo.historyByServerId?.[first.id] ?? [],
          activeTab: 'overview',
          canManage: true,
          onSelectTab: () => undefined,
          onBack: () => undefined,
        }),
      ),
    );
    expect(detailHtml).toContain('server-tab-overview');
    expect(detailHtml).toContain('server-tab-storage');
    expect(detailHtml).toContain('server-tab-services');
    expect(detailHtml).toContain('server-tab-terminal');
    expect(detailHtml).toContain('Processor');
    expect(detailHtml).toContain('Memory');
    expect(detailHtml).toContain('Swap');
    expect(detailHtml).toContain('Uptime');
    expect(detailHtml).toContain('Service Activity');
    expect(detailHtml).toContain('<path ');
    expect(detailHtml).toContain('<circle ');

    // Server cards delegate 1:1 to DeviceTile and panels stay pure monochrome (no blue tint or sheen).
    expect(overviewHtml).toContain('accessory-icon');
    expect(overviewHtml).toContain('tile-body');
    expect(overviewHtml).not.toContain('rgba(52, 211, 153');
    const panelSurface = serverPanelSurface();
    expect(panelSurface.material.kind).toBe('solid');
    expect(panelSurface.shadows).toEqual([]);
    expect(detailHtml).not.toContain('rgba(24, 24, 27');

    // Contextual navigation hides duplicate inline server tabs and header.
    const contextualDetailHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ServerDetailView, {
          server: first,
          history: demo.historyByServerId?.[first.id] ?? [],
          activeTab: 'overview',
          canManage: true,
          contextualNavigation: true,
          onSelectTab: () => undefined,
          onBack: () => undefined,
        }),
      ),
    );
    expect(contextualDetailHtml).not.toContain('server-detail-back');
    expect(contextualDetailHtml).not.toContain('role="tablist"');
    expect(contextualDetailHtml).toContain('Processor');
  });

  it('renders Electron-matched active sidebar pill and contextual server navigation pane', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(
          SidebarLayout<'home' | 'servers'>,
          {
            items: [
              { id: 'home', label: 'Home', icon: 'house' },
              { id: 'servers', label: 'Servers', icon: 'server' },
            ],
            selected: 'servers',
            onSelect: () => undefined,
            contextual: {
              backId: 'server-detail-back',
              backLabel: 'Servers',
              eyebrow: 'HOME SERVER',
              title: 'Willow Hub',
              iconName: 'server',
              status: 'online',
              activeId: 'overview',
              items: [
                { id: 'overview', testId: 'server-tab-overview', label: 'Overview', icon: 'gauge' },
                { id: 'storage', testId: 'server-tab-storage', label: 'Disks', icon: 'hard-drive' },
              ],
              onSelect: () => undefined,
              onBack: () => undefined,
            },
          },
          React.createElement('div', null, 'Main'),
        ),
      ),
    );
    expect(html).toContain('sidebar-context-viewport');
    expect(html).toContain('data-server-open="true"');
    expect(html).toContain('HOME SERVER');
    expect(html).toContain('Willow Hub');
    expect(html).toContain('id="server-detail-back"');
    expect(html).toContain('id="server-tab-overview"');
    expect(html).toContain('linear-gradient(165deg');
    expect(html).toContain('data-haus-glass-rim="control"');
  });
});
