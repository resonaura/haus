/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { LoggerService } from '@nestjs/common';
import {
  createHausLogger,
  formatLogError,
  type HausLogLevel,
  type HausLogger,
  type HausLoggerOptions,
} from '@haus/core';

const CONTEXT_ALIASES: Readonly<Record<string, string>> = {
  NestFactory: 'Hub',
  NestApplication: 'Hub',
  RoutesResolver: 'HTTP',
  RouterExplorer: 'HTTP',
  InstanceLoader: 'Nest',
  StandaloneHomeService: 'Home',
  HubTuyaService: 'Tuya',
  TuyaBridgeLogin: 'Tuya',
  HaFlowBridgeService: 'HAFlow',
  HaFlowRuntime: 'HAFlow',
  NativeCameraRuntime: 'Camera',
  CameraIntegrationService: 'Camera',
  LiveService: 'Live',
  LiveGateway: 'Live',
  HausWsAdapter: 'Live',
  MqttDiscoveryService: 'MQTT',
  MqttService: 'MQTT',
  ClusterSyncService: 'Cluster',
  ClusterLeaseService: 'Cluster',
  ClusterOrchestrator: 'Cluster',
  ClusterPeerService: 'Cluster',
  HomeKitControllerService: 'HomeKit',
  HomeKitBridgeService: 'HomeKit',
  MatterCommissioningService: 'Matter',
  KitsuneService: 'Kitsune',
  KitsuneRuntimeService: 'Kitsune',
  CommissioningService: 'Commission',
  HubIntegrationEntryService: 'Integrations',
  NativeProviderService: 'Providers',
  AuthService: 'Auth',
  StatsCollector: 'Stats',
  NvrTransport: 'NVR',
  NvrRuntime: 'NVR',
};

const QUIET_STARTUP_CONTEXTS = new Set(['RoutesResolver', 'RouterExplorer', 'InstanceLoader']);

/** Maps a NestJS class/context string to a concise, consistent Haus log module label. */
export function normalizeHubLogContext(context?: string): string {
  if (!context || !context.trim()) return 'Hub';
  const trimmed = context.trim();
  const direct = CONTEXT_ALIASES[trimmed];
  if (direct) return direct;
  if (trimmed.includes('Tuya')) return 'Tuya';
  if (trimmed.includes('Mqtt')) return 'MQTT';
  if (trimmed.includes('Cluster')) return 'Cluster';
  if (trimmed.includes('Camera') || trimmed.includes('Media')) return 'Camera';
  if (trimmed.includes('Nvr')) return 'NVR';
  if (trimmed.includes('Kitsune')) return 'Kitsune';
  if (trimmed.includes('HomeKit') || trimmed.includes('Homekit')) return 'HomeKit';
  if (trimmed.includes('Matter')) return 'Matter';
  if (trimmed.includes('Zigbee')) return 'Zigbee';
  if (trimmed.includes('Thread')) return 'Thread';
  if (trimmed.includes('Auth')) return 'Auth';
  if (trimmed.includes('Provider')) return 'Providers';
  if (trimmed.includes('Live')) return 'Live';
  if (trimmed.includes('Backup')) return 'Backup';
  if (trimmed.includes('Stats')) return 'Stats';
  if (trimmed.includes('HaFlow')) return 'HAFlow';
  if (trimmed.includes('Home')) return 'Home';
  return trimmed.replace(/(?:Service|Controller|Module|Gateway|Guard|Runtime)$/, '') || trimmed;
}

function formatMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  return formatLogError(message);
}

/** NestJS LoggerService backed by the unified colored per-module `@haus/core/logger`. */
export class HausNestLogger implements LoggerService {
  private readonly loggers = new Map<string, HausLogger>();
  private readonly options: HausLoggerOptions;

  constructor(options: HausLoggerOptions = {}) {
    this.options = options;
  }

  private getLogger(context?: string): HausLogger {
    const moduleName = normalizeHubLogContext(context);
    let logger = this.loggers.get(moduleName);
    if (!logger) {
      logger = createHausLogger(moduleName, this.options);
      this.loggers.set(moduleName, logger);
    }
    return logger;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    const logger = this.getLogger(context);
    const text = formatMessage(message);
    if (context && QUIET_STARTUP_CONTEXTS.has(context)) {
      logger.debug(text);
      return;
    }
    logger.info(text);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.getLogger(context).warn(formatMessage(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const { context, detail } = this.extractErrorParams(optionalParams);
    this.getLogger(context).error(formatMessage(message), detail);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.getLogger(context).debug(formatMessage(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const context = this.extractContext(optionalParams);
    this.getLogger(context).debug(formatMessage(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const { context, detail } = this.extractErrorParams(optionalParams);
    this.getLogger(context).error(formatMessage(message), detail);
  }

  private extractContext(params: readonly unknown[]): string | undefined {
    const last = params.at(-1);
    return typeof last === 'string' && last.length > 0 && last.length <= 64 ? last : undefined;
  }

  private extractErrorParams(params: readonly unknown[]): {
    readonly context?: string;
    readonly detail?: unknown;
  } {
    if (params.length === 0) return {};
    if (params.length === 1) {
      const only = params[0];
      if (typeof only === 'string' && !only.includes('\n') && only.length <= 64) {
        return { context: only };
      }
      return { detail: only };
    }
    const last = params.at(-1);
    const context =
      typeof last === 'string' && !last.includes('\n') && last.length <= 64 ? last : undefined;
    const first = params[0];
    const detail =
      typeof first === 'string' && first.includes('\n')
        ? first.split('\n')[0]?.trim()
        : first !== context
          ? first
          : undefined;
    return { context, detail };
  }
}

export function createHubLogger(moduleName: string, level?: HausLogLevel): HausLogger {
  return createHausLogger(moduleName, level ? { level } : {});
}

export function createHubNestLogger(options: HausLoggerOptions = {}): HausNestLogger {
  const level =
    options.level ??
    (process.env.VITEST && !process.env.HAUS_LOG_LEVEL ? ('warn' as const) : undefined);
  return new HausNestLogger({
    ...options,
    ...(level ? { level } : {}),
  });
}
