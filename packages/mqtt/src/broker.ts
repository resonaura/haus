/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { MqttConnectionInfo } from './types.js';

export interface HausMqttConfig {
  readonly host?: string;
  readonly port?: number;
  readonly allowAnonymous?: boolean;
  readonly username?: string;
  readonly password?: string;
  readonly dataDirectory?: string;
  readonly passwordFilePath?: string;
  readonly users?: readonly { username: string; passwordHash: string }[];
  readonly persistence?: boolean;
  readonly maxConnections?: number;
}

/**
 * Generates secure, least-privilege, OS-agnostic Mosquitto broker configuration.
 * Paths are strictly injected by caller / host environment, never hardcoded.
 */
export function generateMosquittoConfig(config: HausMqttConfig = {}): string {
  const port = config.port ?? 1883;
  const allowAnon = config.allowAnonymous ?? false;
  const persistence = config.persistence ?? true;

  const lines = [
    '# Haus Native MQTT Broker Configuration',
    '# Managed automatically by Haus — do not edit directly.',
    `listener ${port} 0.0.0.0`,
    `allow_anonymous ${allowAnon}`,
    `persistence ${persistence}`,
    'log_dest stdout',
    'log_type error',
    'log_type warning',
    'log_type notice',
    'log_type information',
  ];

  if (persistence && config.dataDirectory) {
    // Normalize path for Mosquitto config (forward slashes work across Windows/macOS/Linux)
    const normalizedDataDir = config.dataDirectory.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    lines.push(`persistence_location ${normalizedDataDir}`);
  }

  if (config.passwordFilePath) {
    const normalizedPassPath = config.passwordFilePath.replace(/\\/g, '/');
    lines.push(`password_file ${normalizedPassPath}`);
  }

  if (config.maxConnections && config.maxConnections > 0) {
    lines.push(`max_connections ${config.maxConnections}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Normalizes MQTT connection details into standard connection info.
 */
export function resolveMqttConnectionInfo(config: HausMqttConfig = {}): MqttConnectionInfo {
  return {
    host: config.host ?? '127.0.0.1',
    port: config.port ?? 1883,
    allowAnonymous: config.allowAnonymous ?? false,
    username: config.username,
    password: config.password,
  };
}
