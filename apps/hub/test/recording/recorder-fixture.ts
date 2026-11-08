/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { onTestFinished } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestRecordingStore } from '../support/recording.js';
import { Recorder, type RecorderConfig } from '@haus/hub/events';
import { defaults } from '@haus/hub/runtime';

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'haus-recorder-'));
  const media = join(root, 'media');
  const dir = join(root, 'buffer');
  await mkdir(media);
  await mkdir(dir);
  const store = await openTestRecordingStore(join(root, 'db.sqlite'), media);
  const config: RecorderConfig = { ...defaults, data: root, media };
  const recorder = new Recorder(config, {}, store);
  recorder.cameras = [{ id: 'camera.test', available: true, enabled: true, sensors: [] }];
  onTestFinished(async () => {
    await recorder.stop();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, media, dir, store, config, recorder };
}
