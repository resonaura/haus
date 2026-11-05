/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type {
  HaRuntime,
  HaRuntimeBackupOptions,
  HaRuntimeBackupResult,
  HaRuntimeConfig,
  HaRuntimeStatus,
  HaRuntimeUpdateOptions,
  HaRuntimeUpdateResult,
} from './types.js';

export interface FakeHaRuntimeOptions {
  readonly connected?: boolean;
  readonly status?: Partial<HaRuntimeStatus>;
  readonly config?: Partial<HaRuntimeConfig>;
  readonly backupSlug?: string;
  readonly updateResult?: HaRuntimeUpdateResult;
}

export class FakeHaRuntime implements HaRuntime {
  private currentStatus: HaRuntimeStatus;
  private currentConfig: HaRuntimeConfig;
  private nextBackupSlug: string;
  private nextUpdateResult: HaRuntimeUpdateResult;

  readonly backupCalls: HaRuntimeBackupOptions[] = [];
  readonly updateCalls: HaRuntimeUpdateOptions[] = [];
  stopCount = 0;

  constructor(options?: FakeHaRuntimeOptions) {
    const initialConnected = options?.connected ?? options?.status?.connected ?? true;
    this.currentStatus = {
      state: options?.status?.state ?? (initialConnected ? 'running' : 'stopped'),
      connected: initialConnected,
      version: options?.status?.version ?? '2024.10.0',
      supervisor: options?.status?.supervisor ?? { available: true, version: '2024.10.1' },
      ...options?.status,
    };

    this.currentConfig = {
      base: options?.config?.base ?? 'http://127.0.0.1:8123',
      ws: options?.config?.ws ?? 'ws://127.0.0.1:8123/api/websocket',
      version: options?.config?.version ?? '2024.10.0',
      timezone: options?.config?.timezone ?? 'UTC',
      unitSystem: options?.config?.unitSystem ?? 'metric',
      components: options?.config?.components ?? ['sensor', 'light', 'switch'],
      ...options?.config,
    };

    this.nextBackupSlug = options?.backupSlug ?? 'fake-backup-001';
    this.nextUpdateResult = options?.updateResult ?? { status: 'up-to-date', version: '2024.10.0' };
  }

  get connected(): boolean {
    return Boolean(this.currentStatus.connected);
  }

  setConnected(connected: boolean): void {
    this.setStatus({ connected, state: connected ? 'running' : 'stopped' });
  }

  setStatus(patch: Partial<HaRuntimeStatus>): void {
    this.currentStatus = {
      ...this.currentStatus,
      ...patch,
    };
  }

  setConfig(patch: Partial<HaRuntimeConfig>): void {
    this.currentConfig = {
      ...this.currentConfig,
      ...patch,
    };
  }

  setBackupSlug(slug: string): void {
    this.nextBackupSlug = slug;
  }

  setUpdateResult(result: HaRuntimeUpdateResult): void {
    this.nextUpdateResult = result;
  }

  async status(): Promise<HaRuntimeStatus> {
    return this.currentStatus;
  }

  async configuration(): Promise<HaRuntimeConfig> {
    return this.currentConfig;
  }

  async backup(options?: HaRuntimeBackupOptions): Promise<HaRuntimeBackupResult> {
    if (options) this.backupCalls.push(options);
    return {
      slug: this.nextBackupSlug,
      createdAt: Date.now(),
    };
  }

  async update(options?: HaRuntimeUpdateOptions): Promise<HaRuntimeUpdateResult> {
    if (options) this.updateCalls.push(options);
    return this.nextUpdateResult;
  }

  async stop(): Promise<void> {
    this.stopCount++;
    this.currentStatus = {
      ...this.currentStatus,
      state: 'stopped',
      connected: false,
    };
  }
}
