/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import type { Reading } from '@haus/core/types';
import type { HausDevice } from '@haus/core/device';

export interface HomebridgePairingCard {
  pluginName: string;
  pin: string;
  setupUri?: string;
  qrPayload?: string;
  timestamp: string;
}

export interface HomebridgePluginConfig {
  name: string;
  platform?: string;
  accessory?: string;
  [key: string]: unknown;
}

export interface HomebridgeApiEvents {
  deviceDiscovered: (device: HausDevice) => void;
  deviceStateChanged: (deviceId: string, readings: Record<string, Reading>) => void;
  pairingCardFound: (card: HomebridgePairingCard) => void;
}
