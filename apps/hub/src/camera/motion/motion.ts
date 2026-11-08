/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { access } from 'node:fs/promises';
import { nodeJson, nodeRequest } from '@haus/servers';
import { AutonomousActivity, type NodeTarget } from './activity.js';
import { analysisCandidates, type AnalysisNode } from './placement.js';
import { MAX_ASSIST_DELAY_MS, type MotionDetectionMode } from './settings.js';
import { startMotionCamera, startNvrMotionCamera } from './start.js';
import type {
  ActivityStorePort,
  LocalCapacityMonitor,
  LocalVisionWorkerConstructor,
  MotionCamera,
  MotionCluster,
  MotionConfig,
  MotionDetectionEvent,
  MotionJob,
  MotionWarmPort,
} from './types.js';

async function eachWorker<T>(
  items: readonly T[],
  visit: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        await visit(items[index]!);
      }
    }),
  );
}

export interface MotionRecorderPort {
  store?: ActivityStorePort;
  trigger?(cameraId: string, kind: string, source: string, at: number): Promise<unknown> | unknown;
}

export interface MotionOptions {
  ha?: {
    stream(cameraId: string): Promise<string>;
  };
  recorder: MotionRecorderPort;
  cluster?: MotionCluster;
  warm?: MotionWarmPort;
  config?: MotionConfig;
  now?: () => number;
  worker?: LocalVisionWorkerConstructor;
  onDetection?: (cameraId: string, event: MotionDetectionEvent) => unknown;
}

/** Sticky assignments, bounded work, expiring capabilities and failure cooldowns. */
export class Motion {
  readonly ha?: { stream(cameraId: string): Promise<string> };
  readonly recorder: MotionRecorderPort;
  readonly cluster: MotionCluster;
  readonly warm: MotionWarmPort;
  readonly config: MotionConfig;
  now: () => number;
  worker?: LocalVisionWorkerConstructor;
  onDetection?: (cameraId: string, event: MotionDetectionEvent) => unknown;
  readonly jobs = new Map<string, MotionJob>();
  readonly cooldowns = new Map<string, number>();
  cameras: MotionCamera[] = [];
  localSupported = false;
  capacity?: LocalCapacityMonitor;
  readonly abort = new AbortController();
  readonly autonomous?: AutonomousActivity;
  epoch = 0;
  stopped = false;
  busy = false;
  running?: Promise<void>;

  constructor({
    ha,
    recorder,
    cluster = { nodes: () => [], health: new Map() },
    warm = { leases: new Map() },
    config = {},
    now = () => Date.now(),
    worker,
    onDetection,
  }: MotionOptions) {
    this.ha = ha;
    this.recorder = recorder;
    this.cluster = cluster;
    this.warm = warm;
    this.config = config;
    this.now = now;
    this.worker = worker;
    this.onDetection = onDetection;
    if (recorder.store && warm?.sessions?.catalog?.activity) {
      this.autonomous = new AutonomousActivity({
        store: recorder.store,
        config,
        cluster,
        sessions: warm.sessions,
        now,
      });
    }
  }

  async initialize(): Promise<void> {
    try {
      const candidates = [
        new URL('../../../lib/vision/model.onnx', import.meta.url),
        new URL('../../../../../packages/ai/vision/model.onnx', import.meta.url),
      ];
      await Promise.any(candidates.map((url) => access(url)));
      const ai = await import('@haus/ai');
      this.worker ??= ai.VisionWorker;
      this.capacity = await new ai.Capacity().initialize();
      this.localSupported = true;
    } catch {
      /* Older/development installations simply have no local inference worker. */
    }
  }

  get localPressured(): boolean {
    return Boolean(this.capacity?.pressured || this.capacity?.analysisPressured);
  }

  sync(cameras: MotionCamera[]): void {
    this.epoch = (this.epoch ?? 0) + 1;
    this.cameras = cameras;
    for (const [id, job] of this.jobs) {
      const camera = cameras.find((item) => item.id === id);
      if (
        (!camera?.available &&
          !(camera && this.autonomous?.active(camera.id) && this.autonomous.enabled(camera))) ||
        !camera.enabled ||
        !camera.motionDetection?.enabled ||
        camera.motionDetection.mode !== job.mode
      ) {
        void this.release(id).catch(() => {});
      }
    }
  }

  status(id: string): { state: string; fresh: boolean; [key: string]: unknown } {
    const job = this.jobs.get(id);
    const camera = this.cameras.find((item) => item.id === id);
    const candidate = job ? undefined : this.candidates()[0];
    const home = !job?.node && !candidate;
    const blocked =
      home &&
      (!this.localSupported ||
        !this.capacity?.detectors ||
        this.localPressured ||
        (!job && [...this.jobs.values()].some((entry) => entry.local)));
    const lastResult = job?.local ? job.worker?.lastResult : job?.lastResultAt;
    return {
      fresh: Boolean(
        job &&
        (job.local ? job.worker?.calibrated !== false : job.calibrated !== false) &&
        typeof lastResult === 'number' &&
        Number.isFinite(lastResult) &&
        this.now() - lastResult >= -5000 &&
        this.now() - lastResult < 12000,
      ),
      state: (job
        ? job.local
          ? job.worker?.state
          : job.state
        : camera?.motionDetection?.enabled && camera.enabled && this.config.recording_enabled
          ? 'waiting'
          : 'off') as string,
      processor: home
        ? this.config.standalone
          ? 'Haus server'
          : 'Home Assistant'
        : (job?.node?.name ?? candidate?.name),
      placement: home ? 'home' : 'nvr',
      ...(home
        ? {
            fallbackReason: this.fallbackReason(),
            ...(blocked
              ? {
                  blocked:
                    !this.localSupported || !this.capacity?.detectors ? 'unsupported' : 'capacity',
                }
              : {}),
          }
        : {}),
    };
  }

  fallbackReason(): string {
    const nodes = this.cluster.nodes();
    if (!nodes.length) return 'no_nodes';
    const supported = nodes.filter((node) => node.enabled && node.roles.includes('stream'));
    if (!supported.length) return 'no_analysis_nodes';
    const online = supported.filter((node) => this.cluster.health.get(node.id)?.online);
    if (!online.length) return 'nodes_unavailable';
    return online.some((node) => this.cluster.health.get(node.id)?.remote?.detectors?.supported)
      ? 'nodes_busy'
      : 'no_analysis_nodes';
  }

  async release(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    if (job.autonomous) {
      if (!this.stopped) await this.autonomous?.revoke(id);
      return;
    }
    if (job.lease) this.warm.leases.delete(job.lease);
    if (job.sessionOwner) {
      await this.warm.sessions?.release?.(id, job.sessionOwner);
    }
    if (job.local) {
      await job.worker?.stop();
    } else if (job.node && job.id) {
      await nodeRequest(job.node as NodeTarget, `/v1/detectors/${job.id}`, {
        method: 'DELETE',
        timeout: 3000,
      })
        .then((response) => response.body?.cancel())
        .catch(() => {});
    }
  }

  deliver(camera: MotionCamera, event: MotionDetectionEvent, expected?: MotionJob): unknown {
    // A compromised/late worker cannot backdate or flood recording triggers.
    if (
      !['motion', 'person', 'pet', 'vehicle'].includes(event.kind) ||
      typeof event.at !== 'number' ||
      !Number.isFinite(event.at) ||
      Math.abs(this.now() - event.at) > MAX_ASSIST_DELAY_MS
    ) {
      return;
    }
    const job = this.jobs.get(camera.id);
    if (!job || (expected && job !== expected)) return;
    if (this.now() - (job.delivered?.[event.kind] ?? 0) < 3000) return;
    job.delivered ??= {};
    job.delivered[event.kind] = this.now();
    try {
      if (this.onDetection) return this.onDetection(camera.id, event);
      return Promise.resolve(
        this.recorder.trigger?.(camera.id, event.kind, 'haus_software_motion', event.at),
      ).catch(() => {});
    } catch {}
  }

  candidates(): AnalysisNode[] {
    return analysisCandidates(
      this.cluster.nodes(),
      this.cluster.health,
      this.jobs,
      this.cooldowns,
      this.now(),
    );
  }

  async start(camera: MotionCamera): Promise<void> {
    await startMotionCamera(this, camera);
  }

  async startNvr(camera: MotionCamera, epoch: number, mode: MotionDetectionMode): Promise<void> {
    await startNvrMotionCamera(this, camera, epoch, mode);
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.workTick().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async workTick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const enabled = this.cameras.filter(
        (camera) =>
          camera.motionDetection?.enabled &&
          camera.enabled &&
          (camera.available ||
            (this.autonomous?.active(camera.id) && this.autonomous.enabled(camera))) &&
          this.config.recording_enabled,
      );
      await eachWorker([...this.jobs], async ([id, job]) => {
        if (this.stopped || this.jobs.get(id) !== job) return;
        const camera = enabled.find((item) => item.id === id);
        if (!camera || camera.motionDetection?.mode !== job.mode) {
          await this.release(id);
          return;
        }
        try {
          if (job.local) {
            if (job.worker?.state === 'failed') {
              throw new Error('local_detector_failed');
            }
            // Move a local fallback to a recovered NVR without disturbing other cameras.
            if (this.candidates().length) {
              await this.release(id);
              return;
            }
            job.overloadedAt = this.localPressured ? (job.overloadedAt ?? this.now()) : undefined;
            const memoryRatio =
              (this.capacity?.memoryUsed ?? 0) / (this.capacity?.memory ?? Infinity);
            if ((job.overloadedAt && this.now() - job.overloadedAt > 20000) || memoryRatio > 0.9) {
              throw new Error('local_detector_overloaded');
            }
          } else {
            const node = job.node;
            const current = node
              ? this.cluster.nodes().find((item) => item.id === node.id)
              : undefined;
            if (
              !node ||
              !current?.enabled ||
              !current.roles.includes('stream') ||
              !this.cluster.health.get(node.id)?.online
            ) {
              throw new Error('detector_node_unavailable');
            }
            const resources = this.cluster.health.get(node.id)?.remote?.resources;
            const pressured = Boolean(resources?.pressured || resources?.analysisPressured);
            job.overloadedAt = pressured ? (job.overloadedAt ?? this.now()) : undefined;
            if (job.overloadedAt && this.now() - job.overloadedAt > 20000) {
              throw new Error('detector_overloaded');
            }
            if (job.autonomous && this.autonomous) {
              const status = await this.autonomous.ensure(camera, node);
              job.state = status.state;
              job.lastResultAt = status.lastResultAt;
              job.calibrated = status.calibrated;
              if (job.generation !== status.generation) {
                job.generation = status.generation;
                job.sequence = 0;
              }
              for (const event of (status.events ?? []).slice(-64)) {
                if (Number.isSafeInteger(event.sequence) && event.sequence > (job.sequence ?? 0)) {
                  job.sequence = event.sequence;
                  this.deliver(camera, { ...event, recordingManaged: true }, job);
                }
              }
              return;
            }
            if (job.entry) job.entry.expires = this.now() + 45000;
            if (job.sessionOwner && this.warm.sessions?.ensure) {
              const entry = await this.warm.sessions.ensure(camera, job.sessionOwner, false, node);
              if (entry.id !== job.sessionId) {
                throw new Error('detector_session_replaced');
              }
            }
            const status = (await nodeJson(node as NodeTarget, `/v1/detectors/${job.id}`, {
              timeout: 4000,
              signal: this.abort.signal,
            })) as {
              state?: string;
              lastResultAt?: number;
              calibrated?: boolean;
              events?: Array<{ sequence: number; kind: string; at: number }>;
            };
            if (!status.state || !['starting', 'running'].includes(status.state)) {
              throw new Error('detector_failed');
            }
            job.state = status.state;
            job.lastResultAt = status.lastResultAt;
            job.calibrated = status.calibrated;
            for (const event of (status.events ?? []).slice(-64)) {
              if (Number.isSafeInteger(event.sequence) && event.sequence > (job.sequence ?? 0)) {
                job.sequence = event.sequence;
                this.deliver(camera, event, job);
              }
            }
          }
        } catch {
          this.cooldowns.set(job.node?.id ?? id, this.now() + 30000);
          await this.release(id);
        }
      });
      await this.autonomous?.sync();
      for (const camera of enabled
        .filter(
          (item) => !this.jobs.has(item.id) && (this.cooldowns.get(item.id) ?? 0) <= this.now(),
        )
        .slice(0, 3)) {
        if (!this.jobs.has(camera.id) && (this.cooldowns.get(camera.id) ?? 0) <= this.now()) {
          try {
            await this.start(camera);
          } catch {
            this.cooldowns.set(camera.id, this.now() + 30000);
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    await this.running?.catch(() => {});
    await this.autonomous?.stop();
    this.capacity?.stop?.();
    await Promise.allSettled([...this.jobs.keys()].map((id) => this.release(id)));
  }
}
