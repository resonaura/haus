/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Apps,
  AppCatalog,
  AppImageAcquirer,
  DockerAppLifecycle,
  DockerSocket,
  type AppRuntimeType,
} from '@haus/apps';
import type { Identities } from '@haus/core/types';
import type { LiveService } from '../live/types.js';
import type { StandaloneHomePersistence } from './home.persistence.js';
import type { AppSupervisor } from './supervisor.js';
import { AppOptions } from './options.js';
import { createStandaloneAppDriver } from './standalone-driver.js';
import {
  StandaloneAppManager,
  type InstalledAppEntry,
  type StandaloneRuntimeBridge,
} from './app-driver.js';

/** Constructs the standalone `@haus/apps` driver and manager pair for a hub instance. */
export function createStandaloneAppManager(
  installedApps: Map<string, InstalledAppEntry>,
  identities: Identities,
  persistence: StandaloneHomePersistence,
  liveService?: LiveService,
  supervisor?: AppSupervisor,
  catalog: AppCatalog = AppCatalog.createDefaultCatalog(),
): { apps: Apps; appManager: StandaloneAppManager } {
  const socketPath = process.env.HAUS_DOCKER_SOCKET ?? '/var/run/docker.sock';
  const dataDirectory = resolve(process.env.HAUS_DATA_DIR ?? process.env.HAUS_DATA ?? '/data');
  const dataRoot = resolve(dataDirectory, 'apps');
  const hostDataRoot = resolve(process.env.HAUS_DATA_HOST_DIR ?? dataDirectory, 'apps');
  let lifecycle: DockerAppLifecycle | undefined;

  if (existsSync(socketPath)) {
    try {
      const docker = new DockerSocket(socketPath);
      lifecycle = new DockerAppLifecycle(
        docker,
        { dataRoot, hostDataRoot },
        new AppImageAcquirer(docker),
      );
    } catch {
      // Docker socket unavailable
    }
  }

  const apps = new Apps(identities, {
    authorize: async (actorId) => Boolean(actorId && actorId.trim().length > 0),
  });
  const options = new AppOptions(dataRoot);
  const runtimeBridges = new Map<AppRuntimeType, StandaloneRuntimeBridge>();
  apps.register(
    createStandaloneAppDriver(installedApps, lifecycle, options, catalog, runtimeBridges),
  );

  const appManager = new StandaloneAppManager(
    installedApps,
    apps,
    persistence,
    liveService,
    lifecycle,
    dataRoot,
    supervisor,
    hostDataRoot,
    options,
    catalog,
    runtimeBridges,
  );
  return { apps, appManager };
}
