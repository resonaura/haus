/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Service, ResourceScope } from '@haus/core/lifecycle';
import { defaultMediaRuntime } from '@haus/media/pipeline';
import { createNestApp } from '../nest.js';
import type { NestAppOptions } from '../nest.js';
import { NvrTransport } from '../nvr/transport/service.js';
import { runtimeConfig, type RuntimeConfig } from './config.js';
import { NvrRuntime, type NvrDependencies } from './nvr.js';
import {
  startHubMdnsAdvertisement,
  startHubNvrMdnsAdvertisement,
  type DiscoveryOptions,
} from './discovery.js';
import { CatalogLifetime } from '../storage/lifetime.js';

export interface HubServiceOptions {
  env?: NodeJS.ProcessEnv;
  nvr?: NvrDependencies;
  createApp?: (options: NestAppOptions) => Promise<INestApplication>;
  discovery?: (options: DiscoveryOptions) => Promise<(() => Promise<void>) | undefined>;
  diagnostic?: (code: string) => void;
  ready?: (config: RuntimeConfig, port: number) => void;
}

/** Startup and shutdown share a cached cleanup, including resources acquired before a failed await. */
export function createHubService(options: HubServiceOptions = {}): Service {
  return new Service(async ({ signal, scope }) => {
    const resources = new ResourceScope();
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= resources.close());
    scope.defer(close);
    try {
      signal.throwIfAborted();
      const config = await runtimeConfig(options.env);
      signal.throwIfAborted();
      const nvr = config.nvr
        ? await NvrRuntime.open(
            config.nvr,
            signal,
            options.nvr ?? { media: defaultMediaRuntime, diagnostic: options.diagnostic },
          )
        : undefined;
      if (nvr) resources.defer(() => nvr.close());
      signal.throwIfAborted();
      const app = await (options.createApp ?? createNestApp)({
        port: config.port,
        env: config.env,
        nvr: nvr?.options,
        dataDirectory: config.root,
        mediaDirectory: config.env.HAUS_MEDIA || undefined,
      });
      // Close admission before Nest waits for HTTP connections during shutdown.
      resources.defer(async () => {
        const failures: unknown[] = [];
        const server: Server = app.getHttpServer();
        if (server.listening) {
          try {
            server.close();
          } catch (error) {
            failures.push(error);
          }
        }
        const deadline = setTimeout(() => server.closeAllConnections(), 3000);
        deadline.unref();
        if (nvr) {
          try {
            await app.get(NvrTransport).close();
          } catch (error) {
            failures.push(error);
          }
        }
        try {
          await app.get(CatalogLifetime).close();
        } catch (error) {
          failures.push(error);
        }
        try {
          await app.close();
        } catch (error) {
          failures.push(error);
        } finally {
          clearTimeout(deadline);
        }
        if (failures.length) throw new AggregateError(failures, 'hub_transport_shutdown_failed');
      });
      signal.throwIfAborted();
      await app.listen(config.port, config.address);
      signal.throwIfAborted();
      const server: Server = app.getHttpServer();
      const address = server.address();
      if (!address || typeof address === 'string') throw Error('listener_address_unavailable');
      try {
        const advertise =
          options.discovery ?? (nvr ? startHubNvrMdnsAdvertisement : startHubMdnsAdvertisement);
        const stop = await advertise({ env: config.env, signal, port: address.port });
        if (stop) resources.defer(stop);
      } catch (error) {
        if (error instanceof AggregateError) throw error;
        signal.throwIfAborted();
        options.diagnostic?.(nvr ? 'nvr_discovery_unavailable' : 'hub_discovery_unavailable');
      }
      signal.throwIfAborted();
      options.ready?.(config, address.port);
      return { close };
    } catch (error) {
      try {
        await close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'hub_start_failed');
      }
      throw error;
    }
  });
}
