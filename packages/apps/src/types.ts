/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SourceRef } from '@haus/core/types';
export type AppAction = 'start' | 'stop' | 'restart';
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
  list(signal?: AbortSignal): Promise<readonly RuntimeApp[]>;
  execute(externalId: string, action: AppAction, signal?: AbortSignal): Promise<void>;
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
  drivers: readonly { id: string; available: boolean }[];
}
