/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ClusterStateStore } from '../../cluster/coordination/state.js';
import { CAMERA_SERVICE } from '../tokens.js';
import type { CameraService, CameraSnapshot } from '../types.js';

export const BACKGROUND_SNAPSHOT_INTERVAL_MS = 5_000;
const INITIAL_DELAY_MS = 4_000;
const MAX_CONCURRENCY = 2;

type RefreshableCameraService = CameraService & {
  refreshSnapshot?(cameraId: string): Promise<CameraSnapshot>;
};

/**
 * Refreshes snapshots for all available cameras every 5 seconds in the background
 * so cached frames stay fresh even when no client application is open.
 */
@Injectable()
export class CameraSnapshotScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private initialTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    @Inject(CAMERA_SERVICE) private readonly cameraService: RefreshableCameraService,
    @Optional() @Inject(ClusterStateStore) private readonly stateStore?: ClusterStateStore,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' && !process.env.HAUS_BACKGROUND_SNAPSHOTS) return;
    this.stopped = false;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = undefined;
      void this.tick();
      if (this.stopped) return;
      this.intervalTimer = setInterval(() => {
        void this.tick();
      }, BACKGROUND_SNAPSHOT_INTERVAL_MS);
      this.intervalTimer.unref();
    }, INITIAL_DELAY_MS);
    this.initialTimer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = undefined;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.stopped || this.running) return;
    const role = this.stateStore?.getStateSync().role;
    if (role && role !== 'coordinator' && role !== 'standalone') return;
    this.running = true;
    try {
      const cameras = await this.cameraService.listCameras();
      const online = cameras.filter((cam) => cam.available !== false && cam.state !== 'offline');
      if (online.length === 0) return;
      let index = 0;
      const worker = async () => {
        while (!this.stopped && index < online.length) {
          const camera = online[index++]!;
          try {
            if (this.cameraService.refreshSnapshot) {
              await this.cameraService.refreshSnapshot(camera.id);
            } else {
              await this.cameraService.getSnapshot(camera.id);
            }
          } catch {
            // Individual offline/slow camera failures never block other cameras.
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENCY, online.length) }, () => worker()),
      );
    } catch {
      // Ignore transient startup/shutdown listing failures.
    } finally {
      this.running = false;
    }
  }
}
