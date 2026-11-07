/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

export interface AddonSupervisorConfig {
  slug: string;
  name: string;
  version: string;
  token: string;
  options: Record<string, unknown>;
  schema?: Record<string, unknown>;
  ingressPort?: number;
  ingressPath?: string;
  containerHost?: string;
}

export interface MqttServiceDetails {
  host: string;
  port: number;
  ssl: boolean;
  protocol: '3.1.1' | '5.0';
  username?: string;
  password?: string;
}

export interface DiscoveryPayload {
  uuid?: string;
  addon?: string;
  service: string;
  config: Record<string, unknown>;
}

export interface SupervisorApiResponse<T = unknown> {
  result: 'ok' | 'error';
  data?: T;
  message?: string;
}
