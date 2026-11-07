/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomUUID } from 'node:crypto';
import { DataSource, LessThan, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type { Transactions } from '../storage/transactions.js';
import {
  type CameraAvailabilityRecord,
  type EventDetection,
  type EventRecord,
  type RecordingEventListOptions,
} from './recording.types.js';
import { toEventRecord, toRawEvent } from './recording.mapper.js';
import { RecordingQueries } from './recording.queries.js';
import {
  CameraAvailabilityEntity,
  EventArchiveEntity,
  EventArchiveLocationEntity,
  EventArchiveStateEntity,
  RecordingEventEntity,
  RecordingSettingEntity,
} from './recording.entities.js';
import type { CameraAvailabilityRow, RecordingEventRow } from './recording.entities.js';
import { RecordingMediaManager, type MissingLocalMedia } from './recording.media.js';
import { RecordingArchiveCatalog } from './recording.archive.js';

export * from './recording.types.js';
export * from './recording.media.js';

const queues = new WeakMap<DataSource, Promise<void>>();

export class RecordingStore {
  readonly media: string;
  private readonly mediaManager: RecordingMediaManager;
  private readonly queries: RecordingQueries;
  private readonly transactions?: Transactions;
  readonly archive: RecordingArchiveCatalog;
  private acceptingWrites = true;
  private closeTask: Promise<void> | null = null;

  constructor(
    readonly source: DataSource,
    mediaPath: string,
    transactions?: Transactions,
  ) {
    if (source.options.type !== 'better-sqlite3' || !source.isInitialized) {
      throw Error('invalid_recording_source');
    }
    this.media = mediaPath;
    this.transactions = transactions;
    this.queries = new RecordingQueries(source);
    this.mediaManager = new RecordingMediaManager(this.media, this);
    this.archive = new RecordingArchiveCatalog({
      read: (operation) => this.read(operation),
      write: (operation) => this.write(operation),
    });
  }

  isMediaPinned(id: string): boolean {
    return this.mediaManager.isMediaPinned(id);
  }
  isMediaEvicting(id: string): boolean {
    return this.mediaManager.isMediaEvicting(id);
  }

  overrides(): Promise<Record<string, unknown>> {
    return this.read(async (manager) => {
      const rows = await manager.find(RecordingSettingEntity);
      return Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.value) as unknown]));
    });
  }

  async setCamera(id: string, value: Record<string, unknown>): Promise<void> {
    await this.write((manager) =>
      manager.upsert(RecordingSettingEntity, { id, value: JSON.stringify(value) }, ['id']),
    );
  }

  observeAvailability(cameraId: string, state: string, at = Date.now()): Promise<void> {
    if (!['online', 'offline', 'unknown'].includes(state)) {
      return Promise.reject(Error('invalid_availability'));
    }
    return this.write(async (manager) => {
      const previous = await manager.findOne(CameraAvailabilityEntity, {
        where: { cameraId },
        order: { startAt: 'DESC' },
      });
      if (previous && at < previous.endAt) return;
      if (previous && at - previous.endAt <= 45000) {
        await manager.update(
          CameraAvailabilityEntity,
          { cameraId, startAt: previous.startAt },
          { endAt: at },
        );
        if (previous.state === state) return;
      }
      const row: CameraAvailabilityRow = { cameraId, startAt: at, endAt: at, state };
      await manager.upsert(CameraAvailabilityEntity, row, ['cameraId', 'startAt']);
    });
  }

  async availability({
    cameraId,
    from = 0,
    to = Date.now(),
  }: { cameraId?: string; from?: number; to?: number } = {}): Promise<CameraAvailabilityRecord[]> {
    const where = {
      endAt: MoreThanOrEqual(from),
      startAt: LessThanOrEqual(to),
      ...(cameraId ? { cameraId } : {}),
    };
    const rows = await this.read((manager) =>
      manager.find(CameraAvailabilityEntity, {
        where,
        order: { startAt: 'DESC' },
        take: 5000,
      }),
    );
    return rows.reverse().map((row) => ({
      cameraId: row.cameraId,
      startAt: Math.max(from, row.startAt),
      endAt: Math.min(to, row.endAt),
      state: row.state,
    }));
  }

  async create(
    cameraId: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
  ): Promise<EventRecord> {
    const id = randomUUID();
    const detections: EventDetection[] = [{ kind, at, sensorId }];
    const row: Partial<RecordingEventRow> = {
      id,
      cameraId,
      startAt: at,
      endAt,
      status: 'recording',
      kinds: JSON.stringify([kind]),
      detections: JSON.stringify(detections),
    };
    await this.write((manager) => manager.insert(RecordingEventEntity, row));
    const event = await this.get(id);
    if (!event) throw Error('recording_event_missing');
    return event;
  }

  async adoptActivity(event: {
    id: string;
    cameraId: string;
    startAt: number;
    endAt: number;
    kinds: string[];
  }): Promise<EventRecord | null> {
    const row: Partial<RecordingEventRow> = {
      id: event.id,
      cameraId: event.cameraId,
      startAt: event.startAt,
      endAt: event.endAt,
      status: 'recording',
      kinds: JSON.stringify(event.kinds),
      detections: JSON.stringify([
        { kind: event.kinds[0], at: event.startAt, sensorId: 'haus_activity_assist' },
      ]),
      localOriginal: false,
      localPlayback: false,
    };
    await this.write((manager) =>
      manager
        .createQueryBuilder()
        .insert()
        .into(RecordingEventEntity)
        .values(row)
        .orIgnore()
        .execute(),
    );
    return this.get(event.id);
  }

  async interruptActivity(id: string, reason?: string): Promise<void> {
    await this.write(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(RecordingEventEntity)
        .set({
          status: 'interrupted',
          error:
            reason === 'storage_full'
              ? 'The NVR did not have enough space to complete this event.'
              : 'The NVR source or node interrupted this event; complete footage is unavailable.',
          localOriginal: false,
          localPlayback: false,
        })
        .where('id = :id AND status != :ready AND bytes = 0', { id, ready: 'ready' })
        .execute();
    });
  }

  async extend(
    id: string,
    kind: string,
    at: number,
    endAt: number,
    sensorId?: string,
    maxEndAt = Infinity,
  ): Promise<EventRecord | null> {
    return this.write(async (manager) => {
      const old = await manager.findOneBy(RecordingEventEntity, { id });
      if (!old || old.status !== 'recording') return null;
      const detections = [
        ...(JSON.parse(old.detections) as EventDetection[]),
        { kind, at, sensorId },
      ].slice(-500);
      const kinds = [...new Set([...(JSON.parse(old.kinds as string) as string[]), kind])];
      await manager.update(
        RecordingEventEntity,
        { id },
        {
          startAt: Math.min(old.startAt, at),
          endAt: Math.min(maxEndAt, Math.max(old.endAt, endAt)),
          kinds: JSON.stringify(kinds),
          detections: JSON.stringify(detections),
        },
      );
      const updated = await manager.findOneBy(RecordingEventEntity, { id });
      return updated ? toEventRecord(toRawEvent(updated)) : null;
    });
  }

  async extendTail(id: string, endAt: number): Promise<EventRecord | null> {
    return this.write(async (manager) => {
      const row = await manager.findOneBy(RecordingEventEntity, { id });
      if (!row) return null;
      if (row.status === 'recording') {
        await manager.update(RecordingEventEntity, { id }, { endAt: Math.max(row.endAt, endAt) });
      }
      const updated = await manager.findOneBy(RecordingEventEntity, { id });
      return updated ? toEventRecord(toRawEvent(updated)) : null;
    });
  }

  async finish(
    id: string,
    {
      status = 'ready',
      duration = 0,
      bytes = 0,
      error = null,
      playbackVersion = 0,
      mediaStartAt = null,
    }: {
      status?: string;
      duration?: number;
      bytes?: number;
      error?: string | null;
      playbackVersion?: number;
      mediaStartAt?: number | null;
    } = {},
  ): Promise<EventRecord | null> {
    await this.write(async (manager) => {
      await this.clearArchiveWith(manager, id);
      const current = await manager.findOneBy(RecordingEventEntity, { id });
      await manager.update(
        RecordingEventEntity,
        { id },
        {
          status,
          duration,
          bytes,
          error,
          playbackVersion,
          mediaStartAt: mediaStartAt ?? current?.mediaStartAt ?? null,
          localOriginal: true,
        },
      );
    });
    return this.get(id);
  }

  async get(id: string): Promise<EventRecord | null> {
    return this.read(async (manager) => {
      const row = await manager.findOneBy(RecordingEventEntity, { id });
      return row ? toEventRecord(toRawEvent(row)) : null;
    });
  }

  async setPlayback(
    id: string,
    bytes: number,
    version = 1,
    diagnostics: Record<string, unknown> = {},
  ): Promise<void> {
    await this.write(async (manager) => {
      await this.clearArchiveWith(manager, id, 'prepared');
      await manager.query(
        'UPDATE events SET playback_version=?,playback_bytes=?,playback_info=?,local_playback=1,media_revision=media_revision+1 WHERE id=?',
        [version, bytes, JSON.stringify(diagnostics), id],
      );
    });
  }

  async clearArchive(id: string, variant?: string): Promise<void> {
    await this.write((manager) => this.clearArchiveWith(manager, id, variant));
  }

  async archiveGeneration(): Promise<number> {
    return this.read(async (manager) => {
      const row = await manager.findOneBy(EventArchiveStateEntity, { id: 1 });
      if (!row) throw Error('recording_archive_state_missing');
      return row.generation;
    });
  }

  async markArchiveChanged(): Promise<void> {
    await this.write((manager) => this.markArchiveChangedWith(manager));
  }

  list(options: RecordingEventListOptions = {}): Promise<{
    events: EventRecord[];
    newestCursor: string | null;
    nextCursor: string | null;
  }> {
    return this.read(() => this.queries.list(options));
  }

  recordedDays(options: { cameraId: string; boundaries: number[] }): Promise<number[]> {
    return this.read(() => this.queries.recordedDays(options));
  }

  recording(): Promise<EventRecord[]> {
    return this.read(() => this.queries.recording());
  }

  totals() {
    return this.read(() => this.queries.totals());
  }

  path(id: string, extension = 'mp4'): string {
    return this.mediaManager.path(id, extension);
  }

  setLocal(id: string, variant: 'original' | 'prepared', present: boolean): Promise<void> {
    if (!['original', 'prepared'].includes(variant))
      return Promise.reject(Error('invalid_archive_variant'));
    const property = variant === 'original' ? 'localOriginal' : 'localPlayback';
    return this.write(async (manager) => {
      await manager.update(RecordingEventEntity, { id }, { [property]: present });
    });
  }

  pinMedia(id: string, signal?: AbortSignal): Promise<() => void> {
    return this.mediaManager.pinMedia(id, signal);
  }

  evictMedia(id: string): (() => void) | null {
    return this.mediaManager.evictMedia(id);
  }

  reconcileLocalMedia(probe?: (path: string) => Promise<unknown>): Promise<void> {
    return this.mediaManager.reconcileLocalMedia(probe);
  }

  prune(options: { retention_days: number }, now = Date.now()): Promise<number> {
    return this.mediaManager.prune(options, now);
  }

  listLocalMedia(cursor: string, limit: number) {
    return this.read(() => this.queries.listLocalMedia(cursor, limit));
  }

  setLocalMedia(items: readonly MissingLocalMedia[]): Promise<void> {
    return this.write(async (manager) => {
      for (const item of items) {
        const property = item.variant === 'original' ? 'localOriginal' : 'localPlayback';
        await manager.update(RecordingEventEntity, { id: item.id }, { [property]: false });
      }
    });
  }

  async deleteAvailabilityBefore(cutoff: number): Promise<void> {
    await this.write(async (manager) => {
      await manager.delete(CameraAvailabilityEntity, { endAt: LessThan(cutoff) });
    });
  }

  listPrunableEvents() {
    return this.read(() => this.queries.listPrunableEvents());
  }

  async deleteEvent(id: string): Promise<void> {
    await this.write(async (manager) => {
      await manager.delete(RecordingEventEntity, { id });
    });
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.acceptingWrites = false;
    if (this.transactions) {
      this.closeTask = this.transactions.drain();
      return this.closeTask;
    }
    const pending = queues.get(this.source);
    this.closeTask = (async () => {
      await pending;
      if (this.source.isInitialized) await this.source.destroy();
    })();
    return this.closeTask;
  }

  private async clearArchiveWith(
    manager: EntityManager,
    id: string,
    variant?: string,
  ): Promise<void> {
    const where = variant ? { eventId: id, variant } : { eventId: id };
    const descriptors = await manager.delete(EventArchiveEntity, where);
    const locations = await manager.delete(EventArchiveLocationEntity, where);
    if ((descriptors.affected ?? 0) > 0 || (locations.affected ?? 0) > 0) {
      await this.markArchiveChangedWith(manager);
    }
    const tables: unknown = await manager.query(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cluster_media'",
    );
    if (Array.isArray(tables) && tables.length > 0) {
      await manager.query('DELETE FROM cluster_media WHERE event_id=?', [id]);
    }
  }

  private async markArchiveChangedWith(manager: EntityManager): Promise<void> {
    await manager.query('UPDATE event_archive_state SET generation=generation+1 WHERE id=1');
  }

  private async write<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) throw Error('recording_store_closed');
    if (this.transactions) return this.transactions.run(operation);
    return this.schedule(() => this.source.transaction('SERIALIZABLE', operation));
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.source) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(this.source, settled);
    void settled.then(() => {
      if (queues.get(this.source) === settled) queues.delete(this.source);
    });
    return result;
  }

  private read<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) return Promise.reject(Error('recording_store_closed'));
    if (this.transactions) return this.transactions.read(operation);
    return this.schedule(() => operation(this.source.manager));
  }
}
