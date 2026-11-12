/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Provider } from '@nestjs/common';
import { CameraActivity } from '../camera/control/activity.js';
import { WarmStreams } from '../camera/control/warm.js';
import { Motion } from '../camera/motion/motion.js';
import { NvrCameraSessions } from '../camera/sessions/sessions.js';
import { Cluster } from '../cluster/cluster.js';
import { StandaloneHaClient } from '../ha/client.js';
import { defaults } from '../runtime/appliance-config.js';
import { CatalogLifetime } from '../storage/lifetime.js';
import { Recorder } from './recorder/recorder.js';
import { RECORDING_CLUSTER, RECORDING_SESSIONS } from './tokens.js';

/**
 * Warm streams, motion analysis and activity authority. They register their shutdown after the
 * recorder, so the catalog lifetime stops them first.
 */
export function activityProviders(): Provider[] {
  return [
    {
      provide: StandaloneHaClient,
      inject: [CatalogLifetime],
      useFactory: (lifetime: CatalogLifetime): StandaloneHaClient => {
        const ha = new StandaloneHaClient({ ...defaults, standalone: true });
        lifetime.defer(() => ha.stop());
        return ha;
      },
    },
    {
      provide: WarmStreams,
      inject: [
        CatalogLifetime,
        StandaloneHaClient,
        Recorder,
        RECORDING_CLUSTER,
        RECORDING_SESSIONS,
      ],
      useFactory: (
        lifetime: CatalogLifetime,
        ha: StandaloneHaClient,
        recorder: Recorder,
        cluster: Cluster,
        sessions: NvrCameraSessions,
      ): WarmStreams => {
        const warm = new WarmStreams(ha, recorder, cluster, { sessions });
        lifetime.defer(() => warm.stop());
        return warm;
      },
    },
    {
      provide: Motion,
      inject: [
        CatalogLifetime,
        StandaloneHaClient,
        Recorder,
        RECORDING_CLUSTER,
        WarmStreams,
        RECORDING_SESSIONS,
      ],
      useFactory: (
        lifetime: CatalogLifetime,
        ha: StandaloneHaClient,
        recorder: Recorder,
        cluster: Cluster,
        warm: WarmStreams,
        sessions: NvrCameraSessions,
      ): Motion => {
        const motion = new Motion({
          ha,
          recorder,
          cluster,
          warm,
          config: { ...defaults, standalone: true },
        });
        sessions.authorizeActivityRecording = (node, value) =>
          motion.autonomous?.authorizes(node, value) === true;
        sessions.activityAssignedNode = (camera) => motion.autonomous?.priorNode(camera);
        sessions.clearActivityNode = (id) => motion.autonomous?.clearNode(id);
        lifetime.defer(() => motion.stop());
        return motion;
      },
    },
    {
      provide: CameraActivity,
      inject: [Recorder, Motion],
      useFactory: (recorder: Recorder, motion: Motion): CameraActivity => {
        const activity = new CameraActivity({ recorder, motion });
        activity.captureNative = (id, kind, source, at) =>
          motion.autonomous?.triggerNative(id, kind, source, at) === true;
        motion.onDetection = (id, event) => activity.software(id, event);
        recorder.activitySensors = (camera) => activity.activeSensors(camera);
        return activity;
      },
    },
  ];
}
