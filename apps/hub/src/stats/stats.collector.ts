/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { StatisticKind, StatisticSource } from '@haus/core';
import type { StatsEngine, RegisterStatisticOptions } from './stats.engine.js';

export interface SystemTelemetrySnapshot {
  readonly cpuPercent?: number;
  readonly memoryUsedBytes?: number;
  readonly memoryPercent?: number;
  readonly diskUsedPercent?: number;
  readonly temperatureCelsius?: number;
  readonly networkRxBytes?: number;
  readonly networkTxBytes?: number;
}

export interface RadioTelemetrySnapshot {
  readonly lqi?: number;
  readonly rssiDbm?: number;
  readonly retries?: number;
}

export interface CollectorRegistrationHint {
  readonly source?: StatisticSource;
  readonly unit?: string;
  readonly kind?: StatisticKind;
  readonly displayName?: string;
}

/**
 * Universal metric collector for devices, host/nodes, radio mesh networks, automations, and media streams.
 * Automatically classifies metric kinds, normalizes measurement units, and routes telemetry
 * non-blockingly into the high-throughput StatsEngine.
 */
export class StatsCollector {
  private readonly pollers: NodeJS.Timeout[] = [];

  constructor(private readonly engine: StatsEngine) {}

  /**
   * Automatically normalizes units and infers kind for a given metric identifier.
   */
  public inferMetadataOptions(
    statisticId: string,
    hint?: CollectorRegistrationHint,
  ): RegisterStatisticOptions {
    let source: StatisticSource = hint?.source ?? 'custom';
    let kind: StatisticKind = hint?.kind ?? 'gauge';
    let unit: string | undefined = hint?.unit;

    // Detect source prefix if not explicitly specified
    if (!hint?.source) {
      if (statisticId.startsWith('sensor.') || statisticId.startsWith('device.')) {
        source = 'device';
      } else if (statisticId.startsWith('system.') || statisticId.startsWith('host.')) {
        source = 'system';
      } else if (statisticId.startsWith('radio.') || statisticId.startsWith('mesh.')) {
        source = 'radio';
      } else if (statisticId.startsWith('automation.')) {
        source = 'automation';
      } else if (statisticId.startsWith('media.')) {
        source = 'media';
      }
    }

    // Infer kind & unit if not specified
    if (!hint?.kind) {
      if (
        statisticId.endsWith('_total') ||
        statisticId.endsWith('_count') ||
        statisticId.endsWith('_bytes') ||
        statisticId.endsWith('_energy') ||
        statisticId.endsWith('_retries') ||
        statisticId.endsWith('_failures') ||
        statisticId.endsWith('_executions')
      ) {
        kind = 'counter';
      } else if (
        statisticId.endsWith('_state') ||
        statisticId.endsWith('_status') ||
        statisticId.endsWith('_active')
      ) {
        kind = 'state';
      } else {
        kind = 'gauge';
      }
    }

    // Infer common units
    if (!unit) {
      if (statisticId.includes('temp')) unit = '°C';
      else if (
        statisticId.includes('percent') ||
        statisticId.includes('cpu') ||
        statisticId.includes('usage')
      )
        unit = '%';
      else if (statisticId.includes('power')) unit = 'W';
      else if (statisticId.includes('energy')) unit = 'kWh';
      else if (statisticId.includes('bytes_per_sec') || statisticId.includes('bandwidth'))
        unit = 'B/s';
      else if (statisticId.includes('bytes')) unit = 'B';
      else if (statisticId.includes('duration') || statisticId.includes('latency')) unit = 'ms';
      else if (statisticId.includes('rssi')) unit = 'dBm';
      else if (statisticId.includes('lqi')) unit = 'lqi';
      else if (statisticId.includes('fps')) unit = 'fps';
    }

    return {
      source,
      kind,
      unit,
      displayName: hint?.displayName,
    };
  }

  /**
   * Ingests an entity or device reading, automatically registering the metric if unseen.
   */
  public ingestDeviceReading(
    deviceId: string,
    attribute: string,
    value: number | boolean | string,
    unit?: string,
    timestampSeconds?: number,
  ): void {
    const statId = `device.${deviceId}.${attribute}`;
    let numericValue: number;

    if (typeof value === 'boolean') {
      numericValue = value ? 1 : 0;
      this.engine.register(statId, {
        source: 'device',
        kind: 'state',
        displayName: `${deviceId} ${attribute}`,
      });
    } else if (typeof value === 'number') {
      numericValue = value;
      const opts = this.inferMetadataOptions(statId, {
        source: 'device',
        unit,
        displayName: `${deviceId} ${attribute}`,
      });
      this.engine.register(statId, opts);
    } else {
      // String state: hash or encode numeric representation
      numericValue = Number.parseFloat(value);
      if (Number.isNaN(numericValue)) {
        return;
      }
      this.engine.register(statId, {
        source: 'device',
        kind: 'gauge',
        unit,
        displayName: `${deviceId} ${attribute}`,
      });
    }

    this.engine.record(statId, numericValue, timestampSeconds);
  }

  /**
   * Ingests host or node system health metrics (CPU, RAM, Disk, Temperature, Network).
   */
  public ingestSystemMetrics(
    nodeId: string,
    metrics: SystemTelemetrySnapshot,
    timestampSeconds?: number,
  ): void {
    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);

    if (metrics.cpuPercent !== undefined) {
      const id = `system.${nodeId}.cpu_usage_percent`;
      this.engine.register(id, {
        source: 'system',
        kind: 'gauge',
        unit: '%',
        displayName: `${nodeId} CPU Usage`,
      });
      this.engine.record(id, metrics.cpuPercent, ts);
    }

    if (metrics.memoryUsedBytes !== undefined) {
      const id = `system.${nodeId}.memory_used_bytes`;
      this.engine.register(id, {
        source: 'system',
        kind: 'gauge',
        unit: 'B',
        displayName: `${nodeId} Memory Used`,
      });
      this.engine.record(id, metrics.memoryUsedBytes, ts);
    }

    if (metrics.memoryPercent !== undefined) {
      const id = `system.${nodeId}.memory_usage_percent`;
      this.engine.register(id, {
        source: 'system',
        kind: 'gauge',
        unit: '%',
        displayName: `${nodeId} Memory Usage %`,
      });
      this.engine.record(id, metrics.memoryPercent, ts);
    }

    if (metrics.diskUsedPercent !== undefined) {
      const id = `system.${nodeId}.disk_used_percent`;
      this.engine.register(id, {
        source: 'system',
        kind: 'gauge',
        unit: '%',
        displayName: `${nodeId} Disk Used %`,
      });
      this.engine.record(id, metrics.diskUsedPercent, ts);
    }

    if (metrics.temperatureCelsius !== undefined) {
      const id = `system.${nodeId}.temperature_celsius`;
      this.engine.register(id, {
        source: 'system',
        kind: 'gauge',
        unit: '°C',
        displayName: `${nodeId} Temperature`,
      });
      this.engine.record(id, metrics.temperatureCelsius, ts);
    }

    if (metrics.networkRxBytes !== undefined) {
      const id = `system.${nodeId}.network_rx_bytes`;
      this.engine.register(id, {
        source: 'system',
        kind: 'counter',
        unit: 'B',
        displayName: `${nodeId} Network Rx Total`,
      });
      this.engine.record(id, metrics.networkRxBytes, ts);
    }

    if (metrics.networkTxBytes !== undefined) {
      const id = `system.${nodeId}.network_tx_bytes`;
      this.engine.register(id, {
        source: 'system',
        kind: 'counter',
        unit: 'B',
        displayName: `${nodeId} Network Tx Total`,
      });
      this.engine.record(id, metrics.networkTxBytes, ts);
    }
  }

  /**
   * Ingests radio mesh link telemetry (LQI, RSSI, Frame Retries) across Zigbee, Thread, or Matter.
   */
  public ingestRadioMetric(
    protocol: 'zigbee' | 'thread' | 'matter',
    deviceId: string,
    metric: RadioTelemetrySnapshot,
    timestampSeconds?: number,
  ): void {
    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);

    if (metric.lqi !== undefined) {
      const id = `radio.${protocol}.${deviceId}.lqi`;
      this.engine.register(id, {
        source: 'radio',
        kind: 'gauge',
        unit: 'lqi',
        displayName: `${protocol.toUpperCase()} ${deviceId} LQI`,
      });
      this.engine.record(id, metric.lqi, ts);
    }

    if (metric.rssiDbm !== undefined) {
      const id = `radio.${protocol}.${deviceId}.rssi_dbm`;
      this.engine.register(id, {
        source: 'radio',
        kind: 'gauge',
        unit: 'dBm',
        displayName: `${protocol.toUpperCase()} ${deviceId} RSSI`,
      });
      this.engine.record(id, metric.rssiDbm, ts);
    }

    if (metric.retries !== undefined) {
      const id = `radio.${protocol}.${deviceId}.frame_retries`;
      this.engine.register(id, {
        source: 'radio',
        kind: 'counter',
        unit: 'frames',
        displayName: `${protocol.toUpperCase()} ${deviceId} Retries`,
      });
      this.engine.record(id, metric.retries, ts);
    }
  }

  /**
   * Ingests automation execution performance telemetry.
   */
  public ingestAutomationExecution(
    automationId: string,
    durationMs: number,
    success: boolean,
    timestampSeconds?: number,
  ): void {
    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);

    const durId = `automation.${automationId}.duration_ms`;
    this.engine.register(durId, {
      source: 'automation',
      kind: 'gauge',
      unit: 'ms',
      displayName: `Automation ${automationId} Duration`,
    });
    this.engine.record(durId, durationMs, ts);

    const execId = `automation.${automationId}.executions`;
    this.engine.register(execId, {
      source: 'automation',
      kind: 'counter',
      displayName: `Automation ${automationId} Executions`,
    });
    this.engine.record(execId, 1, ts);

    if (!success) {
      const failId = `automation.${automationId}.failures`;
      this.engine.register(failId, {
        source: 'automation',
        kind: 'counter',
        displayName: `Automation ${automationId} Failures`,
      });
      this.engine.record(failId, 1, ts);
    }
  }

  /**
   * Ingests media stream streaming health telemetry (bitrate, FPS, packet loss).
   */
  public ingestMediaStreamMetric(
    streamId: string,
    bandwidthBytesPerSec: number,
    fps: number,
    packetLossPercent?: number,
    timestampSeconds?: number,
  ): void {
    const ts = timestampSeconds ?? Math.floor(Date.now() / 1000);

    const bwId = `media.${streamId}.bandwidth_bytes_per_sec`;
    this.engine.register(bwId, {
      source: 'media',
      kind: 'gauge',
      unit: 'B/s',
      displayName: `Stream ${streamId} Bandwidth`,
    });
    this.engine.record(bwId, bandwidthBytesPerSec, ts);

    const fpsId = `media.${streamId}.fps`;
    this.engine.register(fpsId, {
      source: 'media',
      kind: 'gauge',
      unit: 'fps',
      displayName: `Stream ${streamId} FPS`,
    });
    this.engine.record(fpsId, fps, ts);

    if (packetLossPercent !== undefined) {
      const lossId = `media.${streamId}.packet_loss_percent`;
      this.engine.register(lossId, {
        source: 'media',
        kind: 'gauge',
        unit: '%',
        displayName: `Stream ${streamId} Packet Loss %`,
      });
      this.engine.record(lossId, packetLossPercent, ts);
    }
  }

  /**
   * Attaches an asynchronous periodic system telemetry poller with automatic timer unref.
   */
  public attachSystemPoller(
    nodeId: string,
    fetcher: () => Promise<SystemTelemetrySnapshot>,
    intervalMs = 15_000,
  ): () => void {
    const timer = setInterval(async () => {
      try {
        const metrics = await fetcher();
        this.ingestSystemMetrics(nodeId, metrics);
      } catch {
        // Suppress poller fetch errors gracefully
      }
    }, intervalMs);

    timer.unref();
    this.pollers.push(timer);

    return () => {
      clearInterval(timer);
      const idx = this.pollers.indexOf(timer);
      if (idx !== -1) this.pollers.splice(idx, 1);
    };
  }

  public stop(): void {
    for (const p of this.pollers) {
      clearInterval(p);
    }
    this.pollers.length = 0;
  }
}
