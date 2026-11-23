/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausMqttBrokerOptions } from '@haus/mqtt';
import type { MqttStaleStore } from './stale-store.js';

export interface MqttServiceOptions extends HausMqttBrokerOptions {
  readonly discoveryPrefixes?: readonly string[];
  readonly homeId?: string;
  /** Grace window before unclaimed MQTT devices/endpoints are pruned as stale (default: 7 days). */
  readonly staleGraceMs?: number;
  /** Interval for periodic stale-endpoint sweeps while running (default: 1 hour). */
  readonly staleSweepIntervalMs?: number;
  /** Optional persistence override for unclaimed MQTT endpoint timestamps. */
  readonly staleStore?: MqttStaleStore;
  /** Optional clock override for deterministic tests. */
  readonly now?: () => number;
}
