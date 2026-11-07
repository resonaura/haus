/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { link, mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EntityManager, Repository } from 'typeorm';
import type { BlobRelease } from '../blob-readers.js';
import { Blobs } from '../blobs.js';
import { RecordingIndex } from '../recording-index.js';
import {
  CameraActivityEventEntity,
  CameraActivityRequestEntity,
  CameraRecordingOutboxEntity,
} from '../../storage/recordings/entities.js';
import type {
  CameraActivityEventRow,
  CameraActivityRequestRow,
  CameraRecordingOutboxRow,
} from '../../storage/recordings/types.js';
import type { CameraRecordingJob } from '@haus/media/recording';
import { openMediaFile } from '@haus/media/pipeline';
import type { CameraActivityCapture } from './activity.js';

const UUID_PATTERN = /^[a-f0-9-]{36}$/;
const INTERRUPT_REASONS = ['storage_full', 'camera_recording_incomplete', 'node_stopped'];
const ALLOWED_KINDS = new Set(['manual', 'motion', 'person', 'pet', 'vehicle', 'doorbell']);

export type CameraRecordingMetadata = {
  id: string;
  cameraId: string;
  startAt: number;
  endAt: number;
  kinds: string[];
};

export interface CameraRecordingsOptions {
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function captureMetadata(
  value: unknown,
  cameraId: string,
  startAt: number,
  endAt: number,
): CameraRecordingMetadata | undefined {
  if (value === undefined) return undefined;
  const record = isRecord(value) ? value : null;
  if (
    !record ||
    !UUID_PATTERN.test(String(record.id)) ||
    typeof record.cameraId !== 'string' ||
    record.cameraId !== cameraId ||
    typeof record.startAt !== 'number' ||
    record.startAt !== startAt ||
    typeof record.endAt !== 'number' ||
    record.endAt !== endAt ||
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    endAt <= startAt ||
    !Array.isArray(record.kinds) ||
    record.kinds.length === 0 ||
    record.kinds.length > 10 ||
    !record.kinds.every((kind) => typeof kind === 'string' && ALLOWED_KINDS.has(kind))
  )
    throw new Error('invalid_camera_recording');
  const kinds: string[] = [];
  for (const kind of record.kinds) {
    if (typeof kind === 'string' && !kinds.includes(kind)) kinds.push(kind);
  }
  return { id: String(record.id), cameraId, startAt, endAt, kinds };
}

/** A durable outbox bridges capture completion, archive admission and controller recovery. */
export class CameraRecordings {
  private readonly outbox: Repository<CameraRecordingOutboxRow>;
  private readonly events: Repository<CameraActivityEventRow>;
  private readonly requests: Repository<CameraActivityRequestRow>;
  readonly releases = new Map<string, BlobRelease>();
  private tail: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private lastArchiveWarning?: string;
  stopped = false;
  private readonly now: () => number;

  constructor(
    private readonly root: string,
    private readonly recordings: RecordingIndex,
    private readonly blobs: Blobs,
    { now = Date.now }: CameraRecordingsOptions = {},
  ) {
    this.outbox = recordings.source.getRepository(CameraRecordingOutboxEntity);
    this.events = recordings.source.getRepository(CameraActivityEventEntity);
    this.requests = recordings.source.getRepository(CameraActivityRequestEntity);
    this.now = now;
  }

  async initialize(): Promise<this> {
    const outboxIds = new Set(
      (await this.outbox.find({ select: { id: true } })).map(({ id }) => id),
    );
    for (const event of await this.events.findBy({ state: 'recording' }))
      if (!outboxIds.has(event.id)) {
        event.state = 'interrupted';
        event.error = 'node_restarted';
        await this.events.save(event);
      }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // A crash between hard-linking a finished clip and committing its receipt
    // leaves an unreferenced file. Never infer metadata from its filename.
    for (const name of await readdir(this.root))
      if (/^[a-f0-9-]{36}\.mp4$/.test(name)) {
        const row = await this.outbox.findOne({
          where: { id: name.slice(0, -4) },
          select: { archived: true },
        });
        if (!row || row.archived === 1) await rm(join(this.root, name), { force: true });
      }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick().catch(() => {}), 5000);
      this.timer.unref();
    }
    void this.tick().catch(() => process.emitWarning('camera recording archive tick failed'));
    return this;
  }

  preserve(job: CameraRecordingJob): Promise<void> {
    const task = this.tail.catch(() => {}).then(() => this.preserveOne(job));
    this.tail = task;
    return task;
  }

  async beginActivity(event: CameraActivityCapture, requestId?: string): Promise<void> {
    await this.recordings.source.transaction(async (manager) => {
      const events = manager.getRepository(CameraActivityEventEntity);
      const count = await events.countBy({ state: 'interrupted', acknowledged: 0 });
      if (count >= 1024) throw new Error('camera_activity_journal_full');
      const existing = await events.findOneBy({ id: event.id });
      if (!existing) {
        const latest = await events
          .createQueryBuilder('event')
          .orderBy('event.sequence', 'DESC')
          .getOne();
        await events.insert({
          sequence: (latest?.sequence ?? 0) + 1,
          id: event.id,
          value: JSON.stringify(event),
          state: 'recording',
          error: null,
          acknowledged: 0,
        });
      } else if (existing.state === 'recording') {
        await events.update({ id: event.id }, { value: JSON.stringify(event) });
      }
      if (requestId)
        await this.rememberActivityRequestWithManager(
          manager,
          event.cameraId,
          event.origin.policyId,
          requestId,
          event.id,
        );
    });
  }

  async activityRequest(
    cameraId: string,
    policyId: string,
    requestId: string,
  ): Promise<string | undefined> {
    const row = await this.requests.findOneBy({ cameraId, policyId, requestId });
    return row?.eventId;
  }

  async rememberActivityRequest(
    cameraId: string,
    policyId: string,
    requestId: string,
    eventId: string,
  ): Promise<void> {
    await this.recordings.source.transaction((manager) =>
      this.rememberActivityRequestWithManager(manager, cameraId, policyId, requestId, eventId),
    );
  }

  async interruptActivity(id: string, reason: string): Promise<void> {
    await this.events.update(
      { id, state: 'recording' },
      {
        state: 'interrupted',
        error: INTERRUPT_REASONS.includes(reason) ? reason : 'capture_interrupted',
      },
    );
  }

  async interruptedActivities(cursor = '0'): Promise<{
    items: Array<{ event: CameraActivityCapture; state: string; error: string }>;
    nextCursor: string | null;
  }> {
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
      throw new Error('invalid_cursor');
    const rows = await this.events
      .createQueryBuilder('event')
      .leftJoin('camera_recording_outbox', 'outbox', 'outbox.id = event.id')
      .where("event.state='interrupted'")
      .andWhere('event.acknowledged=0')
      .andWhere('event.sequence > :cursor', { cursor: Number(cursor) })
      .andWhere('outbox.id IS NULL')
      .orderBy('event.sequence', 'ASC')
      .take(17)
      .getMany();
    return {
      items: rows.slice(0, 16).map((row) => ({
        event: JSON.parse(row.value) as CameraActivityCapture,
        state: 'interrupted',
        error: row.error ?? '',
      })),
      nextCursor: rows.length > 16 ? String(rows[15].sequence) : null,
    };
  }

  async acknowledgeInterrupted(id: string): Promise<{ acknowledged: boolean }> {
    await this.events.update({ id, state: 'interrupted' }, { acknowledged: 1 });
    return { acknowledged: true };
  }

  async preserveOne(job: CameraRecordingJob): Promise<void> {
    if (!job.metadata) return;
    const old = await this.outbox.findOne({ where: { id: job.id }, select: { value: true } });
    const result = job.result;
    const bytes = result?.bytes ?? 0;
    const sha256 = result?.sha256;
    if (old) {
      if (JSON.parse(old.value).sha256 !== sha256) throw new Error('camera_recording_conflict');
      return;
    }
    const pending = await this.outbox.find({ where: { archived: 0 }, select: { value: true } });
    if (
      pending.length >= 128 ||
      pending.reduce((sum, row) => sum + (JSON.parse(row.value).bytes ?? 0), 0) + bytes >
        2 * 1024 ** 3
    )
      throw new Error('camera_recording_outbox_full');
    const file = join(this.root, `${job.id}.mp4`);
    const release: BlobRelease = await this.blobs.reserveWorkspace(bytes);
    try {
      await link(job.output ?? '', file);
      const handle = await open(file, 'r');
      try {
        await handle.chmod(0o600);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const directory = await open(this.root, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      const value = {
        ...result,
        event: {
          ...job.metadata,
          duration: result?.duration,
          mediaStartAt: result?.mediaStartAt,
          playbackVersion: 0,
          playbackInfo: { audio: result?.audio, sourceAudioMissing: false },
        },
      };
      await this.recordings.source.transaction(async (manager) => {
        const outbox = manager.getRepository(CameraRecordingOutboxEntity);
        const existing = await outbox.findOneBy({ id: job.id });
        if (existing) {
          if (JSON.parse(existing.value).sha256 !== sha256)
            throw new Error('camera_recording_conflict');
          return;
        }
        await outbox.insert({
          id: job.id,
          value: JSON.stringify(value),
          archived: 0,
          acknowledged: 0,
        });
        await manager
          .getRepository(CameraActivityEventEntity)
          .update({ id: job.id }, { state: 'completed' });
      });
      this.releases.set(job.id, release);
    } catch (error) {
      release();
      await rm(file, { force: true });
      throw error;
    }
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    if (!this.running) {
      this.running = this.archive().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async archive(): Promise<void> {
    const pending = await this.outbox.find({
      where: { archived: 0 },
      order: { sequence: 'ASC' },
      take: 4,
    });
    for (const row of pending) {
      if (this.stopped) break;
      const value = JSON.parse(row.value) as Record<string, unknown>;
      const file = join(this.root, `${row.id}.mp4`);
      try {
        const info = await stat(file);
        if (info.size !== value.bytes) throw new Error('camera_recording_incomplete');
        // Account for retained workspace copies when retrying after a restart.
        // Archive writes retain their normal quota.
        if (!this.releases.has(row.id))
          this.releases.set(row.id, await this.blobs.reserveWorkspace(info.size));
        const stream = openMediaFile(file);
        try {
          const saved = await this.blobs.put(String(value.sha256), stream, info.size);
          if (saved.existing) {
            const verified = await this.blobs.verify(String(value.sha256));
            if (!verified.verified || verified.bytes !== info.size)
              throw new Error('camera_recording_incomplete');
          }
        } finally {
          stream.destroy();
        }
        const existing = await this.recordings.get(row.id);
        if (
          !existing ||
          (existing.digest === value.sha256 && existing.storageVariant !== 'prepared')
        )
          await this.recordings.add({
            event: value.event,
            digest: value.sha256,
            variant: 'original',
          });
        else if (existing.originalDigest !== value.sha256 && existing.digest !== value.sha256)
          throw new Error('camera_recording_conflict');
        await this.outbox.update({ id: row.id }, { archived: 1 });
        this.releases.get(row.id)?.();
        this.releases.delete(row.id);
      } catch (error) {
        // A full archive does not erase the finished clip or block Live/rings.
        const reason = error instanceof Error ? error.message : 'unknown';
        if (reason !== this.lastArchiveWarning) {
          process.emitWarning(`camera recording archive retry failed: ${reason}`);
          this.lastArchiveWarning = reason;
        }
      }
    }
  }

  async get(id: string): Promise<Record<string, unknown> | null> {
    const row = await this.outbox.findOneBy({ id });
    if (!row) return null;
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    return {
      ...parsed,
      state: row.archived === 1 ? 'ready' : 'archiving',
      acknowledged: Boolean(row.acknowledged),
    };
  }

  async list(
    cursor = '0',
  ): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
      throw new Error('invalid_cursor');
    const rows = await this.outbox
      .createQueryBuilder('outbox')
      .where('outbox.archived=1')
      .andWhere('outbox.acknowledged=0')
      .andWhere('outbox.sequence > :cursor', { cursor: Number(cursor) })
      .orderBy('outbox.sequence', 'ASC')
      .take(17)
      .getMany();
    return {
      items: rows.slice(0, 16).map((row) => ({
        ...(JSON.parse(row.value) as Record<string, unknown>),
        state: 'ready',
        acknowledged: false,
      })),
      nextCursor: rows.length > 16 ? String(rows[15].sequence) : null,
    };
  }

  async acknowledge(id: string, digest: string): Promise<{ acknowledged: boolean }> {
    const value = await this.get(id);
    if (!value || value.state !== 'ready' || value.sha256 !== digest)
      throw new Error('camera_recording_not_found');
    await this.outbox.update({ id }, { acknowledged: 1 });
    return { acknowledged: true };
  }

  async pending(digest: string): Promise<boolean> {
    const rows = await this.outbox.find({ where: { acknowledged: 0 }, select: { value: true } });
    return rows.some((row) => JSON.parse(row.value).sha256 === digest);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.tail.catch(() => {});
    await this.running;
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }

  private async rememberActivityRequestWithManager(
    manager: EntityManager,
    cameraId: string,
    policyId: string,
    requestId: string,
    eventId: string,
  ): Promise<void> {
    const requests = manager.getRepository(CameraActivityRequestEntity);
    await requests
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoff', { cutoff: this.now() - 86400000 })
      .execute();
    await requests
      .createQueryBuilder()
      .insert()
      .values({ cameraId, policyId, requestId, eventId, createdAt: this.now() })
      .orIgnore()
      .execute();
  }
}
