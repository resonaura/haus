/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it, vi } from 'vitest';
import {
  AlertsMonitor,
  applyNotificationUpdate,
  buildCameraMenuOptions,
  buildDeviceMenuOptions,
  classifyNetworkStates,
  collectHistoryEntities,
  extractPrinterSupplies,
  historyChart,
  historyPoints,
  homeNotifications,
  hsvToRgb,
  orderPowerStripOutlets,
  resolveMoveRoomAreaId,
  rgbToHsv,
  searchHomeCatalog,
  separateLightGroupPatch,
  toggleAppVisibilityPatch,
  toggleHomeVisibilityPatch,
} from '../../src/transport/index.js';

const basePrefs = {
  favorites: [],
  hiddenApp: [],
  hiddenHome: [],
  unhiddenApp: [],
  disabledLightGroups: [],
};

const lamp = {
  id: 'light.corner',
  name: 'Corner lamp',
  category: 'lights',
  areaId: 'living',
  primaryEntityId: 'light.corner',
  entityIds: ['light.corner'],
};

describe('@haus/core shared home helpers', () => {
  it('merges notifications, repairs, and pending updates cleanly', () => {
    const updated = applyNotificationUpdate([], {
      type: 'added',
      notifications: { n1: { notification_id: 'n1', title: 'Hello', message: 'World' } },
    });
    const list = homeNotifications(
      [
        {
          entity_id: 'update.hub',
          state: 'on',
          attributes: {
            friendly_name: 'Haus Core',
            installed_version: '1.0',
            latest_version: '1.1',
          },
        },
      ],
      updated,
      [
        {
          domain: 'hue',
          issue_id: 'bridge',
          translation_key: 'pair',
          severity: 'critical',
        },
      ],
      {
        'component.hue.title': 'Hue',
        'component.hue.issues.pair.title': 'Pair Hue bridge',
        'component.hue.issues.pair.description': 'Press link button',
      },
    );
    expect(list.map((entry) => entry.kind)).toEqual(['repair', 'notification', 'update']);
    expect(list[0].title).toBe('Pair Hue bridge');
  });

  it('builds context menu options and toggles visibility patches cleanly', () => {
    const items = buildDeviceMenuOptions({
      primaryEntityId: lamp.primaryEntityId,
      areaId: lamp.areaId,
      capabilities: ['toggle', 'brightness'],
      isActive: true,
      available: true,
      isLightGroup: false,
      areas: [
        { area_id: 'living', name: 'Living Room' },
        { area_id: 'bedroom', name: 'Bedroom' },
      ],
      isAdmin: true,
      isFavorite: false,
      isHomeHidden: false,
      isAppHidden: false,
    });
    expect(items.some((item) => item.id === 'quick' && item.label === 'Turn Off')).toBe(true);
    expect(resolveMoveRoomAreaId('move-room:unassigned')).toBeNull();
    expect(resolveMoveRoomAreaId('move-room:bedroom')).toBe('bedroom');

    const cameraItems = buildCameraMenuOptions({
      isHomeHidden: false,
      isAppHidden: false,
      index: 0,
      total: 2,
    });
    expect(cameraItems.some((item) => item.id === 'later' && item.enabled)).toBe(true);

    const homeHide = toggleHomeVisibilityPatch(lamp, [lamp], basePrefs);
    expect(homeHide.hidden).toBe(true);
    expect(homeHide.patch.hiddenHome).toEqual(['light.corner']);

    const appHide = toggleAppVisibilityPatch(lamp, [lamp], basePrefs);
    expect(appHide.hidden).toBe(true);
    expect(appHide.patch.hiddenApp).toEqual(['light.corner']);

    expect(separateLightGroupPatch('living:lamps', basePrefs).disabledLightGroups).toEqual([
      'living:lamps',
    ]);
  });

  it('polls Hub pairing requests via AlertsMonitor and filters Spotlight catalog', async () => {
    const management = vi.fn().mockResolvedValue({
      requests: [{ sessionId: 's1', challengeCode: '12345678' }],
    });
    const monitor = new AlertsMonitor({
      connected: true,
      supportsPairingRequests: true,
      request: vi.fn().mockResolvedValue([]),
      management,
    });
    await monitor.refresh();
    expect(monitor.getSnapshot().activePairing?.challengeCode).toBe('12345678');

    const results = searchHomeCatalog({
      query: 'corner',
      rooms: [{ id: 'living', name: 'Living Room', deviceCount: 1 }],
      categories: [{ id: 'lights', name: 'Lights' }],
      accessories: [lamp],
      cameras: [],
      scenes: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0].target.kind).toBe('device');
  });

  it('normalizes device history, color conversions, and specialty device entities', () => {
    const now = Date.now();
    const pts = historyPoints(
      [
        { s: '20.5', lu: Math.floor((now - 3600_000) / 1000) },
        { s: '22.0', lu: Math.floor(now / 1000) },
      ],
      now - 7200_000,
      now,
    );
    expect(pts).toHaveLength(2);
    const chart = historyChart(pts, now - 7200_000, now);
    expect(chart.count).toBe(2);
    expect(chart.low).toBe(20.5);
    expect(chart.high).toBe(22);

    const rgb = hsvToRgb(240, 100, 100);
    expect(rgb).toEqual([0, 0, 255]);
    expect(rgbToHsv(...rgb)).toEqual([240, 100, 100]);

    const supplies = extractPrinterSupplies(
      [{ entity_id: 'sensor.hp_cyan_ink', state: '64', attributes: { friendly_name: 'HP Cyan Ink' } }],
      'HP',
    );
    expect(supplies[0]).toMatchObject({ label: 'Cyan Ink', percentage: 64, colorHex: '#06b6d4' });

    const outlets = orderPowerStripOutlets(
      [
        { entity_id: 'switch.strip_all', state: 'on', attributes: { haus_outlet_role: 'master' } },
        { entity_id: 'switch.strip_1', state: 'off', attributes: { friendly_name: 'Strip Desk' } },
      ],
      'Strip',
    );
    expect(outlets.map((o) => o.label)).toEqual(['Desk', 'All Outlets']);

    const net = classifyNetworkStates(
      { entity_id: 'binary_sensor.router_status', state: 'on', attributes: { device_class: 'connectivity' } },
      [
        { entity_id: 'sensor.router_download_speed', state: '420', attributes: { friendly_name: 'Download speed' } },
        { entity_id: 'button.router_restart', state: 'unknown', attributes: { friendly_name: 'Restart' } },
      ],
    );
    expect(net.downloadSpeedEntity?.state).toBe('420');
    expect(net.buttonEntities).toHaveLength(1);

    const histEntities = collectHistoryEntities([
      { entity_id: 'sensor.temp', state: '21', attributes: {} },
      { entity_id: 'sensor.camera_stream_url', state: 'http://x', attributes: {} },
    ]);
    expect(histEntities.map((item) => item.entity_id)).toEqual(['sensor.temp']);
  });
});
