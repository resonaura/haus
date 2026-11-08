/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { nodeJson } from '@haus/servers';
import { nvrCameraSource } from '../source-url.js';
import type { AutonomousActivity, NodeTarget } from './activity.js';
import type { AnalysisNode } from './placement.js';
import type { MotionDetectionMode } from './settings.js';
import type {
  LocalCapacityMonitor,
  LocalVisionWorkerConstructor,
  MotionCamera,
  MotionCluster,
  MotionConfig,
  MotionDetectionEvent,
  MotionJob,
  MotionWarmPort,
} from './types.js';

export interface MotionStartController {
  stopped: boolean;
  epoch: number;
  abort: AbortController;
  localSupported: boolean;
  localPressured: boolean;
  capacity?: LocalCapacityMonitor;
  worker?: LocalVisionWorkerConstructor;
  ha?: {
    stream(cameraId: string): Promise<string>;
  };
  warm: MotionWarmPort;
  cluster: MotionCluster;
  config: MotionConfig;
  autonomous?: AutonomousActivity;
  jobs: Map<string, MotionJob>;
  cooldowns: Map<string, number>;
  now(): number;
  candidates(): AnalysisNode[];
  release(cameraId: string): Promise<void>;
  deliver(camera: MotionCamera, event: MotionDetectionEvent, expected?: MotionJob): unknown;
}

export async function startMotionCamera(
  controller: MotionStartController,
  camera: MotionCamera,
): Promise<void> {
  if (controller.stopped) return;
  const epoch = controller.epoch;
  const mode = camera.motionDetection?.mode;
  if (mode !== 'objects' && mode !== 'motion') return;
  if (controller.warm.sessions) {
    await startNvrMotionCamera(controller, camera, epoch, mode);
    return;
  }
  const candidates = controller.candidates().slice(0, 3);
  if (
    !candidates.length &&
    (!controller.localSupported || [...controller.jobs.values()].some((job) => job.local))
  ) {
    return;
  }
  if (!controller.ha) return;
  const sourceDeadline = AbortSignal.any([controller.abort.signal, AbortSignal.timeout(6000)]);
  const source = await Promise.race([
    controller.ha.stream(camera.id),
    once(sourceDeadline, 'abort').then(() => {
      throw new Error('detector_source_timeout');
    }),
  ]);
  if (controller.stopped || controller.epoch !== epoch) return;
  for (const node of controller.candidates().slice(0, 3)) {
    const entry = { id: camera.id, source, expires: controller.now() + 45000 };
    const lease = randomBytes(24).toString('hex');
    controller.warm.leases.set(lease, entry);
    try {
      const origin = controller.cluster.health.get(node.id)?.remote?.relayOrigin;
      const resource = controller.warm.resource ? controller.warm.resource(entry, source) : '';
      const url = new URL(`/cluster/source/${lease}/${resource}`, origin).href;
      const remote = (await nodeJson(node as NodeTarget, '/v1/detectors', {
        method: 'POST',
        data: { source: url, mode },
        timeout: 5000,
        signal: controller.abort.signal,
      })) as { id?: string };
      if (!remote.id || !/^[a-f0-9-]{36}$/.test(remote.id)) {
        throw new Error('invalid_detector_job');
      }
      const job: MotionJob = {
        id: remote.id,
        node,
        lease,
        entry,
        mode,
        state: 'starting',
        sequence: 0,
      };
      controller.jobs.set(camera.id, job);
      if (controller.stopped || controller.epoch !== epoch) {
        await controller.release(camera.id);
      }
      return;
    } catch {
      controller.warm.leases.delete(lease);
      controller.cooldowns.set(node.id, controller.now() + 30000);
    }
  }
  // Only one bounded local fallback. Production images include the same worker as the NVR.
  if (
    controller.candidates().length ||
    !controller.localSupported ||
    [...controller.jobs.values()].some((job) => job.local)
  ) {
    return;
  }
  if (
    controller.stopped ||
    !controller.capacity?.detectors ||
    controller.localPressured ||
    !controller.worker
  ) {
    return;
  }
  const job: MotionJob = { local: true, mode };
  const WorkerCtor = controller.worker;
  const worker = new WorkerCtor({
    source,
    mode,
    headers: `Authorization: Bearer ${controller.config.token ?? ''}\r\n`,
    interval: 2500,
    onDetection: (event) => controller.deliver(camera, event, job),
  });
  job.worker = worker;
  controller.jobs.set(camera.id, job);
  if (controller.stopped || controller.epoch !== epoch) {
    await controller.release(camera.id);
  }
}

export async function startNvrMotionCamera(
  controller: MotionStartController,
  camera: MotionCamera,
  epoch: number,
  mode: MotionDetectionMode,
): Promise<void> {
  const sessions = controller.warm.sessions;
  if (!sessions) return;
  const owner = `assist-${randomUUID()}`;
  const prior = controller.autonomous?.priorNode(camera);
  const choices = controller.candidates();
  if (prior) {
    const index = choices.findIndex((node) => node.id === prior.id);
    if (index >= 0) choices.splice(index, 1);
    choices.unshift(prior);
  }
  for (const node of choices.slice(0, 3)) {
    try {
      if (
        controller.autonomous &&
        controller.cluster.health.get(node.id)?.remote?.features?.autonomousCameraActivity === 1
      ) {
        const status = await controller.autonomous.ensure(camera, node);
        controller.jobs.set(camera.id, {
          autonomous: true,
          node,
          policyId: status.policyId,
          mode,
          state: status.state,
          sequence: 0,
        });
        if (controller.stopped || controller.epoch !== epoch) {
          await controller.release(camera.id);
        }
        return;
      }
      if (!sessions.ensure) throw new Error('sessions_ensure_required');
      const entry = await sessions.ensure(camera, owner, false, node);
      const remote = (await nodeJson(node as NodeTarget, '/v1/detectors', {
        method: 'POST',
        data: { cameraSessionId: entry.id, owner, mode },
        timeout: 5000,
        signal: controller.abort.signal,
      })) as { id?: string };
      if (!remote.id || !/^[a-f0-9-]{36}$/.test(remote.id)) {
        throw new Error('invalid_detector_job');
      }
      controller.jobs.set(camera.id, {
        id: remote.id,
        node,
        sessionId: entry.id,
        sessionOwner: owner,
        mode,
        state: 'starting',
        sequence: 0,
      });
      if (controller.stopped || controller.epoch !== epoch) {
        await controller.release(camera.id);
      }
      return;
    } catch {
      await sessions.release?.(camera.id, owner);
      controller.cooldowns.set(node.id, controller.now() + 30000);
    }
  }
  if (
    controller.candidates().length ||
    !controller.localSupported ||
    [...controller.jobs.values()].some((job) => job.local) ||
    !controller.capacity?.detectors ||
    controller.localPressured ||
    controller.stopped ||
    controller.epoch !== epoch ||
    !controller.worker
  ) {
    return;
  }
  const source = nvrCameraSource(camera, sessions.registry());
  const job: MotionJob = { local: true, mode };
  const WorkerCtor = controller.worker;
  job.worker = new WorkerCtor({
    source: source.url,
    mode,
    interval: 2500,
    onDetection: (event) => controller.deliver(camera, event, job),
  });
  controller.jobs.set(camera.id, job);
}
