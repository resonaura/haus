/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { cameraOperating, type CameraOperatingControls } from './operating.js';
import { Inject } from '@nestjs/common';
import { NativeCameraControls } from './native.js';
import { cameraSpotlight, type CameraSpotlightState } from './spotlight.js';
import { NativeCameraSources, type NativeCameraRegistryItem } from './sources.js';
import { NativeProviders } from '../../providers/native.js';
import { fetchBridgeSnapshot } from '@haus/media/snapshot';
import type { CameraSnapshot } from '../types.js';
import { NativeGraph } from '../../providers/graph/service.js';

const emptyRegistry = () => ({ cameras: [], devices: [], entities: [], states: [] });

/** Owns native camera provider refresh and exposes the same controls used by the Hub API. */
@Injectable()
export class NativeCameraRuntime {
  private readonly logger = new Logger(NativeCameraRuntime.name);
  private readonly operatingControls;
  private readonly spotlightControls;
  private refreshTimer?: NodeJS.Timeout;
  private refreshTask?: Promise<void>;
  private lastFailureLog = 0;

  constructor(
    @Inject(NativeProviders) private readonly providers: NativeProviders,
    @Inject(NativeCameraSources) private readonly sources: NativeCameraSources,
    private readonly controls: NativeCameraControls,
    @Optional() @Inject(NativeGraph) private readonly graph?: NativeGraph,
  ) {
    const registry = () => {
      const base = emptyRegistry();
      return { ...base, cameras: this.sources.merge(base) };
    };
    this.operatingControls = cameraOperating({
      registry,
      ha: { connected: false },
      native: this.controls,
    });
    this.spotlightControls = cameraSpotlight({
      registry,
      ha: { connected: false },
      native: this.controls,
    });
  }

  onApplicationBootstrap(): void {
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 15_000);
    this.refreshTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.graph?.close();
    await this.refreshTask;
  }

  cameras(): NativeCameraRegistryItem[] {
    return this.sources.merge(emptyRegistry());
  }

  async snapshot(cameraId: string): Promise<CameraSnapshot> {
    const camera = this.cameras().find((item) => item.id === cameraId);
    if (!camera?.nativeProvider) throw Error('camera_not_found');
    const source = this.sources.snapshot(camera);
    if (!source) throw Error('snapshot_unavailable');
    const snapshot = await fetchBridgeSnapshot(source);
    return {
      mime: 'image/jpeg',
      buffer: snapshot.buffer,
      at: snapshot.at,
      stale: snapshot.stale,
    };
  }

  manages(cameraId: string): boolean {
    return this.controls.manages(cameraId);
  }

  operating(cameraId: string): CameraOperatingControls {
    return this.operatingControls.read(cameraId);
  }

  writeOperating(
    cameraId: string,
    control: 'indicator' | 'nightVision',
    entityId: string,
    value: boolean,
  ): Promise<void> {
    return this.operatingControls.write(cameraId, control, entityId, value);
  }

  spotlight(cameraId: string): CameraSpotlightState | undefined {
    return this.spotlightControls.read(cameraId);
  }

  writeSpotlight(cameraId: string, entityId: string, value: unknown): Promise<void> {
    return this.spotlightControls.write(cameraId, entityId, value);
  }

  private refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    const task = this.providers
      .tick()
      .then(() => this.graph?.tick())
      .catch(() => {
        if (Date.now() - this.lastFailureLog < 60_000) return;
        this.lastFailureLog = Date.now();
        this.logger.warn(
          'Native camera providers could not refresh; imported controls remain unavailable.',
        );
      })
      .finally(() => {
        if (this.refreshTask === task) this.refreshTask = undefined;
      });
    this.refreshTask = task;
    return task;
  }
}
