/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { NativeEntities } from '@haus/ha/node/native-entities';
import type { NativeMigration } from '@haus/ha/node/native-migration';
import { connectDiscoveredProvider } from './managed.js';
import { discoverProviderBridges, type ProviderDiscoveryConfig } from './discovery.js';
import type { IProvidersService } from './providers.controller.js';
import type { EnrollProviderDto } from './providers.dto.js';
import type { NativeProviders } from './native.js';
import type { NativeCameraSources } from '../camera/control/sources.js';
import type { NativeGraph } from './graph/service.js';
import {
  getTuyaBridgeLoginState,
  pollTuyaBridgeQrLogin,
  startTuyaBridgeQrLogin,
} from './tuya-login.js';

const emptyRegistry = () => ({ cameras: [], devices: [], entities: [], states: [] });

/** Owns standalone bridge discovery and camera import through the executable Hub API. */
export class NativeProviderService implements IProvidersService {
  private discovery?: Promise<unknown[]>;

  constructor(
    private readonly providers: NativeProviders,
    private readonly sources: NativeCameraSources,
    private readonly config: ProviderDiscoveryConfig = { standalone: true },
    private readonly graph?: Pick<NativeGraph, 'registry' | 'sync' | 'release'>,
    private readonly nativeEntities?: NativeEntities,
    private readonly nativeMigration?: NativeMigration,
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
    const existing = this.providers.list().find((item) => item.id === bridgeId);
    if (existing) return existing;
    const result = await connectDiscoveredProvider(this.config, this.providers, bridgeId);
    return result ?? { manual: true };
  }

  loginState(bridgeId: string): Promise<unknown> {
    return getTuyaBridgeLoginState(this.providers, bridgeId);
  }

  loginQrStart(bridgeId: string, region?: string): Promise<unknown> {
    return startTuyaBridgeQrLogin(this.providers, bridgeId, region);
  }

  loginQrPoll(bridgeId: string, token: string): Promise<unknown> {
    return pollTuyaBridgeQrLogin(this.providers, bridgeId, token);
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

  async handover(bridgeId?: string): Promise<unknown> {
    if (!this.nativeEntities) {
      throw new Error('provider_handover_unavailable');
    }
    const registry = this.registry();
    const regWithEntities = {
      ...registry,
      entities: (registry.entities ?? []) as unknown as Parameters<
        NativeMigration['ignoredLegacy']
      >[1]['entities'],
    };
    if (!bridgeId) {
      return {
        providers: this.providers.list().map((provider) => ({
          ...provider,
          handover: {
            ...this.nativeEntities!.handoverStatus(
              provider.id,
              regWithEntities,
              this.nativeMigration?.ignoredLegacy(provider.id, regWithEntities),
            ),
            migration: this.nativeMigration?.status(provider.id),
          },
        })),
      };
    }
    return this.nativeEntities.transaction(bridgeId, async () => {
      const status = this.nativeEntities!.handoverStatus(
        bridgeId,
        regWithEntities,
        this.nativeMigration?.ignoredLegacy(bridgeId, regWithEntities),
      );
      if (status?.state !== 'ready') {
        throw Error(
          status?.state === 'migration_required'
            ? 'native_ha_migration_required'
            : 'native_ha_not_ready',
        );
      }
      await this.nativeMigration?.beforeHandover(bridgeId);
      await this.nativeMigration?.handoverStarted(bridgeId);
      const handoverResult = await this.nativeEntities!.completeHandover(bridgeId);
      await this.nativeMigration?.handoverFinished(bridgeId);
      return handoverResult;
    });
  }

  async migrationStatus(bridgeId: string): Promise<unknown> {
    if (!this.nativeMigration) throw new Error('provider_migration_unavailable');
    return this.nativeMigration.status(bridgeId);
  }

  async migrationReview(bridgeId: string): Promise<unknown> {
    if (!this.nativeMigration) throw new Error('provider_migration_unavailable');
    return this.nativeMigration.review(bridgeId);
  }

  async migrationStart(bridgeId: string, input: unknown, isUndo: boolean): Promise<unknown> {
    if (!this.nativeMigration) throw new Error('provider_migration_unavailable');
    return this.nativeMigration.start(
      bridgeId,
      input as Parameters<NativeMigration['start']>[1],
      isUndo,
    );
  }

  private registry() {
    const empty = this.graph?.registry() ?? emptyRegistry();
    return { ...empty, cameras: this.sources.merge(empty) };
  }
}
