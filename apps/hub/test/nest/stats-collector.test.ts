/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StatsStore } from '../../src/stats/stats.store.js';
import { StatsEngine } from '../../src/stats/stats.engine.js';
import { StatsCollector } from '../../src/stats/stats.collector.js';

describe('StatsCollector Universal Ingestion Suite', () => {
  let tempDir: string;
  let dbPath: string;
  let store: StatsStore;
  let engine: StatsEngine;
  let collector: StatsCollector;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-stats-collector-'));
    dbPath = join(tempDir, 'hub-stats-collector.sqlite');
    store = new StatsStore(dbPath);
    engine = new StatsEngine(store, {
      buffer: { flushIntervalMs: 10_000, maxBufferSize: 50_000 },
    });
    collector = new StatsCollector(engine);
  });

  afterEach(async () => {
    collector.stop();
    engine.stop();
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('correctly infers metric options and units across domains', () => {
    const tempOpts = collector.inferMetadataOptions('sensor.kitchen_temp');
    expect(tempOpts.source).toBe('device');
    expect(tempOpts.kind).toBe('gauge');
    expect(tempOpts.unit).toBe('°C');

    const cpuOpts = collector.inferMetadataOptions('system.node1.cpu_usage_percent');
    expect(cpuOpts.source).toBe('system');
    expect(cpuOpts.kind).toBe('gauge');
    expect(cpuOpts.unit).toBe('%');

    const rxOpts = collector.inferMetadataOptions('system.node1.network_rx_bytes');
    expect(rxOpts.source).toBe('system');
    expect(rxOpts.kind).toBe('counter');
    expect(rxOpts.unit).toBe('B');

    const lqiOpts = collector.inferMetadataOptions('radio.zigbee.light1.lqi');
    expect(lqiOpts.source).toBe('radio');
    expect(lqiOpts.kind).toBe('gauge');
    expect(lqiOpts.unit).toBe('lqi');

    const autoOpts = collector.inferMetadataOptions('automation.night_lights.duration_ms');
    expect(autoOpts.source).toBe('automation');
    expect(autoOpts.kind).toBe('gauge');
    expect(autoOpts.unit).toBe('ms');
  });

  it('ingests device numeric, boolean, and state telemetry', () => {
    collector.ingestDeviceReading('thermostat1', 'temperature', 23.4, '°C', 1700000000);
    collector.ingestDeviceReading('switch1', 'power_state', true, undefined, 1700000001);
    collector.ingestDeviceReading('meter1', 'energy_total', 152.8, 'kWh', 1700000002);

    expect(engine.pendingBufferCount).toBe(3);
    engine.flush();

    const tempMeta = store.getMetadata('device.thermostat1.temperature');
    expect(tempMeta).not.toBeNull();
    expect(tempMeta?.kind).toBe('gauge');
    expect(tempMeta?.unit).toBe('°C');

    const switchMeta = store.getMetadata('device.switch1.power_state');
    expect(switchMeta).not.toBeNull();
    expect(switchMeta?.kind).toBe('state');

    const tempSamples = store.queryRawSamples(tempMeta!.id, 1700000000, 1700000000);
    expect(tempSamples.length).toBe(1);
    expect(tempSamples[0].value).toBe(23.4);

    const switchSamples = store.queryRawSamples(switchMeta!.id, 1700000001, 1700000001);
    expect(switchSamples.length).toBe(1);
    expect(switchSamples[0].value).toBe(1);
  });

  it('ingests node and host system telemetry snapshots', () => {
    collector.ingestSystemMetrics(
      'hub-primary',
      {
        cpuPercent: 14.5,
        memoryUsedBytes: 4294967296,
        memoryPercent: 52.3,
        diskUsedPercent: 38.0,
        temperatureCelsius: 48.2,
        networkRxBytes: 1048576,
        networkTxBytes: 2097152,
      },
      1700000000,
    );

    expect(engine.pendingBufferCount).toBe(7);
    engine.flush();

    const cpuMeta = store.getMetadata('system.hub-primary.cpu_usage_percent');
    expect(cpuMeta).not.toBeNull();
    expect(cpuMeta?.unit).toBe('%');

    const netRxMeta = store.getMetadata('system.hub-primary.network_rx_bytes');
    expect(netRxMeta).not.toBeNull();
    expect(netRxMeta?.kind).toBe('counter');

    const cpuSamples = store.queryRawSamples(cpuMeta!.id, 1700000000, 1700000000);
    expect(cpuSamples.length).toBe(1);
    expect(cpuSamples[0].value).toBe(14.5);
  });

  it('ingests radio mesh link quality and frame metrics', () => {
    collector.ingestRadioMetric(
      'zigbee',
      '0x00158d0001234567',
      {
        lqi: 210,
        rssiDbm: -62,
        retries: 2,
      },
      1700000000,
    );

    expect(engine.pendingBufferCount).toBe(3);
    engine.flush();

    const lqiMeta = store.getMetadata('radio.zigbee.0x00158d0001234567.lqi');
    expect(lqiMeta).not.toBeNull();
    expect(lqiMeta?.unit).toBe('lqi');

    const rssiMeta = store.getMetadata('radio.zigbee.0x00158d0001234567.rssi_dbm');
    expect(rssiMeta).not.toBeNull();
    expect(rssiMeta?.unit).toBe('dBm');

    const retriesMeta = store.getMetadata('radio.zigbee.0x00158d0001234567.frame_retries');
    expect(retriesMeta).not.toBeNull();
    expect(retriesMeta?.kind).toBe('counter');
  });

  it('ingests automation and media stream telemetry', () => {
    // Automation success
    collector.ingestAutomationExecution('evening_lights', 12.4, true, 1700000000);
    // Automation failure
    collector.ingestAutomationExecution('evening_lights', 50.1, false, 1700000001);

    // Media stream
    collector.ingestMediaStreamMetric('cam_backyard', 2_500_000, 30, 0.2, 1700000000);

    engine.flush();

    const autoExecMeta = store.getMetadata('automation.evening_lights.executions');
    expect(autoExecMeta).not.toBeNull();

    const autoFailMeta = store.getMetadata('automation.evening_lights.failures');
    expect(autoFailMeta).not.toBeNull();

    const mediaBwMeta = store.getMetadata('media.cam_backyard.bandwidth_bytes_per_sec');
    expect(mediaBwMeta).not.toBeNull();
    expect(mediaBwMeta?.unit).toBe('B/s');
  });

  it('attaches and detaches periodic system pollers cleanly', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { cpuPercent: 25.0 };
    };

    const detach = collector.attachSystemPoller('node-worker-1', fetcher, 50);
    expect(typeof detach).toBe('function');

    // Wait for at least one poll tick
    await new Promise((r) => setTimeout(r, 120));
    expect(callCount).toBeGreaterThanOrEqual(1);

    detach();
    const countAfterDetach = callCount;
    await new Promise((r) => setTimeout(r, 120));
    expect(callCount).toBe(countAfterDetach);
  });
});
