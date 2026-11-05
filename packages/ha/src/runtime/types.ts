/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type HaRuntimeState = 'running' | 'starting' | 'stopped' | 'failed' | 'updating';

export interface HaSupervisorStatus {
  readonly available: boolean;
  readonly version?: string;
  readonly channel?: string;
  readonly healthy?: boolean;
}

export interface HaRuntimeStatus {
  readonly state: HaRuntimeState;
  readonly connected: boolean;
  readonly version?: string;
  readonly error?: string;
  readonly supervisor?: HaSupervisorStatus;
}

export interface HaRuntimeConfig {
  readonly base: string;
  readonly ws: string;
  readonly version?: string;
  readonly timezone?: string;
  readonly unitSystem?: string;
  readonly components?: readonly string[];
  readonly [key: string]: unknown;
}

export interface HaRuntimeBackupOptions {
  readonly name?: string;
  readonly background?: boolean;
  readonly signal?: AbortSignal;
}

export interface HaRuntimeBackupResult {
  readonly slug: string;
  readonly size?: number;
  readonly createdAt?: number;
}

export interface HaRuntimeUpdateOptions {
  readonly targetVersion?: string;
  readonly signal?: AbortSignal;
}

export interface HaRuntimeUpdateResult {
  readonly status: 'started' | 'up-to-date';
  readonly version?: string;
  readonly previousVersion?: string;
}

export interface HaClientLike {
  readonly connected?: boolean;
  readonly stopped?: boolean;
  request<T = unknown>(message: Record<string, unknown>): Promise<T>;
  stop(): void;
}

/** Injected Home Assistant runtime lifecycle port. Separates orchestration from wire protocols. */
export interface HaRuntime {
  readonly connected?: boolean;
  status(): Promise<HaRuntimeStatus>;
  configuration(): Promise<HaRuntimeConfig>;
  backup(options?: HaRuntimeBackupOptions): Promise<HaRuntimeBackupResult>;
  update(options?: HaRuntimeUpdateOptions): Promise<HaRuntimeUpdateResult>;
  stop(): Promise<void>;
  start?(): Promise<void>;
  restart?(): Promise<void>;
}
