/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export enum HomeKitCategory {
  OTHER = 1,
  BRIDGE = 2,
  FAN = 3,
  GARAGE = 4,
  LIGHTBULB = 5,
  DOOR_LOCK = 6,
  OUTLET = 7,
  SWITCH = 8,
  THERMOSTAT = 9,
  SENSOR = 10,
  SECURITY_SYSTEM = 11,
  DOOR = 12,
  WINDOW = 13,
  WINDOW_COVERING = 14,
  PROGRAMMABLE_SWITCH = 15,
  IP_CAMERA = 17,
  VIDEO_DOORBELL = 18,
  AIR_PURIFIER = 19,
  HEATER = 20,
  AIR_CONDITIONER = 21,
  HUMIDIFIER = 22,
  DEHUMIDIFIER = 23,
  ROUTER = 33,
}

export interface HomeKitSetupPayload {
  readonly version: number;
  readonly flags: number;
  readonly category: HomeKitCategory | number;
  readonly setupId: string;
  readonly pin: string; // Formatted as XXX-XX-XXX
  readonly setupUri: string; // Formatted as X-HM://...
}

export interface HomeKitTxtRecord {
  readonly md: string; // Model name (guarded by mDNS size limit)
  readonly pv: string; // Protocol version (e.g. "1.1")
  readonly id: string; // Device ID / MAC (XX:XX:XX:XX:XX:XX)
  readonly 'c#': number; // Current configuration number
  readonly 's#': number; // Current state number
  readonly sf: number; // Status flags (1 = unassigned/unpaired, 0 = paired)
  readonly ff: number; // Feature flags
  readonly ci: number; // Category ID
  readonly sh?: string; // Setup hash (base64)
}

export interface HapCharacteristicValue {
  readonly aid: number;
  readonly iid: number;
  readonly value?: unknown;
  readonly status?: number;
}

export interface HapBatchUpdateRequest {
  readonly characteristics: readonly {
    readonly aid: number;
    readonly iid: number;
    readonly value: unknown;
  }[];
}

export interface HapBatchUpdateResponse {
  readonly characteristics: readonly HapCharacteristicValue[];
}
