/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { networkInterfaces } from 'node:os';
import { appAccessoryPort, type AppManifest } from '@haus/apps';
import { uuid, providerId } from '@haus/bridge/protocol';
import { loopbackProviderJson } from './managed.js';
import type { NativeProviders } from './native.js';
import type { NativeCameraSources, NativeCameraRegistry } from '../camera/control/sources.js';
import type { NativeGraph } from './graph/service.js';

interface Home {
  appAccessoryManifest(actor: string, appId: string): Promise<AppManifest>;
}

function hostAddress(): string {
  const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    /^(?:docker|veth|br-|virbr|lo)/.test(name)
      ? []
      : (entries ?? [])
          .filter(
            (entry) =>
              !entry.internal &&
              entry.family === 'IPv4' &&
              /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(entry.address),
          )
          .map((entry) => entry.address),
  );
  if (!addresses[0]) throw Error('app_accessories_host_unavailable');
  return addresses[0];
}

/** Accessory authority comes from an installed App's declared endpoint, never a name match. */
export class AppAccessories {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly home: Home,
    private readonly providers: Pick<NativeProviders, 'connections' | 'refresh' | 'add'>,
    private readonly sources: Pick<NativeCameraSources, 'preview' | 'import'>,
    private readonly registry: () => NativeCameraRegistry,
    private readonly local = loopbackProviderJson,
    private readonly address = hostAddress,
    private readonly graph?: Pick<NativeGraph, 'sync'>,
  ) {}

  async read(actor: string, appId: string) {
    const target = await this.target(actor, appId);
    if (!this.providers.connections().some((item) => item.id === target.bridgeId))
      return { connected: false, cameras: [] };
    await this.providers.refresh(target.bridgeId);
    return { connected: true, cameras: this.sources.preview(target.bridgeId, this.registry()) };
  }

  async sync(actor: string, appId: string): Promise<unknown> {
    const target = await this.target(actor, appId);
    const existing = this.pending.get(appId);
    if (existing) return existing;
    const task = this.synchronize(target).finally(() => this.pending.delete(appId));
    this.pending.set(appId, task);
    return task;
  }

  private async synchronize(target: { port: number; bridgeId: string; provider: string }) {
    if (!this.providers.connections().some((item) => item.id === target.bridgeId)) {
      const pairing = await this.local(target.port, '/api/haus/v2/pairing', true);
      if (typeof pairing.code !== 'string' || !/^[a-f0-9]{48}$/.test(pairing.code))
        throw Error('app_accessories_pairing_unavailable');
      const enrolled = await this.providers.add(
        {
          url: `http://${this.address()}:${target.port}`,
          code: pairing.code,
          allowHttp: true,
        },
        target,
      );
      if (enrolled?.id !== target.bridgeId) throw Error('app_accessories_identity_mismatch');
    }
    await this.providers.refresh(target.bridgeId);
    const candidates = this.sources.preview(target.bridgeId, this.registry());
    const ids = candidates.filter((item) => !item.imported).map((item) => item.physicalId);
    if (ids.length) await this.sources.import(target.bridgeId, ids, this.registry());
    await this.graph?.sync(target.bridgeId);
    return { connected: true, cameras: this.sources.preview(target.bridgeId, this.registry()) };
  }

  private async target(actor: string, appId: string) {
    const manifest = await this.home.appAccessoryManifest(actor, appId);
    const port = appAccessoryPort(manifest);
    if (!port) throw Error('app_accessories_unsupported');
    const info = await this.local(port, '/api/haus/v2/info');
    if (info.version !== 2 || !uuid(info.bridgeId) || !providerId(info.provider))
      throw Error('app_accessories_identity_invalid');
    return { port, bridgeId: info.bridgeId, provider: info.provider };
  }
}
