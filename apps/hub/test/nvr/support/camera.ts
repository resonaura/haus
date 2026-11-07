/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { CameraSessionsEngine, CameraSessionsRing } from '../../../src/nvr/camera/contracts.js';
import type { CameraRecordingJob, CameraRecordInput } from '@haus/media/recording';
import { describeRecording } from '@haus/media/recording';
export function engineFixture(overrides: Partial<CameraSessionsEngine> = {}): CameraSessionsEngine {
  const viewers: CameraSessionsEngine['viewers'] = new Map();
  return { viewers, initialize: async () => {}, add: async () => {}, remove: async () => {},
    localRtsp: id => `rtsp://127.0.0.1:8554/${id}_raw`, stop: async () => {},
    offer: async () => { throw Error('unexpected_viewer_offer'); }, candidate: () => { throw Error('unexpected_candidate'); },
    closeViewer: (id, owner) => { if(viewers.get(id)?.owner === owner) viewers.delete(id); }, ...overrides };
}
export function recordingFixture(input: CameraRecordInput, root = '/unused-fixture'): CameraRecordingJob {
  return { id: input.eventId, root, startAt: input.startAt, endAt: input.endAt, metadata: input.metadata,
    state: 'recording', parts: new Map(), createdAt: input.startAt, bytes: 0, maxBytes: 0, capacity: 0, reservations: [] };
}
export function ringFixture(at: number, overrides: Partial<CameraSessionsRing> = {}): CameraSessionsRing {
  const jobs = new Map<string, CameraRecordingJob>();
  return { jobs, startedAt: at, freshAt: at, failed: false, ready: () => true, start: async () => {}, stop: async () => {}, sample: async () => {},
    record: async value => { const job=recordingFixture(value); jobs.set(job.id,job); return describeRecording(job); },
    removeRecording: async id => { jobs.delete(id); }, ...overrides };
}
