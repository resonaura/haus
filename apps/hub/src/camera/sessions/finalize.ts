/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { extractVideoSnapshot } from '@haus/media';
import {
  inspectOriginalPlayback,
  ORIGINAL_POLICY_VERSION,
  PLAYBACK_VERSION,
} from '@haus/hub/events';
import {
  missing,
  type DurableReceiptValue,
  type NvrCameraSessionsHost,
  type RecordingEvent,
} from './types.js';

export async function finalizeEvent(
  host: NvrCameraSessionsHost,
  event: RecordingEvent,
): Promise<void> {
  const existing = host.finalizations.get(event.id);
  if (existing) return existing;
  const task = host.finalizeRecording(event);
  host.finalizations.set(event.id, task);
  try {
    return await task;
  } catch (error) {
    host.reportRecordingFailure(event, 'finalize', error);
    throw error;
  } finally {
    if (host.finalizations.get(event.id) === task) host.finalizations.delete(event.id);
  }
}

export async function finalizeRecording(
  host: NvrCameraSessionsHost,
  event: RecordingEvent,
): Promise<void> {
  const job = await host.record(event);
  const node = host.cluster.nodes().find((item) => item.id === job.nodeId);
  if (!node?.enabled) throw missing('camera_recording_node_unavailable');
  const base = `/v1/cameras/sessions/${job.id}/recordings/${event.id}`;
  let result: DurableReceiptValue | undefined;
  let durable = await host.durableRecording(event, node.id);
  const deadline = host.now() + 90000;
  do {
    if (durable) result = durable.value;
    else {
      try {
        result = (await host.json(node, `${base}/status`, {
          method: 'POST',
          data: { owner: job.owner },
          signal: host.abort.signal,
          timeout: 15000,
        })) as DurableReceiptValue;
      } catch (error) {
        durable = await host.durableRecording(event, node.id);
        if (!durable) throw error;
        result = durable.value;
      }
    }
    if (result.state === 'failed') throw missing('camera_recording_failed');
    if (result.state === 'ready') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    host.abort.signal.throwIfAborted();
  } while (host.now() < deadline);
  if (
    result?.state !== 'ready' ||
    !Number.isSafeInteger(result.bytes) ||
    result.bytes <= 0 ||
    result.bytes > 1024 ** 3 ||
    !/^[a-f0-9]{64}$/.test(result.sha256 ?? '') ||
    !Number.isFinite(result.mediaStartAt) ||
    !Number.isFinite(result.duration) ||
    result.duration <= 0 ||
    typeof result.audio !== 'boolean'
  )
    throw missing('invalid_camera_recording');
  if (host.config.record_audio !== false && !result.audio)
    throw missing('camera_recording_audio_missing');
  const output = host.store.path(event.id);
  const temporary = output.replace(/\.mp4$/, '.nvr.partial.mp4');
  try {
    const response = await host.request(
      node,
      durable ? `/v1/blobs/${result.sha256}` : `${base}/media`,
      {
        method: durable ? 'GET' : 'POST',
        ...(durable ? {} : { data: { owner: job.owner } }),
        signal: host.abort.signal,
        timeout: 120000,
      },
    );
    if (
      response.status !== 200 ||
      Number(response.headers.get('content-length')) !== result.bytes ||
      !response.body
    ) {
      await response.body?.cancel();
      throw missing('invalid_camera_recording');
    }
    let bytes = 0;
    const expectedBytes = result.bytes;
    const hash = createHash('sha256');
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > expectedBytes) return callback(missing('invalid_camera_recording'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      verify,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    if (bytes !== result.bytes || hash.digest('hex') !== result.sha256)
      throw missing('camera_recording_digest_mismatch');
    const info = await host.inspect(temporary);
    if (
      info.audio !== result.audio ||
      Math.abs(info.duration - result.duration) > 0.5 ||
      info.duration <= 0.1
    )
      throw missing('invalid_camera_recording');
    const provenance = host.camera(event.cameraId)?.playbackSource;
    const compatible = await inspectOriginalPlayback(temporary, {}, provenance).catch(() => false);
    await rename(temporary, output);
    await host.store.setPlayback(event.id, 0, compatible ? PLAYBACK_VERSION : 0, {
      audio: info.audio,
      originalProvenance: provenance,
      originalCompatible: compatible,
      originalPolicyVersion: compatible ? ORIGINAL_POLICY_VERSION : undefined,
      sourceAudioMissing: false,
    });
    await host.store.finish(event.id, {
      duration: info.duration,
      bytes,
      mediaStartAt: Math.round(result.mediaStartAt),
      playbackVersion: compatible ? PLAYBACK_VERSION : 0,
    });
    await extractVideoSnapshot(output, host.store.path(event.id, 'jpg'), {
      timestamp: Math.min(2, info.duration / 2),
      signal: host.abort.signal,
    }).catch(() => {});
    await host.persistence.removeEvent(event.id);
    host.events.delete(event.id);
    if (durable) await host.acknowledgeRecording(node, result).catch(() => {});
    if (job.id && job.owner)
      await host
        .request(node, base, {
          method: 'DELETE',
          data: { owner: job.owner },
          timeout: 5000,
        })
        .then((r) => r.body?.cancel())
        .catch(() => {});
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
