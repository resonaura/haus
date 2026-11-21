/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type {
  AppAction,
  AppCatalogEntry,
  AppInfo,
  AppInstallProgressUpdate,
  AppManifest,
  AppPermissionType,
  ResolvedAppImage,
} from '@haus/apps';
import type { NativeConfigFieldMeta } from './config.js';

export interface InstalledAppEntry {
  manifest: AppManifest;
  state: 'running' | 'stopped';
  logs: string[];
  config: Record<string, unknown>;
  containerId?: string;
  image?: ResolvedAppImage;
  grantedPermissions?: readonly AppPermissionType[];
}

export interface AppInstallProgress extends AppInstallProgressUpdate {
  readonly appId: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly image?: ResolvedAppImage;
}

export interface StandaloneRuntimeBridge {
  supports(
    manifest: Pick<AppManifest, 'id'> & Partial<Pick<AppManifest, 'image'>>,
    catalogEntry?: AppCatalogEntry,
  ): boolean;
  configure?(options: { dataDirectory: string }): Promise<void>;
  restore?(entries: readonly InstalledAppEntry[]): Promise<void>;
  install(
    entry: { manifest: AppManifest; config: Record<string, unknown> },
    onProgress?: (update: AppInstallProgressUpdate) => void,
  ): Promise<{ logs?: readonly string[] }>;
  execute(entry: InstalledAppEntry, action: AppAction): Promise<void>;
  inspect?(entry: InstalledAppEntry): Promise<Partial<AppInfo> | undefined>;
  configureApp?(entry: InstalledAppEntry, config: Record<string, unknown>): Promise<void>;
  updateApp?(
    entry: InstalledAppEntry,
    targetManifest: AppManifest,
  ): Promise<{ logs?: readonly string[] }>;
  removeApp?(entry: InstalledAppEntry): Promise<void>;
  getLogs?(appId: string): readonly string[] | undefined;
  subscribeLogs?(appId: string, onLine: (line: string) => void): () => void;
  getNativeConfigSchema?(appId: string): Record<string, NativeConfigFieldMeta> | undefined;
  close?(): Promise<void>;
}
