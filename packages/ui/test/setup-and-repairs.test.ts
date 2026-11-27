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
  buildBrandIntegrationCatalog,
  buildDemoIntegrationsState,
  buildDemoOnboardingState,
  startDemoConfigFlow,
} from '@haus/core/transport';
import {
  CameraSetupModal,
  ConfigFlowModal,
  HausUiProvider,
  IntegrationAlphabetOverlay,
  IntegrationDetailsView,
  ManualCameraSetupModal,
  RepairsPanelView,
  resolveColorToSrgb,
  resolveThemeCssVariables,
  Theme,
} from '../src/index.js';

describe('@haus/ui unified setup, repair, camera, and integration detail flows', () => {
  it('renders RepairsPanelView with Fix, Docs, and Ignore actions', () => {
    const demo = buildDemoIntegrationsState();
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(RepairsPanelView, {
          issues: demo.issues,
          busy: false,
          canManage: true,
          onBack: () => undefined,
          onFix: () => undefined,
          onOpenExternal: () => undefined,
          onToggleIgnore: () => undefined,
        }),
      ),
    );
    expect(html).toContain('Zigbee channel overlaps 2.4 GHz Wi-Fi');
    expect(html).toContain('repair-fix-zigbee_channel_overlap');
    expect(html).toContain('repair-docs-zigbee_channel_overlap');
    expect(html).toContain('Ignore');
    expect(html).toContain('Fix');
    expect(html).toContain('Docs');
  });

  it('renders full IntegrationDetailsView with Needs Attention, Options, Reconfigure, Reauthenticate, Reload, Disable, and Delete', () => {
    const demo = buildDemoIntegrationsState();
    const html = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(IntegrationDetailsView, {
          domain: 'zha',
          title: 'Zigbee Home',
          runtimeLabel: 'Built-in integration',
          iotClassLabel: 'Local push',
          version: '2026.10.0',
          documentationUrl: 'https://www.home-assistant.io/integrations/zha',
          deviceCount: 9,
          entityCount: 16,
          entries: [
            {
              entryId: 'zigbee-main',
              title: 'SkyConnect Radio',
              domain: 'zha',
              state: 'loaded',
              disabledBy: null,
              canUnload: true,
              supportsOptions: true,
              supportsReconfigure: true,
              needsAttention: true,
              attentionSource: 'reauth',
              devices: [
                {
                  id: 'dev-1',
                  name: 'Living Room Motion Sensor',
                  manufacturer: 'Aqara',
                  model: 'RTCGQ11LM',
                  areaName: 'Living Room',
                  entityCount: 4,
                },
              ],
            },
          ],
          issues: demo.issues,
          canManage: true,
          busy: false,
          onBack: () => undefined,
          onAddEntry: () => undefined,
          onOptionsEntry: () => undefined,
          onReconfigureEntry: () => undefined,
          onReauthEntry: () => undefined,
          onReloadEntry: () => undefined,
          onToggleDisabled: () => undefined,
          onDeleteEntry: () => undefined,
          onFixRepair: () => undefined,
          onToggleIgnoreRepair: () => undefined,
          onOpenExternal: () => undefined,
          onOpenDevice: () => undefined,
        }),
      ),
    );
    expect(html).toContain('NEEDS ATTENTION');
    expect(html).toContain('Reauthenticate');
    expect(html).toContain('Options');
    expect(html).toContain('Reconfigure');
    expect(html).toContain('Reload');
    expect(html).toContain('Disable');
    expect(html).toContain('Delete');
    expect(html).toContain('Living Room Motion Sensor');
    expect(html).toContain('integration-detail-fix-zigbee_channel_overlap');
  });

  it('renders ConfigFlowModal across brand catalog picker, brand detail, repair flow, OAuth, and Camera setup modals', () => {
    const onboarding = buildDemoOnboardingState();
    const names = Object.fromEntries(onboarding.catalog.map((c) => [c.domain, c.title]));
    const brandCatalog = buildBrandIntegrationCatalog(
      onboarding.catalog.map((c) => c.domain),
      names,
      onboarding.ecosystemApps,
    );
    const repairStep = startDemoConfigFlow('zha', 'Zigbee Home', {
      repair: { domain: 'zha', issue_id: 'zigbee_channel_overlap' },
    });

    const pickerHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ConfigFlowModal, {
          title: 'Connect an integration',
          step: null,
          catalog: onboarding.catalog,
          brandCatalog,
          pickerQuery: '',
          values: {},
          fieldErrors: {},
          onPickerQueryChange: () => undefined,
          onStartDomain: () => undefined,
          onChangeValues: () => undefined,
          onSubmitForm: () => undefined,
          onSelectMenu: () => undefined,
          onOpenExternalUrl: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(pickerHtml).toContain('CONNECT YOUR HOME');
    expect(pickerHtml).toContain('All Brands');
    expect(pickerHtml).toContain('Homebridge');
    expect(pickerHtml).toContain('Scrypted');
    expect(pickerHtml).toContain('Haus Govee');
    expect(pickerHtml).toContain('flow-picker-alpha-trigger');
    expect(pickerHtml).toContain('brand-icon-tile');

    // Target error state must NOT dump the integration catalog picker underneath
    const targetErrorHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ConfigFlowModal, {
          title: 'Indoor Cam E220-6CBC',
          target: {
            flowId: 'comm_disc_cam',
            domain: 'homekit_controller',
            title: 'Indoor Cam E220-6CBC',
          },
          step: null,
          catalog: onboarding.catalog,
          brandCatalog,
          pickerQuery: '',
          values: {},
          fieldErrors: {},
          error: 'This discovered device is no longer waiting for automatic pairing.',
          onPickerQueryChange: () => undefined,
          onStartDomain: () => undefined,
          onChangeValues: () => undefined,
          onSubmitForm: () => undefined,
          onSelectMenu: () => undefined,
          onOpenExternalUrl: () => undefined,
          onRetry: () => undefined,
          onBrowseAll: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(targetErrorHtml).toContain('Indoor Cam E220-6CBC');
    expect(targetErrorHtml).toContain('flow-target-retry');
    expect(targetErrorHtml).toContain('flow-target-browse');
    expect(targetErrorHtml).not.toContain('flow-picker-search');

    // A-Z semantic zoom overlay shows letter tiles with integration counts
    const alphaHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(IntegrationAlphabetOverlay, {
          sectionCounts: new Map([
            ['A', 120],
            ['H', 42],
            ['T', 18],
          ]),
          activeLetter: 'H',
          selectedLetter: null,
          onPickLetter: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(alphaHtml).toContain('Jump to letter');
    expect(alphaHtml).toContain('flow-picker-letter-tile-A');
    expect(alphaHtml).toContain('flow-picker-letter-tile-H');
    expect(alphaHtml).toContain('120');
    expect(alphaHtml).toContain('42');

    const repairHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(ConfigFlowModal, {
          title: 'Zigbee Home',
          target: { domain: 'zha', repair: { domain: 'zha', issue_id: 'zigbee_channel_overlap' } },
          step: repairStep,
          catalog: onboarding.catalog,
          pickerQuery: '',
          values: { channel: '25', backup_first: true },
          fieldErrors: {},
          onPickerQueryChange: () => undefined,
          onStartDomain: () => undefined,
          onChangeValues: () => undefined,
          onSubmitForm: () => undefined,
          onSelectMenu: () => undefined,
          onOpenExternalUrl: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(repairHtml).toContain('REPAIR INTEGRATION');
    expect(repairHtml).toContain('Target Zigbee channel');
    expect(repairHtml).toContain('Apply fix');
    expect(repairHtml).toContain('flow-header-docs');

    const cameraHtml = renderToStaticMarkup(
      React.createElement(
        HausUiProvider,
        { mode: 'dark' },
        React.createElement(CameraSetupModal, {
          existingCameraCount: 2,
          onChooseApps: () => undefined,
          onChooseFindBrand: () => undefined,
          onChooseExisting: () => undefined,
          onChooseManual: () => undefined,
          onClose: () => undefined,
        }),
        React.createElement(ManualCameraSetupModal, {
          mode: 'manual',
          rooms: [{ id: 'front', name: 'Front Yard' }],
          onBack: () => undefined,
          onSubmitManual: () => undefined,
          onSubmitExisting: () => undefined,
          onClose: () => undefined,
        }),
      ),
    );
    expect(cameraHtml).toContain('ADD CAMERA');
    expect(cameraHtml).toContain('A little peace of mind.');
    expect(cameraHtml).toContain('Use an existing camera');
    expect(cameraHtml).toContain('CUSTOM CAMERA');
    expect(cameraHtml).toContain('Live stream URL');
  });

  it('derives coherent dark and light palettes with pure black backdrops from one Theme definition', () => {
    const hausDark = Theme.default.forAppearance('dark');
    const hausLight = Theme.default.forAppearance('light');

    const darkBackdrop = resolveColorToSrgb(hausDark.color('backdrop'), hausDark);
    const lightBackdrop = resolveColorToSrgb(hausLight.color('backdrop'), hausLight);
    const darkDim = resolveColorToSrgb(hausDark.color('backdropDim'), hausDark);
    expect(darkBackdrop.slice(0, 3)).toEqual([0, 0, 0]);
    expect(lightBackdrop.slice(0, 3)).toEqual([0, 0, 0]);
    expect(darkDim.slice(0, 3)).toEqual([0, 0, 0]);
    expect(darkBackdrop[3]).toBeGreaterThan(0.4);
    expect(lightBackdrop[3]).toBeGreaterThan(0.2);

    const warm = Theme.preset('warm');
    const warmDarkVars = resolveThemeCssVariables(warm, 'dark');
    const warmLightVars = resolveThemeCssVariables(warm, 'light');
    expect(warmDarkVars['--haus-backdrop']).toMatch(/^rgba\(0, 0, 0,/);
    expect(warmLightVars['--haus-backdrop']).toMatch(/^rgba\(0, 0, 0,/);
    expect(warmDarkVars['--haus-surface']).not.toBe(warmLightVars['--haus-surface']);
    expect(warmDarkVars['--haus-text-primary']).not.toBe(warmLightVars['--haus-text-primary']);

    const extended = warm.extend({
      id: 'warm-custom',
      accent: { mode: 'chromatic', hue: 140, chroma: 0.16 },
    });
    expect(extended.id).toBe('warm-custom');
    expect(
      resolveColorToSrgb(extended.color('accent', 'dark'), extended.forAppearance('dark')),
    ).not.toEqual(resolveColorToSrgb(warm.color('accent', 'dark'), warm.forAppearance('dark')));
  });
});
