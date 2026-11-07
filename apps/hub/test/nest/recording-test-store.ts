/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { RecordingStore } from '../../src/events/recording.store.js';
import { openRecordingSource } from '../../src/events/recording.source.js';

export async function openTestRecordingStore(database: string, media: string): Promise<RecordingStore> {
  return new RecordingStore(await openRecordingSource(database), media);
}
