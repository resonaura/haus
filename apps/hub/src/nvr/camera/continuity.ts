/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { isIP } from 'node:net';

export interface ContinuitySource {
  kind: string;
  url: string;
}

export interface ContinuityCameraSession {
  id: string;
  cameraId: string;
  owners: Map<string, number>;
  ring?: {
    ready: () => boolean;
    jobs?: Map<string, { state?: string } | undefined>;
    record?: (input: {
      eventId: string;
      startAt: number;
      endAt: number;
      metadata?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

export interface ContinuityEngine {
  source: (input: { kind: unknown; url: unknown }) => Promise<ContinuitySource>;
  sessions: Map<string, ContinuityCameraSession>;
  byCamera: Map<string, ContinuityCameraSession>;
  release: (sessionId: string, owner: string) => Promise<void> | unknown;
  acquire: (input: unknown) => Promise<{ id: string }>;
  recordings?: ContinuityRecordings;
}

export interface ContinuityRecordings {
  beginActivity: (
    capture: import('./activity.js').CameraActivityCapture,
    requestId?: string,
  ) => Promise<void>;
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

export interface ContinuityPlan {
  cameraId: string;
  source: ContinuitySource;
  advertiseHost: string;
  expiresAt: number;
  preRollSeconds: number;
  requireAudio: boolean;
  recordAudio: boolean;
  policyId?: string;
  mode?: 'objects' | 'motion';
  postRollSeconds?: number;
  maxEventSeconds?: number;
}

interface ContinuityOptions {
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const cameraId = (value: unknown): boolean =>
  typeof value === 'string' && /^camera\.[a-z0-9_]{1,120}$/.test(value);
const privateIp = (value: string): boolean => {
  if (isIP(value) === 4)
    return /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(value);
  if (isIP(value) === 6) return /^(?:fc|fd)[a-f0-9:]+$/i.test(value) || value === '::1';
  return false;
};

const owner = (id: string): string =>
  `continuity-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;

function samePlan(a: unknown, b: ContinuityPlan): boolean {
  const left = isRecord(a) ? { ...a, expiresAt: 0 } : {};
  const right: Record<string, unknown> = {
    ...b,
    expiresAt: 0,
  };
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A bounded controller assignment keeps one admitted producer/ring alive without controller heartbeats. */
export class CameraContinuity {
  protected readonly plansMap = new Map<string, ContinuityPlan>();
  get plans(): Map<string, ContinuityPlan> {
    return this.plansMap;
  }
  protected readonly retry = new Map<string, { attempts: number; until: number }>();
  protected tail: Promise<void> = Promise.resolve();
  protected timer?: NodeJS.Timeout;
  protected readonly nowValue: () => number;
  protected busy = false;
  stopped = false;

  constructor(
    protected readonly path: string,
    protected readonly key: string,
    protected readonly cameras: ContinuityEngine,
    { now = Date.now }: ContinuityOptions = {},
  ) {
    this.nowValue = now;
  }

  async initialize(): Promise<this> {
    try {
      const bytes = await readFile(this.path);
      if (bytes.length > 400000) throw new Error('invalid_camera_continuity');
      const cipher = createDecipheriv(
        'aes-256-gcm',
        createHash('sha256').update(this.key).digest(),
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      const values = JSON.parse(
        Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(),
      );
      this.plansMap.clear();
      for (const [planId, plan] of await this.validate(values, true))
        this.plansMap.set(planId, plan);
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT')
        throw new Error('camera_continuity_could_not_be_unlocked');
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick().catch(() => {}), 10000);
      this.timer.unref();
    }
    void this.tick().catch(() => {});
    return this;
  }

  async validate(values: unknown, restoring = false): Promise<Map<string, ContinuityPlan>> {
    if (!Array.isArray(values) || values.length > 64) throw new Error('invalid_camera_continuity');
    const result = new Map<string, ContinuityPlan>();
    for (const value of values) {
      const plan = asContinuityPlan(value);
      if (!plan) throw new Error('invalid_camera_continuity');
      if (restoring && plan.expiresAt <= this.nowValue()) continue;
      if (
        !cameraId(plan.cameraId) ||
        !privateIp(plan.advertiseHost) ||
        !Number.isSafeInteger(plan.expiresAt) ||
        plan.expiresAt <= this.nowValue() ||
        plan.expiresAt > this.nowValue() + 86400000 ||
        !Number.isInteger(plan.preRollSeconds) ||
        plan.preRollSeconds < 0 ||
        plan.preRollSeconds > 30 ||
        typeof plan.requireAudio !== 'boolean' ||
        typeof plan.recordAudio !== 'boolean' ||
        result.has(plan.cameraId)
      )
        throw new Error('invalid_camera_continuity');
      const source = await this.cameras.source(plan.source);
      result.set(plan.cameraId, { ...plan, source });
    }
    return result;
  }

  async persist(plans: Map<string, ContinuityPlan>): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      createHash('sha256').update(this.key).digest(),
      iv,
    );
    const bytes = Buffer.concat([
      cipher.update(JSON.stringify([...plans.values()])),
      cipher.final(),
    ]);
    const temporary = `${this.path}.next`;
    await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), bytes]), {
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  update(values: unknown): Promise<unknown> {
    const task = this.tail
      .catch(() => {})
      .then(async (): Promise<void> => {
        if (this.stopped) throw new Error('camera_continuity_stopped');
        const next = await this.validate(values);
        await this.persist(next);
        const previous = new Map(this.plans);
        this.plansMap.clear();
        for (const [id, plan] of next) this.plansMap.set(id, plan);
        for (const [id, plan] of next) if (!samePlan(previous.get(id), plan)) this.retry.delete(id);
        for (const id of previous.keys()) {
          if (!next.has(id)) {
            this.retry.delete(id);
            await this.release(id);
          }
        }
        await this.tick();
        return;
      });
    this.tail = task;
    return task;
  }
  async release(id: string): Promise<void> {
    const ownerValue = owner(id);
    for (const session of Array.from(this.cameras.sessions.values()))
      if (session.cameraId === id && session.owners.has(ownerValue))
        await this.cameras.release(session.id, ownerValue);
  }

  status() {
    const now = this.nowValue();
    return {
      profile: 1,
      cameras: [...this.plans.values()]
        .filter((plan) => plan.expiresAt > now)
        .map((plan) => ({
          cameraId: plan.cameraId,
          expiresAt: plan.expiresAt,
          state: this.cameras.byCamera.get(plan.cameraId)?.ring?.ready() ? 'ready' : 'waiting',
        })),
    };
  }

  async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      for (const [id, plan] of this.plans) {
        const now = this.nowValue();
        if (plan.expiresAt <= now) {
          await this.release(id);
          continue;
        }
        const retryValue = this.retry.get(id);
        if ((retryValue?.until ?? 0) > now) continue;
        try {
          const session = await this.cameras.acquire({ ...plan, owner: owner(id) });
          const current = this.plans.get(id);
          if (this.stopped || !current || current.expiresAt <= now || !samePlan(current, plan))
            await this.cameras.release(session.id, owner(id));
          else this.retry.delete(id);
        } catch {
          const attempts = Math.min(5, (this.retry.get(id)?.attempts ?? 0) + 1);
          this.retry.set(id, {
            attempts,
            until: this.nowValue() + Math.min(30000, 1000 * 2 ** attempts),
          });
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.tail.catch(() => {});
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  protected now(): number {
    return this.nowValue();
  }

  protected owner(id: string): string {
    return owner(id);
  }
}

function asContinuityPlan(value: unknown): ContinuityPlan | null {
  if (!isRecord(value)) return null;
  const sourceRecord = value.source;
  const cameraIdValue = value.cameraId;
  const expiresAt = value.expiresAt;
  const preRollSeconds = value.preRollSeconds;
  const requireAudio = value.requireAudio;
  const recordAudio = value.recordAudio;
  if (
    typeof cameraIdValue !== 'string' ||
    typeof sourceRecord !== 'object' ||
    sourceRecord === null ||
    typeof (sourceRecord as Record<string, unknown>).kind !== 'string' ||
    typeof (sourceRecord as Record<string, unknown>).url !== 'string' ||
    typeof expiresAt !== 'number' ||
    typeof preRollSeconds !== 'number' ||
    typeof requireAudio !== 'boolean' ||
    typeof recordAudio !== 'boolean'
  )
    return null;
  const sourceRecordValue = sourceRecord as Record<string, unknown>;
  return {
    cameraId: cameraIdValue,
    source: {
      kind: sourceRecordValue.kind as string,
      url: sourceRecordValue.url as string,
    },
    advertiseHost: typeof value.advertiseHost === 'string' ? value.advertiseHost : '',
    expiresAt,
    preRollSeconds,
    requireAudio,
    recordAudio,
  };
}
