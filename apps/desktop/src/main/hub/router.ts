/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HomeAssistantConnection } from '../connection';
import type { NativeSession } from '../../shared/native';
import { normalizeServerUrl } from '../validation';
import type { HubConnection } from './connection';

/**
 * The one connection the desktop main process talks to. A saved Hub session wins at
 * startup; Home Assistant stays an explicit, separate choice and is never touched
 * while a Hub is active.
 */
export class NativeConnection {
  private active: 'ha' | 'hub' = 'hub';

  constructor(
    private readonly ha: HomeAssistantConnection,
    private readonly hub: HubConnection,
  ) {}

  private get hubActive(): boolean {
    return this.active === 'hub';
  }

  get isHub(): boolean {
    return this.hubActive;
  }
  get connected(): boolean {
    return this.hubActive ? this.hub.connected : this.ha.connected;
  }
  get serverUrl(): string | undefined {
    return this.hubActive ? this.hub.serverUrl : this.ha.serverUrl;
  }
  get credentialScope(): string | undefined {
    return this.hubActive ? this.hub.credentialScope : this.ha.credentialScope;
  }
  getBearerToken(): string | undefined {
    return this.hubActive ? this.hub.getBearerToken() : undefined;
  }

  async getSession(): Promise<NativeSession | null> {
    const hub = await this.hub.getSession();
    if (hub) {
      this.active = 'hub';
      return hub;
    }
    const haSession = await this.ha.getSession();
    if (haSession) {
      this.active = 'ha';
      return haSession;
    }
    this.active = 'hub';
    return null;
  }

  /** True when the address is an onboarded Haus Hub that waits for its pairing code. */
  async beginPairing(input: unknown): Promise<boolean> {
    const url = normalizeServerUrl(input);
    if (!(await this.hub.probe(url))) return false;
    const offer = await this.hub.startPairing(url);
    return !offer.firstOnboarding;
  }

  async connect(input: unknown, code?: unknown, explicitHa = false): Promise<NativeSession> {
    const url = normalizeServerUrl(input);
    if (explicitHa) {
      const session = await this.ha.connect(url);
      await this.hub.disconnect();
      this.active = 'ha';
      return session;
    }
    const session = await this.hub.connect(url, typeof code === 'string' ? code : undefined);
    this.ha.dispose();
    this.active = 'hub';
    return session;
  }

  disconnect(): Promise<void> {
    return this.hubActive ? this.hub.disconnect() : this.ha.disconnect();
  }

  dispose(): void {
    this.ha.dispose();
    this.hub.dispose();
  }

  cachedHome() {
    return this.hubActive ? this.hub.cachedHome() : this.ha.cachedHome();
  }

  request<T = unknown>(message: Record<string, unknown>): Promise<T> {
    return this.hubActive ? this.hub.request<T>(message) : this.ha.request<T>(message);
  }

  subscribe(message: Record<string, unknown>): Promise<string> {
    return this.hubActive ? this.hub.subscribe() : this.ha.subscribe(message);
  }

  unsubscribe(id: string): Promise<void> {
    return this.hubActive ? this.hub.unsubscribe() : this.ha.unsubscribe(id);
  }

  cameraLastSnapshot(entityId: unknown) {
    return this.hubActive
      ? this.hub.cameraLastSnapshot(entityId)
      : this.ha.cameraLastSnapshot(entityId);
  }

  cameraSnapshot(entityId: unknown, download?: () => Promise<Response>) {
    return this.hubActive
      ? this.hub.cameraSnapshot(entityId)
      : this.ha.cameraSnapshot(entityId, download);
  }

  management(input: unknown): Promise<unknown> {
    return this.hubActive ? this.hub.management(input) : this.ha.management(input);
  }

  nativeProviders(input: unknown): Promise<unknown> {
    if (!this.hubActive) throw new Error('Camera bridge management requires a Haus Hub.');
    return this.hub.nativeProviders(input);
  }

  brandIcon(kind: unknown, id: unknown, dark = false): Promise<string | null> {
    return this.hubActive ? this.hub.brandIcon() : this.ha.brandIcon(kind, id, dark);
  }

  addonSurface(slug: unknown) {
    return this.hubActive ? this.hub.addonSurface() : this.ha.addonSurface(slug);
  }

  getSceneConfig(entityId: unknown, sceneId: unknown) {
    return this.hubActive ? this.hub.getSceneConfig() : this.ha.getSceneConfig(entityId, sceneId);
  }

  refreshHub(): Promise<void> {
    return this.hubActive ? this.hub.refresh(false) : Promise.resolve();
  }
}

/** The public surface main-process consumers depend on; Home Assistant's connection satisfies it too. */
export type NativeConnectionPort = {
  [
    K in Exclude<
      keyof NativeConnection,
      'beginPairing' | 'nativeProviders' | 'isHub' | 'getBearerToken' | 'refreshHub'
    >
  ]: NativeConnection[K];
} & {
  readonly isHub?: boolean;
  getBearerToken?: () => string | undefined;
  refreshHub?: () => Promise<void>;
};
