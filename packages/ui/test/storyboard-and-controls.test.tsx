/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveNamedScenePalette } from '@haus/core/transport';
import {
  ANSI_TERMINAL_SWATCHES,
  AutomationTile,
  ButtonRemoteModalPanel,
  ClimateModalPanel,
  CoverModalPanel,
  FanModalPanel,
  HAUS_ASCII_LOGO_LINES,
  HausComponentStoryboard,
  isStoryboardToggleShortcut,
  LightModalPanel,
  LockModalPanel,
  MediaModalPanel,
  RoomsManagerView,
  SceneCard,
  SceneCardCollection,
  SensorValueModalPanel,
  SwitchActionModalPanel,
} from '../src/components/index.js';
import { HausSlider, HausSwitch, HausUiProvider } from '../src/primitives/index.js';
import { SLIDER_SIZES, SWITCH_SIZES } from '../src/styles/controls.js';

describe('HeroUI-styled HausSwitch & HausSlider, Unified Scenes, Device Modals & Storyboard', () => {
  it('configures elongated capsule switches and thick pill sliders with nested capsule thumbs', () => {
    expect(SWITCH_SIZES.md).toEqual({
      width: 46,
      height: 24,
      thumbWidth: 22,
      thumbHeight: 18,
      pad: 3,
    });
    expect(SLIDER_SIZES.md).toEqual({
      trackHeight: 22,
      thumbWidth: 22,
      thumbHeight: 16,
      pad: 3,
      minFill: 28,
    });

    const html = renderToStaticMarkup(
      <HausUiProvider mode="dark">
        <HausSwitch id="sw-1" checked label="Enable notifications" />
        <HausSlider id="sl-1" label="Volume" valueLabel="30" value={30} min={0} max={100} />
      </HausUiProvider>,
    );
    expect(html).toContain('Enable notifications');
    expect(html).toContain('Volume');
    expect(html).toContain('30');
    expect(html).not.toContain('translate3d(0px, -2px, 0)');
  });

  it('eliminates card hover translateY lift across AutomationTile, RoomsManagerView, and SceneCard', () => {
    const html = renderToStaticMarkup(
      <HausUiProvider mode="dark">
        <AutomationTile
          item={{
            entityId: 'automation.switch_1',
            ruleId: 'switch_1',
            name: 'Bedroom Switch 1',
            statusLabel: 'Active',
            enabled: true,
            toggleDisabled: false,
            canEdit: true,
            needsCutover: false,
            cuttingOver: false,
          }}
          onEdit={() => undefined}
          onToggle={() => undefined}
          onCutover={() => undefined}
        />
        <RoomsManagerView
          rooms={[{ id: 'bed', name: 'Bedroom', iconId: 'bed', iconName: 'bed-double', deviceCount: 4 }]}
          iconOptions={[]}
          query=""
          unassignedCount={1}
          canManage
          hasAnyRooms
          onQueryChange={() => undefined}
          onCreateRoom={() => undefined}
          onOpenDevices={() => undefined}
          onOpenRoom={() => undefined}
          onChangeIcon={() => undefined}
          onAddDevices={() => undefined}
          onEditRoom={() => undefined}
          onDeleteRoom={() => undefined}
        />
        <SceneCard
          name="Netflix And Chill"
          title="Netflix And Chill"
          room="Bedroom"
          source="Hue"
          colors={['#e50914', '#ff5a36']}
          count={4}
          showAccessoryCount={false}
          onActivate={() => undefined}
        />
      </HausUiProvider>,
    );
    expect(html).toContain('min-height:138px');
    expect(html).toContain('scene-source-inline');
    expect(html).not.toContain('178px');
  });

  it('renders unified horizontal SceneCardCollection rail and resolves Hue scene palettes', () => {
    const aurora = resolveNamedScenePalette('Arctic Aurora', 'scene.bedroom_arctic_aurora', true);
    const customHue = resolveNamedScenePalette('Evening Vibe', 'scene.bedroom_evening_vibe', true);
    expect(aurora?.colors.length).toBeGreaterThanOrEqual(3);
    expect(customHue?.colors.length).toBeGreaterThanOrEqual(3);

    const railHtml = renderToStaticMarkup(
      <HausUiProvider mode="dark">
        <SceneCardCollection
          horizontal
          showAccessoryCount={false}
          items={[
            {
              entityId: 'scene.bedroom_arctic_aurora',
              name: 'Arctic Aurora',
              title: 'Arctic Aurora',
              room: 'Bedroom',
              source: 'Hue',
              colors: aurora?.colors ?? [],
              count: 4,
              onActivate: () => undefined,
            },
          ]}
        />
      </HausUiProvider>,
    );
    expect(railHtml).toContain('Arctic Aurora');
    expect(railHtml).toContain('width:288px');
  });

  it('renders unified device modal panels across all device categories', () => {
    const html = renderToStaticMarkup(
      <HausUiProvider mode="dark">
        <LightModalPanel
          idPrefix="l1"
          deviceName="Lamp"
          active
          brightnessPct={80}
          rgb={[255, 180, 90]}
          hue={34}
          saturation={65}
          kelvin={2700}
          canToggle
          canBrightness
          canColor
          canTemperature
          disabled={false}
          presets={[{ name: 'Warm', hex: '#ffb45a', rgb: [255, 180, 90] }]}
          onToggle={() => undefined}
          onBrightness={() => undefined}
          onColorRgb={() => undefined}
          onColorHsv={() => undefined}
          onTemperature={() => undefined}
        />
        <ClimateModalPanel
          idPrefix="c1"
          mode="heat"
          modes={[
            { value: 'off', label: 'Off' },
            { value: 'heat', label: 'Heat' },
          ]}
          currentTempLabel="21.5°C"
          targetTemp={22}
          canSetTemperature
          canSetMode
          disabled={false}
          onTargetTemp={() => undefined}
          onModeChange={() => undefined}
        />
        <CoverModalPanel
          idPrefix="cv1"
          position={50}
          stateLabel="Open"
          canPosition
          canOpen
          canStop
          canClose
          disabled={false}
        />
        <LockModalPanel
          idPrefix="lk1"
          deviceName="Front Door"
          locked
          canToggle
          disabled={false}
          onConfirmAction={() => undefined}
        />
        <FanModalPanel
          idPrefix="fn1"
          active
          percentage={60}
          canToggle
          canPercentage
          disabled={false}
          onToggle={() => undefined}
          onPercentage={() => undefined}
        />
        <SwitchActionModalPanel
          idPrefix="sw1"
          kind="toggle"
          active
          stateLabel="On"
          metrics={[{ label: 'Power', value: '42 W' }]}
          disabled={false}
          onActivate={() => undefined}
        />
        <MediaModalPanel
          idPrefix="mp1"
          title="Track"
          subtitle="Artist"
          playing
          poweredOn
          volumePct={30}
          canPrevious
          canPlayPause
          canNext
          canPower
          canVolume
          canRemote={false}
          disabled={false}
        />
        <ButtonRemoteModalPanel
          buttons={[{ id: 'b1', label: 'Button 1', gestures: ['short release'] }]}
        />
        <SensorValueModalPanel idPrefix="sn1" reading="23.4 °C" />
      </HausUiProvider>,
    );
    expect(html).toContain('White warmth');
    expect(html).toContain('Thermostat');
    expect(html).toContain('Shade aperture');
    expect(html).toContain('Secured');
    expect(html).toContain('Airflow speed');
    expect(html).toContain('42 W');
    expect(html).toContain('Button 1');
    expect(html).toContain('23.4 °C');
  });

  it('renders HausComponentStoryboard starting with console, Haus ASCII logo, and 2x8 ANSI color blocks', () => {
    expect(HAUS_ASCII_LOGO_LINES.length).toBeGreaterThanOrEqual(10);
    expect(ANSI_TERMINAL_SWATCHES).toHaveLength(2);
    expect(ANSI_TERMINAL_SWATCHES[0]).toHaveLength(8);
    expect(ANSI_TERMINAL_SWATCHES[1]).toHaveLength(8);

    expect(isStoryboardToggleShortcut({ key: 'U', metaKey: true, shiftKey: true })).toBe(true);
    expect(isStoryboardToggleShortcut({ key: 'u', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isStoryboardToggleShortcut({ key: '`', altKey: true })).toBe(true);
    expect(isStoryboardToggleShortcut({ key: 'k', metaKey: true })).toBe(false);

    const html = renderToStaticMarkup(
      <HausUiProvider mode="dark">
        <HausComponentStoryboard rendererName="Test Host" onClose={() => undefined} />
      </HausUiProvider>,
    );
    expect(html).toContain('hausfetch');
    expect(html).toContain('H · A · U · S');
    expect(html).toContain('haus@design-system.local');
    expect(html).toContain('storyboard-ansi-palette');
  });
});
