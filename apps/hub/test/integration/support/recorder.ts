/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import {
  Recorder,
  type EventRecord,
  type RecorderConfig,
  type RecordingStore,
} from '../../../src/events/index.js';
import { record } from '../../nvr/support/values.js';
import { loadLegacy } from './legacy.js';
import type { ClusterRuntime } from './cluster.js';

export class RecorderRuntime {
  private calls = 0;
  private constructor(private readonly instance: Recorder) {
    const original = instance.encoding.run.bind(instance.encoding);
    instance.encoding.run = <T>(
      work: () => Promise<T>,
      priority?: number,
      key?: string,
    ): Promise<T> => {
      this.calls++;
      return original(work, priority, key);
    };
  }
  static async create(
    root: string,
    media: string,
    store: RecordingStore,
    cluster: ClusterRuntime,
  ): Promise<RecorderRuntime> {
    const configuration = await loadLegacy('config.mjs');
    const defaults = record(configuration.defaults);
    const config: RecorderConfig = {
      data: root,
      media,
      token: typeof defaults.token === 'string' ? defaults.token : undefined,
      recording_enabled: defaults.recording_enabled !== false,
      record_audio: defaults.record_audio !== false,
      pre_roll_seconds:
        typeof defaults.pre_roll_seconds === 'number' ? defaults.pre_roll_seconds : 6,
      post_roll_seconds:
        typeof defaults.post_roll_seconds === 'number' ? defaults.post_roll_seconds : 10,
      max_event_seconds:
        typeof defaults.max_event_seconds === 'number' ? defaults.max_event_seconds : 300,
      max_storage_gb: typeof defaults.max_storage_gb === 'number' ? defaults.max_storage_gb : 0,
      max_buffer_gb: typeof defaults.max_buffer_gb === 'number' ? defaults.max_buffer_gb : 2,
    };
    return new RecorderRuntime(
      new Recorder(config, {}, store, undefined, {
        prepareRemote: async (event, options) =>
          Boolean(await cluster.preparePlayback(event, options)),
      }),
    );
  }
  get localEncoders(): number {
    return this.calls;
  }
  async preparePlayback(event: EventRecord | null): Promise<string> {
    assert.ok(event);
    return this.instance.preparePlayback(event);
  }
  async stop(): Promise<void> {
    await this.instance.stop();
  }
}
