/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import {
  fileDigest,
  missing,
  uuid,
  type DurableReceiptValue,
  type NvrCameraSessionsHost,
  type RecordingEvent,
  type RecordingJob,
  type SessionNode,
} from './types.js';

export async function recordEvent(
  host: NvrCameraSessionsHost,
  event: RecordingEvent | null,
): Promise<RecordingJob> {
  if (!event) throw missing('invalid_event');
  const previous = host.eventPending.get(event.id);
  if (previous) {
    await previous.catch(() => {});
    return host.record(event);
  }
  const task = host.submitRecord(event);
  host.eventPending.set(event.id, task);
  try {
    return await task;
  } catch (error) {
    host.reportRecordingFailure(event, 'submit', error);
    throw error;
  } finally {
    if (host.eventPending.get(event.id) === task) host.eventPending.delete(event.id);
  }
}

export function reportRecordingFailure(
  host: NvrCameraSessionsHost,
  event: RecordingEvent,
  phase: string,
  error: unknown,
): void {
  if (host.stopped) return;
  const err = error as { code?: string; message?: string; status?: number } | undefined;
  const reason = err?.code ?? err?.message ?? '';
  const known = new Set([
    'camera_session_not_found',
    'camera_recording_not_found',
    'camera_recording_not_ready',
    'camera_ring_not_ready',
    'camera_session_busy',
    'camera_recording_busy',
    'camera_recording_failed',
    'camera_session_unavailable',
    'camera_engine_unavailable',
    'camera_engine_timeout',
    'camera_media_failed',
    'invalid_camera_recording',
    'camera_recording_node_unavailable',
    'camera_recording_audio_missing',
    'camera_recording_digest_mismatch',
    'camera_nvr_required',
    'storage_full',
    'node_unavailable',
    'invalid_node_key_or_clock',
  ]);
  const code = known.has(reason) ? reason : 'recording_operation_failed';
  const key = `${event.id}:${phase}:${code}`;
  if (host.now() - (host.recordingDiagnostics.get(key) ?? -Infinity) < 30000) return;
  host.recordingDiagnostics.set(key, host.now());
  if (host.recordingDiagnostics.size > 256) {
    const oldest = host.recordingDiagnostics.keys().next().value;
    if (oldest) host.recordingDiagnostics.delete(oldest);
  }
  try {
    host.log('recording_operation_failed', {
      eventId: event.id,
      cameraId: event.cameraId,
      phase,
      reason: code,
      ...(Number.isInteger(err?.status) ? { status: err?.status } : {}),
    });
  } catch {
    // Diagnostic failures cannot change capture or cleanup behavior.
  }
}

export async function submitRecord(
  host: NvrCameraSessionsHost,
  event: RecordingEvent,
): Promise<RecordingJob> {
  let job = host.events.get(event.id);
  if (
    job &&
    typeof job.startAt === 'number' &&
    typeof job.endAt === 'number' &&
    job.startAt <= event.startAt &&
    job.endAt >= event.endAt
  )
    return job;
  if (!job) {
    const receipt = await host.durableRecording(event);
    if (receipt) {
      job = {
        nodeId: receipt.node.id,
        receipt: receipt.value,
        cameraId: event.cameraId,
        startAt: event.startAt,
        endAt: event.endAt,
      };
      await host.persistence.saveEvent(event.id, JSON.stringify(job));
      host.events.set(event.id, job);
      return job;
    }
    const entry = await host.ensure(host.camera(event.cameraId), host.recordingOwner);
    job = {
      nodeId: entry.node.id,
      id: entry.id,
      owner: entry.owner,
      cameraId: event.cameraId,
    };
  }
  const node = host.cluster.nodes().find((item) => item.id === job?.nodeId);
  if (!node?.enabled) throw missing('camera_recording_node_unavailable');
  await host.json(node, `/v1/cameras/sessions/${job.id}/recordings`, {
    method: 'POST',
    data: {
      owner: job.owner,
      eventId: event.id,
      startAt: event.startAt,
      endAt: event.endAt,
      event: {
        id: event.id,
        cameraId: event.cameraId,
        startAt: event.startAt,
        endAt: event.endAt,
        kinds: event.kinds,
      },
    },
    signal: host.abort.signal,
    timeout: 15000,
  });
  job = { ...job, startAt: event.startAt, endAt: event.endAt };
  await host.persistence.saveEvent(event.id, JSON.stringify(job));
  host.events.set(event.id, job);
  return job;
}

export function validateReceipt(
  value: unknown,
  event: RecordingEvent,
): value is DurableReceiptValue {
  const candidate = value as Partial<DurableReceiptValue> | undefined;
  return Boolean(
    candidate?.state === 'ready' &&
      candidate.event?.id === event.id &&
      candidate.event.cameraId === event.cameraId &&
      Number.isSafeInteger(candidate.event.startAt) &&
      Number.isSafeInteger(candidate.event.endAt) &&
      candidate.event.startAt <= event.startAt &&
      candidate.event.endAt >= event.endAt &&
      candidate.event.endAt - candidate.event.startAt <= 300000 &&
      /^[a-f0-9]{64}$/.test(candidate.sha256 ?? '') &&
      typeof candidate.bytes === 'number' &&
      Number.isSafeInteger(candidate.bytes) &&
      candidate.bytes > 0 &&
      candidate.bytes <= 1024 ** 3 &&
      typeof candidate.duration === 'number' &&
      Number.isFinite(candidate.duration) &&
      candidate.duration > 0 &&
      typeof candidate.mediaStartAt === 'number' &&
      Number.isFinite(candidate.mediaStartAt) &&
      candidate.mediaStartAt >= 0 &&
      candidate.mediaStartAt <= candidate.event.endAt &&
      typeof candidate.audio === 'boolean',
  );
}

export async function durableRecording(
  host: NvrCameraSessionsHost,
  event: RecordingEvent,
  preferredNode?: string,
): Promise<{ node: SessionNode; value: DurableReceiptValue } | undefined> {
  for (const node of host.cluster
    .nodes()
    .filter(
      (item) =>
        item.enabled &&
        (!preferredNode || item.id === preferredNode) &&
        host.cluster.health.get(item.id)?.online &&
        host.cluster.health.get(item.id)?.remote?.features?.cameraRecordingRecovery === 1,
    )) {
    try {
      const value = await host.json(node, `/v1/camera-recordings/${event.id}`, {
        timeout: 4000,
        signal: host.abort.signal,
      });
      if (host.validateReceipt(value, event)) return { node, value };
    } catch {}
  }
  return undefined;
}

export async function acknowledgeRecording(
  host: NvrCameraSessionsHost,
  node: SessionNode,
  value: DurableReceiptValue,
): Promise<unknown> {
  return host.json(node, `/v1/camera-recordings/${value.event.id}`, {
    method: 'POST',
    data: { sha256: value.sha256 },
    timeout: 4000,
    signal: host.abort.signal,
  });
}

export function recoverRecordings(host: NvrCameraSessionsHost): Promise<void> {
  if (host.recoveryPromise) return host.recoveryPromise;
  host.recoveryPromise = host.recoverReadyRecordings().finally(() => {
    host.recoveryPromise = undefined;
  });
  return host.recoveryPromise;
}

export async function recoverReadyRecordings(host: NvrCameraSessionsHost): Promise<void> {
  if (
    host.recovering ||
    host.stopped ||
    host.now() - (host.lastRecovery ?? -Infinity) < 10000
  )
    return;
  host.recovering = true;
  host.lastRecovery = host.now();
  try {
    for (const node of host.cluster
      .nodes()
      .filter(
        (item) =>
          item.enabled &&
          host.cluster.health.get(item.id)?.online &&
          host.cluster.health.get(item.id)?.remote?.features?.cameraRecordingRecovery === 1,
      )) {
      try {
        const cursor = host.recoveryCursors.get(node.id);
        const result = (await host.json(
          node,
          '/v1/camera-recordings' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''),
          {
            timeout: 4000,
            signal: host.abort.signal,
          },
        )) as { items?: DurableReceiptValue[]; nextCursor?: string };
        if (!Array.isArray(result.items)) continue;
        host.recoveryCursors.set(
          node.id,
          /^\d{1,16}$/.test(result.nextCursor ?? '') ? result.nextCursor : undefined,
        );
        for (const value of (result.items ?? []).slice(0, 16)) {
          if (host.stopped || !uuid(value.event?.id)) continue;
          let event = await host.store.get(value.event.id);
          if (
            !event &&
            host.camera(value.event.cameraId) &&
            host.authorizeActivityRecording?.(node, value) &&
            host.validateReceipt(value, value.event)
          )
            event = await host.store.adoptActivity({
              ...value.event,
              kinds: value.event.kinds ?? [],
            });
          // Unknown camera/events are not inferred from filenames or adopted
          // into another home's catalog. Autonomous triggers will use the
          // same explicit authorized metadata path.
          if (!event || !host.camera(event.cameraId) || !host.validateReceipt(value, event))
            continue;
          const release = await host.store.pinMedia(event.id);
          try {
            event = await host.store.get(event.id);
            if (!event || !host.validateReceipt(value, event)) continue;
            if (event.status === 'ready') {
              const digest =
                (await host.persistence.originalDigest(event.id)) ??
                (event.localOriginal
                  ? await fileDigest(host.store.path(event.id)).catch(() => null)
                  : null);
              if (digest === value.sha256) await host.acknowledgeRecording(node, value);
            } else if (['recording', 'interrupted', 'failed'].includes(event.status ?? '')) {
              await host.finalize(event);
            }
          } finally {
            release();
          }
        }
      } catch {}
    }
  } finally {
    host.recovering = false;
  }
}
