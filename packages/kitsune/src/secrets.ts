/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export type CompatibilityRuntimeKind = 'scrypted' | 'homebridge' | 'hacs' | 'supervisor';

export interface KitsuneCommandPayload {
  deviceId: string;
  endpointId: string;
  capability: string;
  value: unknown;
  parameters?: Record<string, unknown>;
}

export interface KitsuneEngineDiagnostic {
  timestamp: string;
  pluginId: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  detail?: Record<string, unknown>;
}

export interface UnsupportedCapability {
  runtime: CompatibilityRuntimeKind;
  pluginId: string;
  deviceId?: string;
  capability: string;
  reason: string;
  reportedAt: string;
}

export interface SessionOwnershipLease {
  sessionKey: string;
  runtime: CompatibilityRuntimeKind;
  pluginId: string;
  ownerId: string;
  epoch: number;
  status: 'active' | 'restarting' | 'released';
  acquiredAt: string;
  updatedAt: string;
}

export interface CompatibilityMatrixEntry {
  runtime: CompatibilityRuntimeKind;
  supported: readonly string[];
  unsupported: readonly string[];
  secretIsolation: 'per_plugin_vault_and_sanitized_env';
  sessionOwnership: 'single_owner_monotonic_epoch';
}

export const COMPATIBILITY_MATRIX: readonly CompatibilityMatrixEntry[] = [
  {
    runtime: 'scrypted',
    supported: [
      'VideoCamera',
      'Camera',
      'MotionSensor',
      'Intercom',
      'OnOff',
      'Light',
      'Brightness',
      'Lock',
      'Entry',
      'Thermometer',
      'BinarySensor',
      'ContactSensor',
    ],
    unsupported: ['ObjectDetection', 'PanTiltZoom', 'VideoRecorder', 'Notifier', 'MixinProvider'],
    secretIsolation: 'per_plugin_vault_and_sanitized_env',
    sessionOwnership: 'single_owner_monotonic_epoch',
  },
  {
    runtime: 'homebridge',
    supported: [
      'AccessoryInformation',
      'Lightbulb',
      'Switch',
      'Outlet',
      'Thermostat',
      'LockMechanism',
      'MotionSensor',
      'ContactSensor',
      'OccupancySensor',
      'TemperatureSensor',
      'HumiditySensor',
      'WindowCovering',
      'GarageDoorOpener',
      'Fan',
      'BatteryService',
      'CameraRTPStreamManagement',
      'Television',
      'TelevisionSpeaker',
      'Speaker',
      'InputSource',
    ],
    unsupported: ['IrrigationSystem', 'SmartSpeaker', 'Valve', 'AirPurifier', 'HeaterCooler'],
    secretIsolation: 'per_plugin_vault_and_sanitized_env',
    sessionOwnership: 'single_owner_monotonic_epoch',
  },
  {
    runtime: 'hacs',
    supported: [
      'light',
      'switch',
      'outlet',
      'climate',
      'cover',
      'lock',
      'binary_sensor',
      'sensor',
      'button',
      'scene',
      'event',
      'select',
      'update',
      'device_tracker',
      'image',
      'weather',
      'notify',
    ],
    unsupported: ['media_player', 'vacuum', 'siren', 'lawn_mower', 'remote', 'water_heater'],
    secretIsolation: 'per_plugin_vault_and_sanitized_env',
    sessionOwnership: 'single_owner_monotonic_epoch',
  },
  {
    runtime: 'supervisor',
    supported: [
      'GET /info',
      'GET /core/info',
      'GET /addons/self/info',
      'GET /addons/:slug/info',
      'GET /addons/:slug/options',
      'POST /addons/:slug/options',
      'GET /services',
      'GET /services/:service',
      'GET /discovery',
      'POST /discovery',
      'DELETE /discovery/:uuid',
      'POST /core/api/states/:entityId',
      'POST /core/api/events/:eventType',
    ],
    unsupported: [
      '/docker/*',
      '/host/*',
      '/os/*',
      '/supervisor/*',
      '/backups/*',
      '/security/*',
      '/mounts/*',
    ],
    secretIsolation: 'per_plugin_vault_and_sanitized_env',
    sessionOwnership: 'single_owner_monotonic_epoch',
  },
] as const;

export const SAFE_CHILD_ENV_KEYS = [
  'PATH',
  'LANG',
  'TMPDIR',
  'TEMP',
  'SYSTEMROOT',
  'WINDIR',
] as const;

const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /credential/i,
  /cookie/i,
  /authorization/i,
  /^HAUS_/i,
  /^SUPERVISOR_/i,
];

export function sanitizedChildEnv(
  extra: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const val = baseEnv[key];
    if (typeof val === 'string') {
      sanitized[key] = val;
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export class PluginSecretVault {
  private readonly store = new Map<string, Map<string, string>>();
  private readonly knownValues = new Set<string>();

  private scopeKey(runtime: CompatibilityRuntimeKind, pluginId: string): string {
    return `${runtime}:${pluginId}`;
  }

  setSecret(runtime: CompatibilityRuntimeKind, pluginId: string, key: string, value: string): void {
    const scope = this.scopeKey(runtime, pluginId);
    let bucket = this.store.get(scope);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.store.set(scope, bucket);
    }
    bucket.set(key, value);
    if (value.trim().length >= 4) {
      this.knownValues.add(value);
    }
  }

  getSecret(
    runtime: CompatibilityRuntimeKind,
    callerPluginId: string,
    targetPluginId: string,
    key: string,
  ): string | undefined {
    if (callerPluginId !== targetPluginId) {
      throw new Error('kitsune_secret_access_denied');
    }
    return this.store.get(this.scopeKey(runtime, targetPluginId))?.get(key);
  }

  getPluginSecrets(
    runtime: CompatibilityRuntimeKind,
    callerPluginId: string,
    targetPluginId: string = callerPluginId,
  ): Record<string, string> {
    if (callerPluginId !== targetPluginId) {
      throw new Error('kitsune_secret_access_denied');
    }
    const bucket = this.store.get(this.scopeKey(runtime, targetPluginId));
    if (!bucket) return {};
    return Object.fromEntries(bucket.entries());
  }

  clearPluginSecrets(runtime: CompatibilityRuntimeKind, pluginId: string): void {
    this.store.delete(this.scopeKey(runtime, pluginId));
  }

  redactText(text: string): string {
    let result = text;
    for (const secret of this.knownValues) {
      if (secret.length >= 4 && result.includes(secret)) {
        result = result.split(secret).join('[REDACTED]');
      }
    }
    return result;
  }

  redactValue<T>(value: T): T {
    if (typeof value === 'string') {
      return this.redactText(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item)) as T;
    }
    if (value !== null && typeof value === 'object') {
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (isSecretKeyName(k)) {
          redacted[k] = '[REDACTED]';
        } else {
          redacted[k] = this.redactValue(v);
        }
      }
      return redacted as T;
    }
    return value;
  }
}
