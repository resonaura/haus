/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { randomUUID } from 'node:crypto';
import { CameraContinuity, type ContinuityEngine, type ContinuityPlan } from './continuity.js';

const uuid = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export interface CameraActivityDetectorJob {
  id: string;
  events: CameraActivityEvent[];
  worker?: { state?: string; calibrated?: boolean; lastResult?: unknown };
}

export interface CameraActivityEvent {
  sequence: number;
  kind: string;
  at?: number;
  requestId?: string;
  recordedEventId?: string;
}

export interface CameraActivityDetector {
  start: (
    source: string,
    mode: 'objects' | 'motion',
    session: { id: string; owner: string },
  ) => { id: string };
  remove: (id: string) => unknown;
  jobs: Map<string, CameraActivityDetectorJob | undefined>;
}

export interface CameraActivityCapture {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  kinds: string[];
  origin: { kind: string; policyId: string };
}

export interface CameraActivityJob {
  plan: ContinuityPlan;
  sessionId: string;
  sequence: number;
  detectorId?: string;
  inferenceAfter?: number;
  capture?: CameraActivityCapture;
  delivered?: Map<string, number>;
  requests?: Map<string, { recordedEventId: string }>;
}

export interface CameraActivityRecordings {
  beginActivity: (capture: CameraActivityCapture, requestId?: string) => Promise<void>;
  interruptActivity: (id: string, reason: string) => Promise<void>;
  activityRequest: (
    cameraId: string,
    policyId: string,
    requestId: string,
  ) => Promise<string | undefined>;
  rememberActivityRequest: (
    cameraId: string,
    policyId: string,
    requestId: string,
    eventId: string,
  ) => Promise<void>;
}

export interface CameraActivityEngine extends ContinuityEngine {}
export class CameraActivity extends CameraContinuity {
  private readonly detectors: CameraActivityDetector;
  private readonly jobs = new Map<string, CameraActivityJob>();
  private readonly detections = new Map<string, Promise<CameraActivityEvent | void>>();

  constructor(
    path: string,
    key: string,
    cameras: CameraActivityEngine,
    detectors: CameraActivityDetector,
    options: { now?: () => number } = {},
  ) {
    super(path, key, cameras, options);
    this.detectors = detectors;
  }

  async initialize(): Promise<this> {
    await super.initialize();
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.tick().catch(() => {}), 1000);
    this.timer.unref();
    return this;
  }

  async validate(values: unknown, restoring = false): Promise<Map<string, ContinuityPlan>> {
    const plans = await super.validate(values, restoring);
    if (!Array.isArray(values)) return plans;
    for (const value of values) {
      const candidate = value as Record<string, unknown>;
      const plan = plans.get(String(candidate.cameraId));
      if (!plan) continue;
      if (
        !uuid(candidate.policyId) ||
        !['objects', 'motion'].includes(String(candidate.mode)) ||
        !Number.isInteger(candidate.postRollSeconds) ||
        (candidate.postRollSeconds as number) < 5 ||
        (candidate.postRollSeconds as number) > 120 ||
        !Number.isInteger(candidate.maxEventSeconds) ||
        (candidate.maxEventSeconds as number) < 30 ||
        (candidate.maxEventSeconds as number) > 300
      )
        throw new Error('invalid_camera_activity');
      Object.assign(plan, {
        policyId: candidate.policyId as string,
        mode: candidate.mode as 'objects' | 'motion',
        postRollSeconds: candidate.postRollSeconds as number,
        maxEventSeconds: candidate.maxEventSeconds as number,
      });
    }
    return plans;
  }

  async release(id: string): Promise<void> {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    if (job) await this.detectors.remove(job.detectorId ?? '');
    for (const session of Array.from(this.cameras.sessions.values()))
      if (session.cameraId === id && session.owners.has(this.owner(id)))
        await this.cameras.release(session.id, this.owner(id));
  }

  status() {
    const now = this.now();
    return {
      profile: 1,
      cameras: [...this.plans.values()]
        .filter((plan) => plan.expiresAt > now)
        .map((plan) => {
          const job = this.jobs.get(plan.cameraId);
          const detector = job?.detectorId ? this.detectors.jobs.get(job.detectorId) : undefined;
          const worker = detector?.worker;
          return {
            cameraId: plan.cameraId,
            policyId: plan.policyId,
            generation: job?.detectorId,
            admitted: Boolean(job && this.cameras.sessions.has(job.sessionId)),
            ready: this.cameras.sessions.get(job?.sessionId ?? '')?.ring?.ready() === true,
            mode: plan.mode,
            expiresAt: plan.expiresAt,
            state: worker?.state ?? 'waiting',
            calibrated: worker?.calibrated === true,
            lastResultAt: worker?.lastResult,
            events: (detector?.events ?? [])
              .filter((event) => event.sequence <= (job?.sequence ?? 0))
              .map((event) => ({ ...event, recordingManaged: true })),
          };
        }),
    };
  }

  detect(
    id: string,
    event: CameraActivityEvent,
    native = false,
  ): Promise<CameraActivityEvent | void> {
    const task = (this.detections.get(id) ?? Promise.resolve())
      .then(() => this.recordDetection(id, event, native))
      .then(() => event);
    this.detections.set(id, task);
    return task.finally(() => {
      if (this.detections.get(id) === task) this.detections.delete(id);
    });
  }

  async trigger(input: Record<string, unknown>): Promise<{ recordedEventId: string }> {
    const plan = this.plans.get(String(input.cameraId));
    if (
      !plan ||
      plan.expiresAt <= this.now() ||
      String(input.policyId) !== String(plan.policyId) ||
      !uuid(input.requestId)
    )
      throw new Error('invalid_camera_activity');
    const prior = await this.cameras.recordings?.activityRequest(
      String(input.cameraId),
      String(plan.policyId),
      String(input.requestId),
    );
    if (prior) return { recordedEventId: prior };
    const job = this.jobs.get(String(input.cameraId));
    if (!job) throw new Error('camera_activity_waiting');
    job.requests ??= new Map();
    const requestId = String(input.requestId);
    const pending = job.requests.get(requestId);
    if (pending) return pending;
    const event: CameraActivityEvent = {
      sequence: 0,
      kind: String(input.kind ?? ''),
      at: Number(input.at ?? 0),
      requestId,
    };
    await this.detect(String(input.cameraId), event, true);
    const recordedEventId = event.recordedEventId ?? '';
    job.requests.set(requestId, { recordedEventId });
    if (job.requests.size > 128) {
      const lastKey = job.requests.keys().next().value;
      if (lastKey) job.requests.delete(lastKey);
    }
    return { recordedEventId };
  }

  async recordDetection(id: string, event: CameraActivityEvent, native: boolean): Promise<void> {
    if (this.stopped) return;
    const plan = this.plans.get(id);
    const job = this.jobs.get(id);
    const allowedKinds = native
      ? ['motion', 'person', 'pet', 'vehicle', 'doorbell']
      : ['motion', 'person', 'pet', 'vehicle'];
    if (
      !plan ||
      !job ||
      plan.expiresAt <= this.now() ||
      !this.samePlan(job.plan, plan) ||
      !allowedKinds.includes(event.kind) ||
      !Number.isSafeInteger(event.at ?? 0) ||
      Math.abs(this.now() - (event.at ?? 0)) > 30000
    )
      return;
    if (this.now() - (job.delivered?.get(event.kind) ?? -Infinity) < 3000) {
      if (job.capture) event.recordedEventId = job.capture.id;
      return;
    }
    job.delivered ??= new Map();
    job.delivered.set(event.kind, this.now());
    const session = this.cameras.sessions.get(job.sessionId);
    if (!session?.ring?.ready()) return;
    const policy = job.plan;
    const maxEventSeconds = policy.maxEventSeconds ?? 300;
    const preRollSeconds = policy.preRollSeconds ?? 8;
    const postRollSeconds = policy.postRollSeconds ?? 20;
    const eventKind = event.kind;
    const eventAt = event.at ?? 0;
    const capture = job.capture;
    const shouldCapture =
      !capture ||
      eventAt - capture.startAt >= maxEventSeconds * 1000 ||
      capture.endAt - Math.min(capture.startAt, eventAt) > maxEventSeconds * 1000 ||
      capture.endAt + 1000 < eventAt ||
      session.ring?.jobs?.get(capture.id)?.state !== 'recording';
    const nextCapture: CameraActivityCapture = shouldCapture
      ? {
          id: randomUUID(),
          cameraId: id,
          startAt: eventAt,
          endAt: eventAt + postRollSeconds * 1000,
          kinds: [eventKind],
          origin: { kind: 'camera-activity', policyId: policy.policyId ?? '' },
        }
      : {
          ...(capture as CameraActivityCapture),
          startAt: Math.min(capture.startAt, eventAt),
          kinds: [...new Set([...capture.kinds, eventKind])],
          endAt: Math.min(
            Math.min(capture.startAt, eventAt) + maxEventSeconds * 1000,
            Math.max(capture.endAt, eventAt + postRollSeconds * 1000),
          ),
        };
    await this.cameras.recordings?.beginActivity(nextCapture, event.requestId);
    if (!session.ring.record) throw new Error('camera_recording_unavailable');
    try {
      await session.ring.record({
        eventId: nextCapture.id,
        startAt: nextCapture.startAt - preRollSeconds * 1000,
        endAt: nextCapture.endAt,
        metadata: { ...nextCapture },
      });
    } catch (error) {
      await this.cameras.recordings?.interruptActivity(
        nextCapture.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
    job.capture = nextCapture;
    event.recordedEventId = nextCapture.id;
  }

  async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      for (const [id, plan] of this.plans) {
        const now = this.now();
        if (plan.expiresAt <= now) {
          await this.release(id);
          continue;
        }
        const retryValue = this.retry.get(id);
        if ((retryValue?.until ?? 0) > now) continue;
        try {
          let job = this.jobs.get(id);
          if (
            job &&
            (!this.samePlan(job.plan, plan) || !this.cameras.sessions.has(job.sessionId))
          ) {
            await this.release(id);
            job = undefined;
          }
          const session = await this.cameras.acquire({ ...plan, owner: this.owner(id) });
          if (this.stopped || !this.plans.has(id) || this.plans.get(id)!.expiresAt <= now) {
            await this.release(id);
            continue;
          }
          if (job && job.sessionId !== session.id) {
            await this.detectors.remove(job.detectorId ?? '');
            this.jobs.delete(id);
            job = undefined;
          }
          if (!job) {
            job = { plan, sessionId: session.id, sequence: 0 };
            this.jobs.set(id, job);
          }
          let detector: CameraActivityDetectorJob | undefined = job.detectorId
            ? this.detectors.jobs.get(job.detectorId)
            : undefined;
          if (!detector && (job.inferenceAfter ?? 0) <= now) {
            try {
              const started = await this.startDetector(
                session.id,
                plan.mode ?? 'motion',
                this.owner(id),
              );
              job.detectorId = started.id;
              job.sequence = 0;
              detector = this.detectors.jobs.get(started.id);
            } catch {
              job.inferenceAfter = now + 10000;
            }
          }
          if (!detector) continue;
          for (const event of detector.events) {
            if (event.sequence <= job.sequence) continue;
            await this.detect(id, event, false);
            job.sequence = event.sequence;
          }
          this.retry.delete(id);
        } catch {
          await this.release(id);
          this.retry.set(id, {
            attempts: Math.min(5, (this.retry.get(id)?.attempts ?? 0) + 1),
            until: this.now() + 10000,
          });
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    await super.stop();
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
    await Promise.allSettled(this.detections.values());
    await Promise.allSettled([...this.jobs.keys()].map((id) => this.release(id)));
  }

  private samePlan(a: ContinuityPlan, b: ContinuityPlan): boolean {
    const left = { ...a, expiresAt: 0 };
    const right = { ...b, expiresAt: 0 };
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private startDetector(
    sessionId: string,
    mode: 'objects' | 'motion',
    ownerValue: string,
  ): Promise<{ id: string }> {
    return Promise.resolve(this.detectors.start('', mode, { id: sessionId, owner: ownerValue }));
  }
}
