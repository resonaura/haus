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
  buildDemoAppsState,
  buildDemoIntegrationsState,
  buildDemoOnboardingState,
  countAppFilters,
  countIntegrationFilters,
  groupIntegrationsByDomain,
} from '@haus/core/transport';
import { DEFAULT_ICON_STYLE, resolveIconStyle } from '@haus/icons';
import {
  AddDeviceModal,
  AppsWorkspaceView,
  BrandIcon,
  buildMonogramBadgeSvgUri,
  DeviceBrandIcon,
  DeviceTile,
  DiscoveredIntegrationsPanel,
  DiscoveryRadarPanel,
  formatDiscoverySourceLabel,
  HausUiProvider,
  IntegrationsOverviewView,
  isDiscoveredFlowSource,
  resolveDeviceBrandArtwork,
  resolveProtocolBrandSvgUri,
  SystemSummaryCardsView,
} from '../src/index.js';
import {
  applyBrandIconDropShadow,
  BRAND_ICON_SHADOW_BLEED_FRACTION,
  renderLocalBrandTileNode,
} from '../src/gpui/brand-icons.js';

describe('@haus/ui brand icons, unified management views, and discovery', () => {
  it('resolves custom brand silhouettes for Apple TV, HomePod, Nest, Samsung TV, Fire TV, and eero', () => {
    expect(
      resolveDeviceBrandArtwork({
        name: 'Living Room Apple TV',
        primaryEntityId: 'media_player.living_room_tv',
        manufacturer: 'Apple',
        model: 'Apple TV 4K',
      })?.id,
    ).toBe('apple-tv');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Bedroom Speaker',
        primaryEntityId: 'media_player.bedroom_homepod',
        manufacturer: 'Apple',
        model: 'HomePod mini',
      })?.id,
    ).toBe('homepod-mini');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Kitchen Speaker',
        primaryEntityId: 'media_player.kitchen_homepod',
        manufacturer: 'Apple',
        model: 'HomePod (2nd generation)',
      })?.id,
    ).toBe('homepod');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Willow Mesh',
        primaryEntityId: 'sensor.eero_gateway',
        category: 'network',
        manufacturer: 'eero',
        model: 'eero 6+',
      })?.id,
    ).toBe('eero');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Kitchen Display',
        primaryEntityId: 'media_player.kitchen_hub',
        manufacturer: 'Google Inc.',
        model: 'Google Nest Hub',
      })?.id,
    ).toBe('nest-hub');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Office TV',
        primaryEntityId: 'media_player.office_tv',
        manufacturer: 'Samsung',
        model: 'LS43CG702',
      })?.id,
    ).toBe('samsung-tv');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Guest TV',
        primaryEntityId: 'media_player.guest_fire',
        manufacturer: 'Amazon',
        model: 'AFTMM',
      })?.id,
    ).toBe('firetv');

    expect(
      resolveDeviceBrandArtwork({
        name: 'Desk Lamp',
        primaryEntityId: 'light.desk_lamp',
        category: 'lights',
        manufacturer: 'Philips',
        model: 'Hue Play',
      }),
    ).toBeUndefined();
  });

  it('renders custom device brand SVGs and specialty glyphs inside DeviceTile', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(DeviceTile, {
          name: 'Living Room Apple TV',
          state: 'Playing',
          available: true,
          active: true,
          desktop: true,
          deviceIcon: {
            name: 'Living Room Apple TV',
            primaryEntityId: 'media_player.apple_tv',
            manufacturer: 'Apple',
            model: 'Apple TV 4K',
          },
        }),
        React.createElement(DeviceBrandIcon, {
          device: { name: 'Bathroom Scale', isScale: true },
          size: 19,
        }),
        React.createElement(DeviceBrandIcon, {
          device: { name: 'Electric Kettle', isKettle: true },
          size: 19,
        }),
        React.createElement(DeviceBrandIcon, {
          device: { name: 'Balcony Window', securityIconKey: 'window-open' },
          size: 19,
        }),
      ),
    );
    expect(html).toContain('device-brand-icon');
    expect(html).toContain('data-haus-kind="vector-markup"');
    expect(html).toContain('<rect');
    expect(html).toContain('<path');
  });

  it('resolves protocol SVGs and renders local macOS/GNOME PNG brand tiles via Skia', async () => {
    const matterUri = resolveProtocolBrandSvgUri('integration', 'matter');
    const threadUri = resolveProtocolBrandSvgUri('integration', 'thread');
    expect(matterUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(threadUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(resolveProtocolBrandSvgUri('addon', 'core_matter_server')).toBe(matterUri);

    const monogramUri = buildMonogramBadgeSvgUri('integration', 'hue', { name: 'Philips Hue' });
    expect(monogramUri).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);

    const style = resolveIconStyle(DEFAULT_ICON_STYLE, true);
    const tile = await renderLocalBrandTileNode(matterUri!, style, 44);
    expect(tile).not.toBeNull();
    expect(tile?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(tile?.dataUrl.length).toBeGreaterThan(200);

    const monogramTile = await renderLocalBrandTileNode(monogramUri, style, 44);
    expect(monogramTile).not.toBeNull();
    expect(monogramTile?.dataUrl).toMatch(/^data:image\/png;base64,/);

    const shadowed = await applyBrandIconDropShadow(tile!.dataUrl, 44, true);
    expect(shadowed).not.toBeNull();
    expect(shadowed?.bleedFraction).toBe(BRAND_ICON_SHADOW_BLEED_FRACTION);
    expect(shadowed?.dataUrl).toMatch(/^data:image\/png;base64,/);
  }, 15_000);

  it('preserves Electron container sizing, @haus/icons enclosure geometry, and exact drop-shadows on DOM', () => {
    const inheritLight = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'light' },
        React.createElement(BrandIcon, { kind: 'integration', id: 'hue' }),
      ),
    );
    expect(inheritLight).toContain('brand-icon-surface is-enclosure-rendered');
    expect(inheritLight).toContain('width:100%');
    expect(inheritLight).toContain('height:100%');
    expect(inheritLight).toContain('overflow:visible');
    expect(inheritLight).toContain('filter:drop-shadow(0px 1.25px 2.25px rgba(0, 0, 0, 0.26))');
    expect(inheritLight).not.toContain('corner-shape');
    expect(inheritLight).not.toContain('border-top-left-radius');

    const sizedDark = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(BrandIcon, { kind: 'addon', id: 'zigbee2mqtt', size: 60 }),
      ),
    );
    expect(sizedDark).toContain('width:60px');
    expect(sizedDark).toContain('height:60px');
    expect(sizedDark).toContain('filter:drop-shadow(0px 1.5px 2.75px rgba(0, 0, 0, 0.42))');
  });

  it('renders unified Integrations, Discovered, Apps, and Discovery Radar views with BrandIcon and GlassRim', () => {
    const demoIntegrations = buildDemoIntegrationsState();
    expect(demoIntegrations.progress.length).toBeGreaterThan(0);
    expect(isDiscoveredFlowSource('zeroconf')).toBe(true);
    expect(isDiscoveredFlowSource('reauth')).toBe(false);
    expect(formatDiscoverySourceLabel('zeroconf')).toBe('mDNS / Zeroconf');

    const groups = groupIntegrationsByDomain(
      demoIntegrations.entries,
      (domain) => demoIntegrations.titles[domain] ?? domain,
    );
    const counts = countIntegrationFilters(
      demoIntegrations.entries,
      demoIntegrations.progress.length,
      demoIntegrations.issues,
    );
    const integrationsHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(IntegrationsOverviewView, {
          query: '',
          filter: 'all',
          filters: [
            { id: 'all', label: 'All', count: counts.all },
            { id: 'discovered', label: 'Discovered', count: counts.discovered },
            { id: 'loaded', label: 'Connected', count: counts.loaded },
            { id: 'issues', label: 'Needs attention', count: counts.issues },
            { id: 'disabled', label: 'Disabled', count: counts.disabled },
          ],
          cards: groups.map((g) => ({
            domain: g.domain,
            displayName: g.name,
            summary: `${g.entries.length} account`,
            firstEntryTitle: g.entries[0]?.title ?? '',
            secondEntryTitle: '',
            extraEntries: 0,
            entityCount: demoIntegrations.metaByDomain.get(g.domain)?.entityCount ?? 0,
            hasAttention: false,
            attentionLabel: 'Attention',
            hasUpdate: false,
            allDisabled: false,
          })),
          discoveredItems: demoIntegrations.progress.map((flow) => ({
            flowId: flow.flow_id,
            handler: flow.handler,
            integrationTitle: demoIntegrations.titles[flow.handler] ?? flow.handler,
            deviceLabel: flow.title,
            source: flow.source,
            sourceLabel: formatDiscoverySourceLabel(flow.source),
          })),
          discoveredCount: demoIntegrations.progress.length,
          issues: demoIntegrations.issues,
          updates: demoIntegrations.updates,
          repairCount: demoIntegrations.issues.length,
          updateCount: demoIntegrations.updates.availableCount,
          onQueryChange: () => undefined,
          onFilterChange: () => undefined,
          onRefresh: () => undefined,
          onOpenRepairs: () => undefined,
          onOpenUpdates: () => undefined,
          onSelectDomain: () => undefined,
          onConfigureDiscoveredItem: () => undefined,
          onIgnoreDiscoveredItem: () => undefined,
        }),
      ),
    );
    expect(integrationsHtml).toContain('Everything speaks the same language.');
    expect(integrationsHtml).toContain('Discovered');
    expect(integrationsHtml).toContain('Philips Hue Bridge');
    expect(integrationsHtml).toContain('Configure');
    expect(integrationsHtml).toContain('brand-icon-tile');
    expect(integrationsHtml).toContain('data-haus-glass-rim');

    const demoApps = buildDemoAppsState();
    const appCounts = countAppFilters(demoApps.installed);
    const appsHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'light' },
        React.createElement(AppsWorkspaceView, {
          tab: 'installed',
          query: '',
          filter: 'all',
          filters: [
            { id: 'all', label: 'Installed', count: appCounts.all },
            { id: 'running', label: 'Running', count: appCounts.running },
            { id: 'stopped', label: 'Stopped', count: appCounts.stopped },
            { id: 'updates', label: 'Updates', count: appCounts.updates },
          ],
          installedApps: demoApps.installed,
          totalInstalledCount: demoApps.installed.length,
          catalogApps: demoApps.catalog,
          canManage: true,
          onTabChange: () => undefined,
          onQueryChange: () => undefined,
          onFilterChange: () => undefined,
          onRefresh: () => undefined,
          onManageApp: () => undefined,
          onInstallCatalogApp: () => undefined,
        }),
      ),
    );
    expect(appsHtml).toContain('The services behind your home.');
    expect(appsHtml).toContain('brand-icon-tile');
    expect(appsHtml).toContain('data-haus-glass-rim');

    const onboarding = buildDemoOnboardingState();
    const addHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(AddDeviceModal, {
          query: '',
          discovered: onboarding.discovered,
          catalog: onboarding.catalog,
          onQueryChange: () => undefined,
          onRescan: () => undefined,
          onSelectDiscovered: () => undefined,
          onSelectCatalog: () => undefined,
          onChooseCode: () => undefined,
          onChooseCamera: () => undefined,
          onChooseBrowse: () => undefined,
          onChooseApps: () => undefined,
          onClose: () => undefined,
        }),
        React.createElement(BrandIcon, { kind: 'integration', id: 'matter', size: 44 }),
        React.createElement(DiscoveredIntegrationsPanel, {
          items: [],
          emptyWhenShown: true,
          onConfigure: () => undefined,
        }),
        React.createElement(DiscoveryRadarPanel, {
          discovered: onboarding.discovered,
          onRescan: () => undefined,
          onSelectDiscovered: () => undefined,
        }),
        React.createElement(SystemSummaryCardsView, {
          issues: demoIntegrations.issues,
          updates: demoIntegrations.updates,
          onOpenRepairs: () => undefined,
          onOpenUpdates: () => undefined,
        }),
      ),
    );
    expect(addHtml).toContain('Discovered nearby');
    expect(addHtml).toContain('Philips Hue Bridge');
    expect(addHtml).toContain('Set up with code');
    expect(addHtml).toContain('brand-icon-tile');
  });
});
