/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AutomationEditorScreen,
  AutomationsGalleryView,
  HausUiProvider,
  RoomsManagerView,
  SceneEditorModal,
  type AutomationButtonControllerChoice,
  type SceneControllableDevice,
} from '../src/index.js';

const SAMPLE_DEVICES: readonly SceneControllableDevice[] = [
  {
    entityId: 'light.living_pendant',
    name: 'Pendant',
    roomId: 'living',
    roomName: 'Living Room',
    category: 'lights',
    entity: {
      entity_id: 'light.living_pendant',
      state: 'on',
      attributes: {
        friendly_name: 'Living Room Pendant',
        brightness: 204,
        color_temp_kelvin: 2800,
        supported_color_modes: ['color_temp', 'rgb'],
      },
    },
    liveStateText: '80%',
    pickerEligible: true,
  },
  {
    entityId: 'lock.front_door',
    name: 'Front Door',
    roomId: 'entry',
    roomName: 'Entryway',
    category: 'security',
    entity: {
      entity_id: 'lock.front_door',
      state: 'locked',
      attributes: { friendly_name: 'Front Door' },
    },
    liveStateText: 'Locked',
    pickerEligible: true,
  },
];

const SAMPLE_HUE_CONTROLLERS: readonly AutomationButtonControllerChoice[] = [
  {
    controllerId: 'hue_dimmer_living',
    deviceId: 'hue_dimmer_living',
    domain: 'hue',
    name: 'Hue Dimmer Switch',
    roomName: 'Living Room',
    model: 'Hue dimmer switch',
    isHue: true,
    buttons: [
      {
        entityId: 'event.hue_dimmer_button_1',
        label: 'Button 1 · On',
        shortLabel: '1',
        kind: 'button',
        eventTypes: ['initial_press', 'repeat', 'short_release', 'long_release'],
        subtype: '1',
      },
      {
        entityId: 'event.hue_dimmer_button_2',
        label: 'Button 2 · Up',
        shortLabel: '2',
        kind: 'button',
        eventTypes: ['initial_press', 'repeat', 'short_release', 'long_release'],
        subtype: '2',
      },
      {
        entityId: 'event.hue_dimmer_button_3',
        label: 'Button 3 · Down',
        shortLabel: '3',
        kind: 'button',
        eventTypes: ['initial_press', 'repeat', 'short_release', 'long_release'],
        subtype: '3',
      },
      {
        entityId: 'event.hue_dimmer_button_4',
        label: 'Button 4 · Off',
        shortLabel: '4',
        kind: 'button',
        eventTypes: ['initial_press', 'repeat', 'short_release', 'long_release'],
        subtype: '4',
      },
    ],
  },
];

describe('@haus/ui unified SceneEditorModal & DeviceTile-based Automations UI', () => {
  it('renders SceneEditorModal with room-grouped DeviceTile cards and unavailable targets', () => {
    const html = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(SceneEditorModal, {
          editing: true,
          demo: false,
          loading: false,
          busy: false,
          canDelete: true,
          advanced: false,
          jsonText: '{}',
          confirmDiscard: false,
          confirmDelete: false,
          nameValue: 'Evening Glow',
          sceneIcon: 'mdi:sparkles',
          entities: {
            'light.living_pendant': { state: 'on', brightness: 180, color_temp_kelvin: 2700 },
            'light.removed_lamp': { state: 'on', brightness: 128 },
          },
          devices: SAMPLE_DEVICES,
          onSetAdvanced() {},
          onNameChange() {},
          onSceneIconChange() {},
          onEntitiesChange() {},
          onJsonChange() {},
          onTestScene() {},
          onRequestClose() {},
          onConfirmDiscard() {},
          onCancelDiscard() {},
          onRequestDelete() {},
          onConfirmDelete() {},
          onCancelDelete() {},
          onSave() {},
        }),
      ),
    );

    expect(html).toContain('Evening Glow');
    expect(html).toContain('Living Room');
    expect(html).toContain('Pendant');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Removed Lamp');
    expect(html).toContain('Test scene');
  });

  it('renders monochrome DeviceTile-adapted AutomationTile cards with Hue switch summaries and zero third-party naming', () => {
    const html = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(AutomationsGalleryView, {
          canCreate: true,
          canImportHa: true,
          items: [
            {
              entityId: 'automation.hue_dimmer_scene',
              ruleId: 'hue_dimmer_scene',
              name: 'Living Room Switch',
              statusLabel: 'Active · Managed by Haus Hub',
              enabled: true,
              toggleDisabled: false,
              canEdit: true,
              needsCutover: false,
              cuttingOver: false,
              config: {
                alias: 'Living Room Switch',
                triggers: [
                  {
                    trigger: 'event.received',
                    target: { entity_id: 'event.hue_dimmer_button_1' },
                    options: { event_type: ['short_release'] },
                  },
                ],
                actions: [
                  {
                    action: 'light.turn_on',
                    target: { entity_id: 'light.living_pendant' },
                    data: { brightness: 204 },
                  },
                ],
              },
            },
          ],
          resolveEntityName: (id: string) => {
            if (id === 'event.hue_dimmer_button_1') return 'Hue Dimmer · Button 1';
            if (id === 'light.living_pendant') return 'Pendant';
            return id;
          },
          onCreate() {},
          onCreateFromTemplate() {},
          onImportHa() {},
          onEdit() {},
          onToggle() {},
          onRun() {},
          onCutover() {},
        }),
      ),
    );

    expect(html).toContain('data-haus-device-tile="shared"');
    expect(html).toContain('data-haus-automation-tile="shared"');
    expect(html).toContain('device-tile-wash');
    expect(html).toContain('Switch Press');
    expect(html).toContain('Good Morning');
    expect(html).toContain('Living Room Switch');
    expect(html).toContain('Active · Short press');
    expect(html).not.toContain('role="switch"');
    const visibleCopy = html.replace(/<[^>]+>/g, ' ').toLowerCase();
    expect(visibleCopy).not.toContain('apple');
    expect(visibleCopy).not.toContain('shortcut');
    expect(html.toLowerCase()).not.toContain('shortcut');
  });

  it('renders dedicated AutomationEditorScreen with Hue switch button/gesture controls, generic Event trigger, and Rooms GlassRim', () => {
    const html = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(AutomationEditorScreen, {
          editing: true,
          demo: false,
          loading: false,
          busy: false,
          canDelete: true,
          advanced: false,
          jsonText: '{}',
          confirmDiscard: false,
          confirmDelete: false,
          config: {
            alias: 'Hue Dimmer Lockup',
            description: 'Button 4 turns off pendant and locks front door',
            mode: 'restart',
            triggers: [
              {
                trigger: 'event.received',
                target: { entity_id: 'event.hue_dimmer_button_4' },
                options: { event_type: ['short_release'] },
              },
              {
                trigger: 'event',
                event_type: 'hue_event',
                event_data: { subtype: 4, type: 'long_release' },
              },
            ],
            conditions: [{ condition: 'sun', after: 'sunset', before: 'sunrise' }],
            actions: [
              { action: 'light.turn_off', target: { entity_id: 'light.living_pendant' } },
              { action: 'lock.lock', target: { entity_id: 'lock.front_door' } },
              { delay: { seconds: 30 } },
            ],
          },
          devices: SAMPLE_DEVICES,
          scenes: [
            {
              entityId: 'scene.night',
              name: 'Goodnight',
              roomName: 'Bedroom',
              icon: 'mdi:weather-night',
            },
          ],
          entityOptions: [
            { value: 'light.living_pendant', label: 'Living Room · Pendant' },
            { value: 'lock.front_door', label: 'Entryway · Front Door' },
          ],
          buttonControllers: SAMPLE_HUE_CONTROLLERS,
          serviceOptions: [{ value: 'light.turn_on', label: 'light · Turn on' }],
          onSetAdvanced() {},
          onConfigChange() {},
          onJsonChange() {},
          onTestActions() {},
          onRequestClose() {},
          onConfirmDiscard() {},
          onCancelDiscard() {},
          onRequestDelete() {},
          onConfirmDelete() {},
          onCancelDelete() {},
          onSave() {},
        }),
      ),
    );

    expect(html).toContain('All automations');
    expect(html).toContain('WHEN → IF → DO');
    expect(html).toContain('Switch / Button');
    expect(html).toContain('Button 1 · On');
    expect(html).toContain('Button 4 · Off');
    expect(html).toContain('Short press');
    expect(html).toContain('Release after hold');
    expect(html).toContain('Hue event (hue_event)');
    expect(html).toContain('ONLY IF');
    expect(html).toContain('STEP 1');
    expect(html).toContain('Set Accessories');
    expect(html).toContain('Pendant');
    expect(html).toContain('Front Door');
    expect(html).toContain('STEP 2');
    expect(html).toContain('Wait · 30 sec');
    const visibleCopy = html.replace(/<[^>]+>/g, ' ').toLowerCase();
    expect(visibleCopy).not.toContain('apple');
    expect(visibleCopy).not.toContain('shortcut');
    expect(html.toLowerCase()).not.toContain('shortcut');

    const roomsHtml = renderToStaticMarkup(
      createElement(
        HausUiProvider,
        { mode: 'dark' },
        createElement(RoomsManagerView, {
          rooms: [
            { id: 'living', name: 'Living Room', iconId: 'sofa', iconName: 'armchair', deviceCount: 6 },
          ],
          iconOptions: [{ id: 'sofa', label: 'Sofa', iconName: 'armchair' }],
          query: '',
          unassignedCount: 2,
          canManage: true,
          hasAnyRooms: true,
          onQueryChange() {},
          onCreateRoom() {},
          onOpenDevices() {},
          onOpenRoom() {},
          onChangeIcon() {},
          onAddDevices() {},
          onEditRoom() {},
          onDeleteRoom() {},
        }),
      ),
    );
    expect(roomsHtml).toContain('Living Room');
    expect(roomsHtml).toContain('data-haus-glass-rim="card"');
  });
});
