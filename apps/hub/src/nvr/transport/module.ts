/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Inject, Module } from '@nestjs/common';
import type { DynamicModule, OnModuleDestroy } from '@nestjs/common';
import { NvrTransport } from './service.js';
import type { NvrOptions } from './types.js';

@Module({})
export class NvrModule implements OnModuleDestroy {
  constructor(@Inject(NvrTransport) private readonly transport: NvrTransport) {}
  static forRoot(options: NvrOptions): DynamicModule {
    return {
      module: NvrModule,
      providers: [{ provide: NvrTransport, useFactory: () => new NvrTransport(options) }],
      exports: [NvrTransport],
    };
  }
  async onModuleDestroy(): Promise<void> {
    // A supplied lifetime has one application owner, which drains transport before app.close().
    // Re-throwing its earlier shutdown failure here would prevent Nest releasing other modules.
    if (!this.transport.options.lifetime) await this.transport.close();
  }
}
