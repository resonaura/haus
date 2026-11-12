/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { connectDiscoveredProvider } from './managed.js';
import { discoverProviderBridges, type ProviderDiscoveryConfig } from './discovery.js';
import type { IProvidersService } from './providers.controller.js';
import type { EnrollProviderDto } from './providers.dto.js';
import type { NativeProviders } from './native.js';
import type { NativeCameraSources } from '../camera/control/sources.js';
import type { NativeGraph } from './graph/service.js';

const emptyRegistry = () => ({ cameras: [], devices: [], entities: [], states: [] });

/** Owns standalone bridge discovery and camera import through the executable Hub API. */
export class NativeProviderService implements IProvidersService {
  private discovery?: Promise<unknown[]>;

  constructor(
    private readonly providers: NativeProviders,
    private readonly sources: NativeCameraSources,
    private readonly config: ProviderDiscoveryConfig = { standalone: true },
    private readonly graph?: Pick<NativeGraph, 'registry' | 'sync' | 'release'>,
  ) {}

  list() {
    return this.providers.list();
  }

  discover(): Promise<unknown[]> {
    if (this.discovery) return this.discovery;
    const task = discoverProviderBridges(this.config).finally(() => {
      if (this.discovery === task) this.discovery = undefined;
    });
    this.discovery = task;
    return task;
  }

  async add(input: EnrollProviderDto) {
    const result = await this.providers.add(input);
    if (!result) throw new Error('native_provider_enrollment_failed');
    return result;
  }

  async connect(bridgeId: string): Promise<unknown> {
    const result = await connectDiscoveredProvider(this.config, this.providers, bridgeId);
    return result ?? { manual: true };
  }

  async preview(bridgeId: string): Promise<unknown> {
    return this.sources.preview(bridgeId, this.registry());
  }

  async import(bridgeId: string, cameras: string[]): Promise<unknown> {
    const result = await this.sources.import(bridgeId, cameras, this.registry());
    await this.graph?.sync(bridgeId);
    return result;
  }

  async remove(bridgeId: string): Promise<void> {
    await this.providers.remove(bridgeId);
    await this.graph?.release(bridgeId);
  }

  private registry() {
    const empty = this.graph?.registry() ?? emptyRegistry();
    return { ...empty, cameras: this.sources.merge(empty) };
  }
}
