/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export const TUYA_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
export const TUYA_SCHEMA = 'haauthorize';
export const TUYA_DEFAULT_AUTH_BASE_URL = 'https://apigw.iotbing.com';

export interface TuyaTokenInfo {
  readonly t: number;
  readonly uid: string;
  readonly expire_time: number;
  readonly access_token: string;
  readonly refresh_token: string;
}

export interface TuyaStoredCredentials {
  readonly user_code: string;
  readonly endpoint: string;
  readonly terminal_id: string;
  readonly uid: string;
  readonly username?: string;
  readonly token_info: TuyaTokenInfo;
}

export interface TuyaQrCodeResult {
  readonly success: boolean;
  readonly qrcode?: string;
  readonly code?: string | number;
  readonly msg?: string;
}

export interface TuyaLoginPollResult {
  readonly success: boolean;
  readonly credentials?: TuyaStoredCredentials;
  readonly code?: string | number;
  readonly msg?: string;
}

export interface TuyaHome {
  readonly id: string;
  readonly name: string;
}

export interface TuyaStatusItem {
  readonly code: string;
  readonly value: unknown;
}

export interface TuyaCloudDevice {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly product_id?: string;
  readonly product_name?: string;
  readonly sub?: boolean;
  readonly uuid?: string;
  readonly asset_id?: string;
  readonly online?: boolean;
  readonly icon?: string;
  readonly ip?: string;
  readonly time_zone?: string;
  readonly status?: ReadonlyArray<TuyaStatusItem> | Readonly<Record<string, unknown>>;
}

export interface TuyaCommandItem {
  readonly code: string;
  readonly value: unknown;
}
