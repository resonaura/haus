/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { MqttDiscoveryPayload } from '@haus/mqtt';

export interface MqttEndpointBinding {
  readonly endpointId: string;
  readonly deviceId: string;
  readonly isJsonSchema: boolean;
  readonly stateTopic?: string;
  readonly commandTopic?: string;
  readonly payloadOn: string;
  readonly payloadOff: string;
}

export interface SingleEntityDiscoveryPayload extends MqttDiscoveryPayload {
  readonly schema?: string;
  readonly payload_on?: string;
  readonly payload_off?: string;
  readonly brightness?: boolean;
  readonly color_mode?: boolean;
  readonly supported_color_modes?: readonly string[];
  readonly effect?: boolean;
  readonly effect_list?: readonly string[];
}

export interface DeviceBundleDiscoveryPayload {
  readonly device?: {
    readonly identifiers?: readonly string[];
    readonly name?: string;
    readonly manufacturer?: string;
    readonly model?: string;
    readonly sw_version?: string;
  };
  readonly components: Record<
    string,
    {
      readonly platform: string;
      readonly unique_id?: string;
      readonly name?: string | null;
      readonly state_topic?: string;
      readonly command_topic?: string;
      readonly payload_on?: string;
      readonly payload_off?: string;
      readonly payload_press?: string;
      readonly schema?: string;
    }
  >;
}
