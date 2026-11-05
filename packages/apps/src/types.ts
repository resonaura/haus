/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SourceRef } from '@haus/core/types';
export type AppAction = 'start' | 'stop' | 'restart';

/**
 * Extended lifecycle operations beyond start/stop/restart. Drivers declare
 * support through {@link AppDriverCapabilities} and return explicit
 * {@link AppOperationResult} with `'unsupported'` when the operation is
 * not available on that runtime.
 */
export type AppOperation = 'install' | 'remove' | 'update' | 'configure' | 'logs' | 'info';

export interface AppOperationResult<T = unknown> {
  readonly status: 'ok' | 'unsupported' | 'error';
  readonly data?: T;
  readonly reason?: string;
}

/** Declares which operations a driver actually supports. */
export interface AppDriverCapabilities {
  /** Basic lifecycle (start/stop/restart). Always true for registered drivers. */
  readonly lifecycle: true;
  readonly install: boolean;
  readonly remove: boolean;
  readonly update: boolean;
  readonly configure: boolean;
  readonly logs: boolean;
  readonly info: boolean;
}

export interface AppInfo {
  readonly externalId: string;
  readonly name: string;
  readonly version?: string;
  readonly image?: string;
  readonly state: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
  readonly managed: boolean;
  readonly description?: string;
  readonly ports?: readonly number[];
  readonly updatable?: boolean;
  readonly updateVersion?: string;
}

export interface RuntimeApp {
  externalId: string;
  name: string;
  version?: string;
  image?: string;
  state: 'running' | 'stopped' | 'starting' | 'stopping' | 'unknown';
  managed: boolean;
  actions: readonly AppAction[];
}
export interface App extends Omit<RuntimeApp, 'externalId'> {
  id: string;
  source: SourceRef;
  available: boolean;
}

export interface AppDriver {
  readonly id: string;
  readonly capabilities: AppDriverCapabilities;
  list(signal?: AbortSignal): Promise<readonly RuntimeApp[]>;
  execute(externalId: string, action: AppAction, signal?: AbortSignal): Promise<void>;
  /** Retrieve extended information for one app. Returns unsupported when the driver cannot inspect. */
  inspect(externalId: string, signal?: AbortSignal): Promise<AppOperationResult<AppInfo>>;
  /** Attempt an extended operation. Returns unsupported when the driver does not implement it. */
  operate(
    operation: AppOperation,
    externalId: string,
    options?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppOperationResult>;
}

export interface AppPolicy {
  authorize(
    actorId: string,
    action: 'read' | AppAction,
    target: { driverId: string; externalId?: string },
  ): Promise<boolean>;
}
export interface AppInventory {
  apps: readonly App[];
  drivers: readonly { id: string; available: boolean; capabilities: AppDriverCapabilities }[];
}
