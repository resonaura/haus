/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RECORDING_CAMERAS } from './tokens.js';
import { CameraActivity } from '../camera/control/activity.js';
import { WarmStreams } from '../camera/control/warm.js';
import { Motion } from '../camera/motion/motion.js';
import { Recorder } from './recorder/recorder.js';
import type { RecorderCamera } from './recorder/types.js';

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
    @Inject(RECORDING_CAMERAS) private readonly cameras: () => RecorderCamera[],
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
    this.recorder.sync(cameras);
    this.warm.sync(cameras);
    this.motion.sync(cameras);
    this.activity.sync(cameras);
  }

  private tick(): void {
    void this.warm.tick().catch(() => {});
    void this.motion
      .tick()
      .then(() => this.activity.tick())
      .catch(() => {});
  }
}
