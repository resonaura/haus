/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { Recorder } from '../events/recorder/recorder.js';
import type { NvrCameraSessions } from '../camera/sessions/sessions.js';

/** Cancel both owners before awaiting work that may depend on the peer's cancellation. */
export async function stopRecordingRuntime(
  recorder: Pick<Recorder, 'stop'>,
  capture: Pick<NvrCameraSessions, 'stop'>,
): Promise<void> {
  const results = await Promise.allSettled([recorder, capture].map(async (owner) => owner.stop()));
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason);
  }
  if (failures.length) throw new AggregateError(failures, 'recording_shutdown_failed');
}
