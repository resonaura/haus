/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausMqttBrokerOptions } from '@haus/mqtt';

export interface MqttServiceOptions extends HausMqttBrokerOptions {
  readonly discoveryPrefixes?: readonly string[];
}
