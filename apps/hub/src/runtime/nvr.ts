/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { ResourceScope } from '@haus/core/lifecycle';
import { Capacity } from '@haus/ai';
import { HostTelemetry, StorageBacking } from '@haus/servers';
import type { MediaRuntime } from '@haus/media/pipeline';
import {
  Blobs,
  Catalog,
  NodeSettings,
  RecordingIndex,
  StorageUsage,
  addStorageRole,
  nodeStorageCategory,
} from '../nvr/index.js';
import type { NvrOptions } from '../nvr/transport/types.js';
import type { NvrConfig } from './config.js';
import { nvrIdentity } from './identity.js';
import { composeMedia } from './media.js';
import { detectWslEnvironment } from './wsl.js';
import { isRecord } from '../nvr/recovery.js';
import { stopTelemetry } from './telemetry.js';

export interface NvrDependencies {
  media: MediaRuntime;
  capacity?: (options: ConstructorParameters<typeof Capacity>[0]) => Capacity;
  telemetry?: (options: ConstructorParameters<typeof HostTelemetry>[0]) => HostTelemetry;
  diagnostic?: (code: string) => void;
}

/** Owns media before storage; transport closes storage only after draining handlers. */
export class NvrRuntime {
  private readonly resources = new ResourceScope();
  private readonly storage = new ResourceScope();
  private stopping?: Promise<void>;
  private closingStorage?: Promise<void>;
  private value?: NvrOptions;
  private constructor() {}

  static async open(
    config: NvrConfig,
    signal: AbortSignal,
    dependencies: NvrDependencies,
  ): Promise<NvrRuntime> {
    const runtime = new NvrRuntime();
    try {
      await runtime.initialize(config, signal, dependencies);
      return runtime;
    } catch (error) {
      try {
        await runtime.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'nvr_start_failed');
      }
      throw error;
    }
  }
  get options(): NvrOptions {
    if (!this.value) throw Error('nvr_not_initialized');
    return this.value;
  }
  stop(): Promise<void> {
    return (this.stopping ??= this.resources.close());
  }
  closeStorage(): Promise<void> {
    return (this.closingStorage ??= this.storage.close());
  }
  async close(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.stop();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.closeStorage();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'nvr_shutdown_incomplete');
  }
  private async initialize(
    config: NvrConfig,
    signal: AbortSignal,
    dependencies: NvrDependencies,
  ): Promise<void> {
    signal.throwIfAborted();
    const { root, key, roles } = config;
    await mkdir(root, { recursive: true, mode: 0o700 });
    signal.throwIfAborted();
    let host: HostTelemetry | undefined;
    const backingOptions = {
      required: Boolean(config.collectorFile) && detectWslEnvironment().isWsl,
    };
    const backing = new StorageBacking(join(root, 'blobs'), () => host?.status(), backingOptions);
    const workspace = new StorageBacking(root, () => host?.status(), backingOptions);
    const blobs = new Blobs(join(root, 'blobs'), {
      maxBytes: config.storageLimit,
      backingCapacity: () => backing.capacity(),
      workspaceRoot: root,
      workspaceBackingCapacity: () => workspace.capacity(),
    });
    await blobs.initialize();
    signal.throwIfAborted();
    const settings = await new NodeSettings(join(root, 'settings.json'), {
      environmentLimit: config.storageLimit,
      apply: (bytes, source) => blobs.setLimit(bytes, source),
    }).initialize();
    const catalog = new Catalog(join(root, 'catalog.json'), blobs);
    await catalog.initialize();
    const instanceId = await nvrIdentity(root);
    signal.throwIfAborted();
    const recordings = await RecordingIndex.open(join(root, 'recordings.sqlite'), blobs);
    this.storage.defer(() => recordings.close());
    signal.throwIfAborted();
    const storageUsage = new StorageUsage({
      roots: [{ id: 'data', path: root }],
      classify: async () => {
        const categories = new Map<string, string>();
        for (const backup of catalog.list())
          addStorageRole(
            categories,
            backup.digest,
            backup.kind === 'ha' ? 'ha-backups' : 'config-backups',
          );
        for (const item of await recordings.storageRows()) {
          const digest = typeof item.digest === 'string' ? item.digest : undefined;
          if (item.storageVariant)
            addStorageRole(
              categories,
              digest,
              item.storageVariant === 'prepared' ? 'prepared' : 'originals',
            );
          else if (isRecord(item.playbackInfo) && item.playbackInfo.originalCompatible === true)
            addStorageRole(categories, digest, 'originals');
          addStorageRole(
            categories,
            typeof item.originalDigest === 'string' ? item.originalDigest : undefined,
            'originals',
          );
        }
        return (_root, path) => nodeStorageCategory(path, categories);
      },
    });
    this.resources.defer(() => storageUsage.stop());
    const capacity =
      dependencies.capacity?.({ maxStreams: config.maxStreams }) ??
      new Capacity({ maxStreams: config.maxStreams });
    this.resources.defer(() => capacity.stop());
    await capacity.initialize();
    signal.throwIfAborted();
    const telemetryOptions = {
      dataPath: root,
      capacity,
      collectorFile: config.collectorFile,
      nativeServices: true,
    };
    host = dependencies.telemetry?.(telemetryOptions) ?? new HostTelemetry(telemetryOptions);
    const telemetry = host;
    this.resources.defer(() => stopTelemetry(telemetry));
    await host.initialize();
    signal.throwIfAborted();
    const media = roles.includes('stream')
      ? await composeMedia(config, {
          blobs,
          recordings,
          capacity,
          scope: this.resources,
          signal,
          dependencies,
        })
      : {};
    signal.throwIfAborted();
    this.value = {
      ...media,
      key,
      blobs,
      catalog,
      recordings,
      instanceId,
      nodeId: config.nodeId || hostname(),
      roles,
      maxStreams: capacity.streams,
      capacity,
      settings,
      host,
      storageUsage,
      lifetime: this,
    };
  }
}
