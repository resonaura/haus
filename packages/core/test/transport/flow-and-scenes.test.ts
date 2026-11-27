/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  CameraMetadataCache,
  HomeCache,
  isLocalServerHostname,
  normalizeServerUrl,
  validateExternalUrl,
  validateHubDesktopRpcCommand,
  validatePreferences,
} from '../../src/hub/index.js';
import {
  captureSceneTarget,
  compileAutomationFlow,
  describeAutomationCard,
  instantiateAutomationTemplate,
  parseAutomationFlow,
  patchSceneTarget,
  replaceSceneEntity,
  resolveSceneTargetVisual,
  transferSceneTarget,
} from '../../src/transport/index.js';

describe('@haus/core/hub desktop & cache utilities', () => {
  it('deduplicates short-lived camera capability metadata and evicts rejections', async () => {
    let now = 1000;
    let calls = 0;
    const cache = new CameraMetadataCache(() => now);
    const msg = { type: 'camera/capabilities', entity_id: 'camera.porch' };

    const [a, b] = await Promise.all([
      cache.request(msg, async () => ({ seq: ++calls })),
      cache.request(msg, async () => ({ seq: ++calls })),
    ]);
    expect(a).toEqual({ seq: 1 });
    expect(b).toEqual({ seq: 1 });

    now += 31_000;
    const c = await cache.request(msg, async () => ({ seq: ++calls }));
    expect(c).toEqual({ seq: 2 });
  });

  it('persists complete HomeCache snapshots and rejects partial topology', async () => {
    let persisted: unknown = null;
    let scope: string | undefined = 'scope-hub-1';
    const cache = new HomeCache(
      {
        loadHomeCache: async () => persisted,
        saveHomeCache: async (val) => {
          persisted = val;
        },
      },
      () => scope,
    );

    cache.record('get_states', [
      { entity_id: 'light.lamp', state: 'on', attributes: { friendly_name: 'Lamp' } },
    ]);
    cache.record('get_config', { location_name: 'Willow House' });
    cache.record('get_services', { light: { turn_on: {} } });
    cache.record('auth/current_user', { name: 'Alex', is_admin: true });
    cache.record('config/area_registry/list', [{ area_id: 'living', name: 'Living Room' }]);
    cache.record('config/device_registry/list', [{ id: 'dev-1', name: 'Lamp' }]);
    cache.record('config/entity_registry/list', [{ entity_id: 'light.lamp', device_id: 'dev-1' }]);

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(persisted).toBeTruthy();

    const loaded = await cache.load();
    expect(loaded?.snapshot).toMatchObject({
      config: { location_name: 'Willow House' },
    });

    scope = 'other-scope';
    expect(await cache.load()).toBeNull();
  });

  it('validates local URLs, external links, preferences, and Hub desktop RPC commands', () => {
    expect(isLocalServerHostname('192.168.1.44')).toBe(true);
    expect(isLocalServerHostname('haus-hub.local')).toBe(true);
    expect(isLocalServerHostname('::1')).toBe(true);
    expect(isLocalServerHostname('example.com')).toBe(false);

    expect(normalizeServerUrl('192.168.1.44:8790', 'Haus Hub')).toBe('http://192.168.1.44:8790');
    expect(() => normalizeServerUrl('http://remote.example.com:8790', 'Haus Hub')).toThrow();

    expect(validatePreferences({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(validateExternalUrl('http://192.168.1.20/ui')).toBe('http://192.168.1.20/ui');

    expect(
      validateHubDesktopRpcCommand({ type: 'apps/logs', appId: 'homebridge-govee', tail: 200 }),
    ).toEqual({
      type: 'apps/logs',
      appId: 'homebridge-govee',
      tail: 200,
    });
    expect(() =>
      validateHubDesktopRpcCommand({ type: 'apps/logs', appId: '../bad' }),
    ).toThrow();
  });
});

describe('@haus/core/transport shared Scene & Automation flow models', () => {
  it('captures, patches, visualizes, and transfers scene targets across device capabilities', () => {
    const warmLight = {
      entity_id: 'light.pendant',
      state: 'on',
      attributes: {
        friendly_name: 'Pendant',
        brightness: 204,
        color_temp_kelvin: 2700,
        color_mode: 'color_temp',
        supported_color_modes: ['color_temp', 'rgb'],
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
      },
    };
    const captured = captureSceneTarget(warmLight);
    expect(captured).toMatchObject({
      state: 'on',
      brightness: 204,
      color_temp_kelvin: 2700,
      color_mode: 'color_temp',
    });

    const patchedRgb = patchSceneTarget(captured, 'rgb_color', [255, 140, 80]);
    expect(patchedRgb.color_temp_kelvin).toBeUndefined();
    expect(patchedRgb.color_mode).toBe('rgb');
    expect(patchedRgb.rgb_color).toEqual([255, 140, 80]);

    const visual = resolveSceneTargetVisual('light.pendant', warmLight, captured);
    expect(visual.active).toBe(true);
    expect(visual.brightnessPct).toBe(80);
    expect(visual.hasBrightness).toBe(true);
    expect(visual.hasTemperature).toBe(true);
    expect(visual.hasColor).toBe(true);

    const rgbOnlyStrip = {
      entity_id: 'light.desk_strip',
      state: 'off',
      attributes: {
        supported_color_modes: ['rgb'],
      },
    };
    const transferred = transferSceneTarget(captured, rgbOnlyStrip);
    expect(transferred.state).toBe('on');
    expect(transferred.brightness).toBe(204);
    expect(transferred.color_mode).toBe('rgb');
    expect(Array.isArray(transferred.rgb_color)).toBe(true);

    const replaced = replaceSceneEntity(
      { 'light.old_missing': captured },
      'light.old_missing',
      rgbOnlyStrip,
    );
    expect(replaced['light.old_missing']).toBeUndefined();
    expect(replaced['light.desk_strip']).toBeTruthy();
  });

  it('round-trips automation flows (When -> If -> Do) and preserves migration metadata', () => {
    const originalConfig = {
      alias: 'Motion Nightlight',
      description: 'Guide light after dark',
      mode: 'restart',
      initial_state: false,
      _hausMigration: { source: 'home_assistant', sourceEntityId: 'automation.hall_night' },
      triggers: [{ trigger: 'time', at: '07:30:00' }],
      conditions: [
        { condition: 'time', weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] },
        { condition: 'sun', after: 'sunset', before: 'sunrise' },
      ],
      actions: [
        {
          action: 'light.turn_on',
          target: { entity_id: 'light.hallway' },
          data: { brightness: 51, color_temp_kelvin: 2200 },
        },
        {
          action: 'lock.lock',
          target: { entity_id: 'lock.front_door' },
        },
        { delay: { minutes: 2 } },
        {
          action: 'scene.turn_on',
          target: { entity_id: 'scene.sleep' },
        },
      ],
    };

    const draft = parseAutomationFlow(originalConfig);
    expect(draft.triggers).toHaveLength(1);
    expect(draft.triggers[0]).toMatchObject({
      kind: 'time',
      at: '07:30',
      weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    });
    expect(draft.conditions).toHaveLength(1);
    expect(draft.conditions[0]).toMatchObject({
      kind: 'sun',
      after: 'sunset',
      before: 'sunrise',
    });
    expect(draft.steps).toHaveLength(3);
    expect(draft.steps[0]).toMatchObject({
      kind: 'control_devices',
      targets: {
        'light.hallway': { state: 'on', brightness: 51, color_temp_kelvin: 2200 },
        'lock.front_door': { state: 'locked' },
      },
    });
    expect(draft.steps[1]).toMatchObject({ kind: 'wait', seconds: 120 });
    expect(draft.steps[2]).toMatchObject({ kind: 'activate_scene', sceneEntityId: 'scene.sleep' });

    const recompiled = compileAutomationFlow(draft);
    expect(recompiled._hausMigration).toEqual(originalConfig._hausMigration);
    expect(recompiled.initial_state).toBe(false);
    expect(recompiled.triggers).toEqual([{ trigger: 'time', at: '07:30:00' }]);
    expect(recompiled.conditions).toEqual([
      { condition: 'time', weekday: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      { condition: 'sun', after: 'sunset', before: 'sunrise' },
    ]);

    const card = describeAutomationCard(recompiled, 'Motion Nightlight', (id) =>
      id === 'light.hallway' ? 'Hallway' : id,
    );
    expect(card.categoryLabel).toBe('Schedule');
    expect(card.whenText).toBe('At 07:30 · weekdays');
    expect(card.doText).toContain('Set 2 accessories');

    const tpl = instantiateAutomationTemplate('good_morning', {
      lightEntityIds: ['light.kitchen'],
      coverEntityIds: ['cover.blinds'],
    });
    expect(tpl.alias).toBe('Good Morning');
    expect(Array.isArray(tpl.actions) && tpl.actions.length).toBe(2);
  });

  it('supports Philips Hue switches (event.received, HA device triggers, event.* state) and generic bus events', () => {
    // 1. Haus Hub event.received on Hue Dimmer button
    const hubHueConfig = {
      alias: 'Living Room Dimmer On',
      description: '',
      mode: 'restart',
      triggers: [
        {
          trigger: 'event.received',
          target: { entity_id: 'event.hue_dimmer_button_1' },
          options: { event_type: ['short_release', 'long_release'] },
        },
      ],
      conditions: [],
      actions: [{ action: 'scene.turn_on', target: { entity_id: 'scene.movie_time' } }],
    };

    const hubDraft = parseAutomationFlow(hubHueConfig);
    expect(hubDraft.triggers[0]).toEqual({
      id: 'when-0',
      kind: 'button_event',
      entityId: 'event.hue_dimmer_button_1',
      eventTypes: ['short_release', 'long_release'],
    });
    const compiledHub = compileAutomationFlow(hubDraft, { targetPlatform: 'hub' });
    expect(compiledHub.triggers).toEqual(hubHueConfig.triggers);

    const hueCard = describeAutomationCard(compiledHub, 'Living Room Dimmer On', (id) =>
      id === 'event.hue_dimmer_button_1'
        ? 'Hue Dimmer · Button 1 · On'
        : id === 'scene.movie_time'
          ? 'Movie time'
          : id,
    );
    expect(hueCard.iconHint).toBe('toggle-left');
    expect(hueCard.categoryLabel).toBe('Switch');
    expect(hueCard.compactSummary).toBe('Short press / Release after hold');
    expect(hueCard.whenText).toBe('Hue Dimmer · Button 1 · On · Short press / Release after hold');
    expect(hueCard.doText).toBe('Run "Movie time"');

    // 2. Home Assistant Hue device trigger + multi-gesture coalescing
    const haHueDeviceConfig = {
      alias: 'Bedroom Hue Switch',
      triggers: [
        {
          trigger: 'device',
          domain: 'hue',
          device_id: 'hue_dev_42',
          type: 'initial_press',
          subtype: 1,
        },
        {
          trigger: 'device',
          domain: 'hue',
          device_id: 'hue_dev_42',
          type: 'short_release',
          subtype: 1,
        },
      ],
      actions: [{ action: 'light.turn_on', target: { entity_id: 'light.bedroom' } }],
    };
    const haHueDraft = parseAutomationFlow(haHueDeviceConfig, {
      resolveDeviceEventEntity: ({ deviceId, subtype }) =>
        deviceId === 'hue_dev_42' && subtype === '1'
          ? 'event.bedroom_hue_button_1'
          : undefined,
    });
    expect(haHueDraft.triggers).toHaveLength(1);
    expect(haHueDraft.triggers[0]).toEqual({
      id: 'when-0',
      kind: 'button_event',
      entityId: 'event.bedroom_hue_button_1',
      eventTypes: ['initial_press', 'short_release'],
      haDeviceTrigger: { domain: 'hue', deviceId: 'hue_dev_42', subtype: '1' },
    });
    const compiledHaHue = compileAutomationFlow(haHueDraft, { targetPlatform: 'ha' });
    expect(compiledHaHue.triggers).toEqual([
      { trigger: 'device', domain: 'hue', device_id: 'hue_dev_42', type: 'initial_press', subtype: '1' },
      { trigger: 'device', domain: 'hue', device_id: 'hue_dev_42', type: 'short_release', subtype: '1' },
    ]);

    // 3. Home Assistant generic event.* entity state + event_type condition round-trip
    const compiledHaEventEntity = compileAutomationFlow(hubDraft, { targetPlatform: 'ha' });
    expect(compiledHaEventEntity.triggers).toEqual([
      {
        trigger: 'state',
        entity_id: 'event.hue_dimmer_button_1',
        not_from: ['unavailable', 'unknown'],
      },
    ]);
    expect(compiledHaEventEntity.conditions).toEqual([
      {
        condition: 'state',
        entity_id: 'event.hue_dimmer_button_1',
        attribute: 'event_type',
        state: ['short_release', 'long_release'],
      },
    ]);
    const reparsedHaEvent = parseAutomationFlow(compiledHaEventEntity);
    expect(reparsedHaEvent.triggers[0]).toEqual({
      id: 'when-0',
      kind: 'button_event',
      entityId: 'event.hue_dimmer_button_1',
      eventTypes: ['short_release', 'long_release'],
    });
    expect(reparsedHaEvent.conditions).toEqual([]);

    // 4. Generic bus event (hue_event / zha_event)
    const busEventConfig = {
      alias: 'Hue Bus Event',
      triggers: [
        {
          trigger: 'event',
          event_type: 'hue_event',
          event_data: { id: 'hallway_switch', subtype: 2, type: 'short_release' },
        },
      ],
      actions: [{ action: 'light.turn_off', target: { entity_id: 'light.hallway' } }],
    };
    const busDraft = parseAutomationFlow(busEventConfig);
    expect(busDraft.triggers[0]).toEqual({
      id: 'when-0',
      kind: 'bus_event',
      eventType: 'hue_event',
      eventData: { id: 'hallway_switch', subtype: 2, type: 'short_release' },
    });
    expect(compileAutomationFlow(busDraft).triggers).toEqual(busEventConfig.triggers);

    // 5. Switch button starter template binds discovered button entity
    const switchTpl = instantiateAutomationTemplate('switch_button', {
      buttonEventEntityIds: ['event.hue_dimmer_button_1'],
      sceneEntityIds: ['scene.movie_time'],
      targetPlatform: 'hub',
    });
    expect(switchTpl.triggers).toEqual([
      {
        trigger: 'event.received',
        target: { entity_id: 'event.hue_dimmer_button_1' },
        options: { event_type: ['short_release'] },
      },
    ]);
  });
});
