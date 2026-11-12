/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RECORDING_CAMERAS } from './tokens.js';
import { CameraActivity } from '../camera/control/activity.js';
import { CameraAvailability } from '../camera/control/availability.js';
import { WarmStreams } from '../camera/control/warm.js';
import { Motion } from '../camera/motion/motion.js';
import { StandaloneHaClient } from '../ha/client.js';
import { Recorder } from './recorder/recorder.js';
import type { RecorderCamera } from './recorder/types.js';
import { RecordingStore } from './recording.store.js';

const SYNC_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 4000;

/** Starts recorder recovery at bootstrap and keeps capture aligned with the camera registry. */
@Injectable()
export class RecordingOwner implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;

  constructor(
    @Inject(Recorder) private readonly recorder: Recorder,
    @Inject(WarmStreams) private readonly warm: WarmStreams,
    @Inject(Motion) private readonly motion: Motion,
    @Inject(CameraActivity) private readonly activity: CameraActivity,
    @Inject(CameraAvailability) private readonly availability: CameraAvailability,
    @Inject(RecordingStore) private readonly store: RecordingStore,
    @Inject(RECORDING_CAMERAS) private readonly cameras: () => RecorderCamera[],
    @Optional() @Inject(StandaloneHaClient) private readonly ha?: StandaloneHaClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recorder.initialize();
    await this.motion.initialize();
    this.sync();
    this.ticker = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.ticker.unref();
    this.timer = setInterval(() => this.sync(), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  /** Only the sync timer stops here; recorder/capture shutdown is ordered by the catalog lifetime. */
  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.ticker);
    this.timer = undefined;
    this.ticker = undefined;
  }

  private sync(): void {
    const cameras = this.cameras();
    this.availability.apply(cameras, [], this.recorder.buffers);
    this.recorder.sync(cameras);
    this.warm.sync(cameras);
    this.motion.sync(cameras);
    this.activity.sync(cameras);
    void this.observeAvailability(cameras);
  }

  private async observeAvailability(cameras: RecorderCamera[]): Promise<void> {
    const at = Date.now();
    for (const camera of cameras) {
      const isNative =
        'nativeProvider' in camera &&
        Boolean((camera as { nativeProvider?: unknown }).nativeProvider);
      const isIndependent =
        'independentSource' in camera &&
        Boolean((camera as { independentSource?: unknown }).independentSource);
      const state =
        !this.ha?.connected && !isNative && !isIndependent
          ? 'unknown'
          : camera.available
            ? 'online'
            : 'offline';
      await this.store.observeAvailability(camera.id, state, at).catch(() => {});
    }
  }

  private tick(): void {
    void this.warm.tick().catch(() => {});
    void this.motion
      .tick()
      .then(() => this.activity.tick())
      .catch(() => {});
  }
}
