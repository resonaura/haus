/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotFoundException } from '@nestjs/common';
import type { HausDevice } from '@haus/core';
import { StandaloneHomeService } from '../../../src/home/home.service.js';
import { RulesController } from '../../../src/home/rules.controller.js';
import { HistoryController } from '../../../src/home/history.controller.js';
import { StatsStore } from '../../../src/stats/stats.store.js';
import { StatsEngine } from '../../../src/stats/stats.engine.js';
import { StatsCollector } from '../../../src/stats/stats.collector.js';
import { StatsService } from '../../../src/stats/stats.service.js';
import { openTestStatsStore } from '../../nest/stats-test-store.js';

describe('StandaloneHomeService stats, endpoint history & rule deletion', () => {
  let tempDir: string;
  let store: StatsStore;
  let engine: StatsEngine;
  let collector: StatsCollector;
  let statsService: StatsService;
  let home: StandaloneHomeService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-home-stats-'));
    store = await openTestStatsStore(join(tempDir, 'stats.sqlite'));
    engine = new StatsEngine(store, {
      buffer: { flushIntervalMs: 10_000, maxBufferSize: 10_000 },
    });
    await engine.initialize();
    collector = new StatsCollector(engine);
    statsService = new StatsService(store, engine);
    home = new StandaloneHomeService(undefined, undefined, collector);
    await home.onModuleInit();
  });

  afterEach(async () => {
    await home.onModuleDestroy();
    collector.stop();
    await engine.stop();
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('ingests numeric device readings into StatsCollector and records state history', async () => {
    const sensor: HausDevice = {
      id: 'dev-climate-sensor',
      source: { instanceId: 'standalone', externalId: 'dev-climate-sensor' },
      name: 'Living Room Sensor',
      category: 'climate',
      connectivity: { protocol: 'virtual' },
      availability: 'online',
      endpoints: [
        {
          id: 'ep-climate',
          name: 'Climate',
          capabilities: [
            { id: 'temperature', kind: 'numeric', readable: true, unit: '°C', operations: ['read'] },
          ],
          readings: {
            temperature: {
              value: 21.5,
              freshness: 'live',
              observedAt: new Date().toISOString(),
            },
          },
        },
      ],
      services: [],
    };
    const lamp: HausDevice = {
      id: 'dev-lamp',
      source: { instanceId: 'standalone', externalId: 'dev-lamp' },
      name: 'Lamp',
      category: 'lighting',
      connectivity: { protocol: 'virtual' },
      availability: 'online',
      endpoints: [
        {
          id: 'ep-lamp',
          name: 'Lamp',
          capabilities: [
            {
              id: 'on_off',
              kind: 'binary',
              readable: true,
              operations: ['read', 'turn_on', 'turn_off'],
            },
          ],
          readings: {},
        },
      ],
      services: [],
    };

    home.registerDevice(sensor);
    home.registerDevice(lamp);
    await engine.flush();

    const nowSec = Math.floor(Date.now() / 1000);
    const initialSeries = await statsService.query({
      statistic_id: 'device.ep-climate.temperature',
      from: nowSec - 60,
      to: nowSec + 60,
    });
    expect(initialSeries.data.map((pt) => pt.value)).toEqual([21.5]);

    await home.updateEndpointState('ep-climate', { temperature: 22.8 });
    await home.executeDeviceCommand('ep-lamp', 'on_off', 'turn_on');
    await home.executeDeviceCommand('ep-lamp', 'on_off', 'turn_off');
    await engine.flush();

    const meta = await statsService.getMetadata({ source: 'device' });
    expect(meta.some((m) => m.statisticId === 'device.ep-climate.temperature')).toBe(true);
    expect(meta.some((m) => m.statisticId === 'device.ep-lamp.on_off')).toBe(true);

    const series = await statsService.query({
      statistic_id: 'device.ep-climate.temperature',
      from: nowSec - 60,
      to: nowSec + 60,
    });
    expect(series.data.at(-1)?.value).toBe(22.8);

    const historyCtrl = new HistoryController(home);
    const nowMs = Date.now();
    const res = historyCtrl.listEndpointHistory(
      'ep-lamp,ep-climate',
      String(nowMs - 60_000),
      String(nowMs + 60_000),
    );
    expect(res.history['ep-lamp']?.map((entry) => entry.state.state)).toEqual(['on', 'off']);
    expect(res.history['ep-climate']?.map((entry) => entry.state.temperature)).toEqual([21.5, 22.8]);
  });

  it('supports deleting scenes/scripts and manually triggering automations via RulesController', async () => {
    const ctrl = new RulesController(home);
    ctrl.registerScene({ id: 'scene-1', name: 'Evening', members: [] });
    ctrl.registerScript({ id: 'script-1', name: 'Routine', steps: [] });
    ctrl.registerAutomation({
      id: 'rule-1',
      name: 'Manual Rule',
      enabled: false,
      triggers: [],
      actions: [],
    });

    const triggered = await ctrl.triggerAutomation('rule-1');
    expect(triggered.execution.sourceKind).toBe('automation');
    expect(triggered.execution.status).toBe('completed');

    expect(ctrl.removeScene('scene-1')).toEqual({ removed: true, id: 'scene-1' });
    expect(home.listScenes()).toEqual([]);
    expect(() => ctrl.removeScene('scene-1')).toThrow(NotFoundException);

    expect(ctrl.removeScript('script-1')).toEqual({ removed: true, id: 'script-1' });
    expect(home.listScripts()).toEqual([]);
    expect(() => ctrl.removeScript('script-1')).toThrow(NotFoundException);
  });
});
