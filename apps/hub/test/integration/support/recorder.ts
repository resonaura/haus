/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import assert from 'node:assert/strict';
import type { RecordingStore } from '../../../src/events/recording.store.js';
import { record, identifier } from '../../nvr/support/values.js';
import { construct, invoke, loadLegacy } from './legacy.js';
import type { ClusterRuntime } from './cluster.js';

export class RecorderRuntime {
  private calls = 0;
  private constructor(private readonly instance: Record<string, unknown>) {
    const encoding = record(instance.encoding),
      original = encoding.run;
    assert.ok(typeof original === 'function');
    encoding.run = (...args: unknown[]) => {
      this.calls++;
      const result: unknown = Reflect.apply(original, encoding, args);
      return result;
    };
  }
  static async create(
    root: string,
    media: string,
    store: RecordingStore,
    cluster: ClusterRuntime,
  ): Promise<RecorderRuntime> {
    const [module, configuration] = await Promise.all([
      loadLegacy('recorder.mjs'),
      loadLegacy('config.mjs'),
    ]);
    const defaults = record(configuration.defaults);
    return new RecorderRuntime(
      construct(module, 'Recorder', [
        { ...defaults, data: root, media },
        {},
        store,
        undefined,
        {
          prepareRemote: (event: unknown, options: unknown) =>
            cluster.preparePlayback(event, options),
        },
      ]),
    );
  }
  get localEncoders(): number {
    return this.calls;
  }
  async preparePlayback(event: unknown): Promise<string> {
    return identifier(await invoke(this.instance, 'preparePlayback', event));
  }
  async stop(): Promise<void> {
    await invoke(this.instance, 'stop');
  }
}
