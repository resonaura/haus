/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { Module, type DynamicModule } from '@nestjs/common';
import { resolve } from 'node:path';
import { CatalogLifetime } from '../storage/lifetime.js';
import { RecordingStore } from './recording.store.js';

/** Shares the catalog's connection/transaction owner; the recording store never destroys it. */
@Module({})
export class RecordingModule {
  static forRoot(mediaDirectory: string): DynamicModule {
    if (!mediaDirectory.trim()) throw Error('invalid_recording_media_directory');
    const media = resolve(mediaDirectory);
    return {
      module: RecordingModule,
      global: true,
      providers: [
        {
          provide: RecordingStore,
          inject: [CatalogLifetime],
          useFactory: (lifetime: CatalogLifetime) => {
            const store = new RecordingStore(lifetime.source, media, lifetime.transactions);
            lifetime.deferStore(() => store.close());
            return store;
          },
        },
      ],
      exports: [RecordingStore],
    };
  }
}
