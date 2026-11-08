/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { cameraFailureCode } from '@haus/media/failure';
import { kitsuneDeviceIdentity } from '@haus/kitsune';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export interface HaCamerasCatalogLike {
  enroll(input: {
    id: string;
    tokenHash: string;
    createdAt: number;
    nativeEntities: boolean;
  }): Promise<unknown> | unknown;
  canManageNative(clientId: string): boolean;
  authenticate(tokenHash: string): string | undefined;
  revoke(clientId: string, owned: string[], at: number): Promise<unknown> | unknown;
}

export interface HaCameraRecord {
  id: string;
  name?: string;
  available?: boolean;
  deviceId?: string | null;
  areaId?: string | null;
  kitsuneProvider?: {
    pluginId: string;
    deviceId: string;
  };
  nativeProvider?: Record<string, unknown>;
  nativeSource?: Record<string, unknown>;
}

export interface HaCamerasRegistry {
  cameras: HaCameraRecord[];
  states?: Array<{
    entity_id: string;
    state?: string;
    attributes?: {
      haus_camera_proxy?: number;
      haus_native_camera?: number;
      [key: string]: unknown;
    };
  }>;
  entities?: Array<{
    entity_id: string;
    platform?: string;
  }>;
}

export interface HaCamerasSnapshotsLike {
  snapshot?(camera: HaCameraRecord): Promise<unknown>;
}

export interface HaCamerasSessionsLike {
  viewer?(
    camera: HaCameraRecord,
    owner: string,
    viewerId: string,
    offer: unknown,
  ): Promise<unknown>;
  viewerCandidate?(
    cameraId: string,
    owner: string,
    viewerId: string,
    candidate: unknown,
  ): Promise<unknown> | unknown;
  ensure?(camera: HaCameraRecord, owner: string): Promise<unknown>;
  closeViewer?(cameraId: string, owner: string, viewerId: string): Promise<unknown>;
  release?(cameraId: string, owner: string): Promise<unknown>;
}

export interface HaCameraView {
  id: string;
  name?: string;
  available: boolean;
  deviceId: string | null;
  areaId: string | null;
  native?: Record<string, unknown> & { primary: boolean };
}

export interface HaCamerasOptions {
  catalog: HaCamerasCatalogLike;
  registry: () => HaCamerasRegistry;
  snapshots?: HaCamerasSnapshotsLike;
  sessions?: HaCamerasSessionsLike;
  now?: () => number;
  onRevoke?: (clientId: string) => Promise<unknown> | unknown;
  log?: (value: Record<string, unknown>) => void;
}

interface ViewerState {
  clientId: string;
  cameraId: string;
  owner: string;
  viewerId: string;
  until: number;
  key: string;
}

/** Camera-only capabilities cannot change sources, HomeKit pairing or the cluster. */
export class HaCameras {
  catalog: HaCamerasCatalogLike;
  registry: () => HaCamerasRegistry;
  snapshots: HaCamerasSnapshotsLike;
  sessions: HaCamerasSessionsLike;
  now: () => number;
  onRevoke: (clientId: string) => Promise<unknown> | unknown;
  log: (value: Record<string, unknown>) => void;
  codes = new Map<string, { until: number; nativeEntities: boolean }>();
  viewers = new Map<string, ViewerState>();
  stopped = false;
  timer: ReturnType<typeof setInterval>;

  constructor({
    catalog,
    registry,
    snapshots = {},
    sessions = {},
    now = Date.now,
    onRevoke = () => {},
    log = (value) => console.warn(JSON.stringify(value)),
  }: HaCamerasOptions) {
    this.catalog = catalog;
    this.registry = registry;
    this.snapshots = snapshots;
    this.sessions = sessions;
    this.now = now;
    this.onRevoke = onRevoke;
    this.log = log;
    this.timer = setInterval(() => void this.tick().catch(() => {}), 15000);
    this.timer.unref();
  }

  async setup(input: {
    action: 'setup';
    nativeEntities?: boolean;
  }): Promise<{ setupCode: string; expiresAt: number; nativeEntities: boolean; url: string }>;
  async setup(input: {
    action?: string;
    clientId?: string;
    nativeEntities?: boolean;
    [key: string]: unknown;
  }): Promise<
    | { revoked: true }
    | { setupCode: string; expiresAt: number; nativeEntities: boolean; url: string }
  >;
  async setup(input: {
    action?: string;
    clientId?: string;
    nativeEntities?: boolean;
    [key: string]: unknown;
  }): Promise<
    | { revoked: true }
    | { setupCode: string; expiresAt: number; nativeEntities: boolean; url: string }
  > {
    if (
      input.action === 'revoke' &&
      typeof input.clientId === 'string' &&
      /^[a-f0-9]{24}$/.test(input.clientId)
    ) {
      return this.revoke(input.clientId);
    }
    if (
      input.action !== 'setup' ||
      Object.keys(input).some((key) => !['action', 'nativeEntities'].includes(key)) ||
      (input.nativeEntities !== undefined && typeof input.nativeEntities !== 'boolean')
    )
      throw Error('invalid_ha_integration');
    for (const [key, value] of this.codes) if (value.until < this.now()) this.codes.delete(key);
    if (this.codes.size >= 4) {
      const oldest = this.codes.keys().next().value;
      if (oldest !== undefined) this.codes.delete(oldest);
    }
    const setupCode = randomBytes(24).toString('hex'),
      expiresAt = this.now() + 600000;
    this.codes.set(hash(setupCode), {
      until: expiresAt,
      nativeEntities: input.nativeEntities === true,
    });
    return {
      setupCode,
      expiresAt,
      nativeEntities: input.nativeEntities === true,
      url: 'http://127.0.0.1:8099',
    };
  }

  async enroll(input: {
    code?: unknown;
  }): Promise<{ clientId: string; token: string; profile: 1; nativeEntities: boolean }> {
    if (typeof input?.code !== 'string' || !/^[a-f0-9]{48}$/.test(input.code))
      throw Error('invalid_ha_setup_code');
    const digest = hash(input.code),
      scope = this.codes.get(digest);
    this.codes.delete(digest);
    if (!scope || scope.until < this.now() || this.stopped) throw Error('invalid_ha_setup_code');
    const token = randomBytes(32).toString('hex'),
      id = randomBytes(12).toString('hex');
    await this.catalog.enroll({
      id,
      tokenHash: hash(token),
      createdAt: this.now(),
      nativeEntities: scope.nativeEntities,
    });
    return { clientId: id, token, profile: 1, nativeEntities: scope.nativeEntities };
  }

  canManageNative(clientId: string): boolean {
    return this.catalog.canManageNative(clientId);
  }

  authenticate(req: Pick<IncomingMessage, 'headers' | 'method' | 'url'>): string | undefined {
    const authorization = req.headers.authorization ?? '';
    let token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
    // HA Generic Camera supports Basic auth for still images. This compatibility
    // form cannot list cameras, create viewers or perform any mutation.
    if (
      !token &&
      req.method === 'GET' &&
      /^\/ha\/cameras\/camera\.[a-z0-9_]+\/snapshot$/.test(req.url ?? '')
    ) {
      const encoded = /^Basic ([A-Za-z0-9+/=]{1,128})$/i.exec(authorization)?.[1];
      if (encoded)
        token = /^haus:([a-f0-9]{64})$/.exec(Buffer.from(encoded, 'base64').toString('utf8'))?.[1];
    }
    return token ? this.catalog.authenticate(hash(token)) : undefined;
  }

  async revoke(clientId: string): Promise<{ revoked: true }> {
    await this.onRevoke(clientId);
    await this.catalog.revoke(clientId, [], this.now());
    await Promise.allSettled(
      [...this.viewers.values()]
        .filter((state) => state.clientId === clientId)
        .map((state) => this.close(state)),
    );
    return { revoked: true };
  }

  cameras(): HaCameraView[] {
    return this.registry().cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      available: camera.available === true,
      deviceId: camera.deviceId ?? null,
      areaId: camera.areaId ?? null,
      ...(camera.kitsuneProvider
        ? { native: { ...kitsuneDeviceIdentity(camera.kitsuneProvider), primary: true } }
        : {}),
      ...(camera.nativeProvider
        ? {
            native: {
              ...camera.nativeProvider,
              primary:
                !!this.registry().states?.length &&
                !this.registry().states!.some(
                  (state) =>
                    state.entity_id === camera.id &&
                    this.registry().entities?.find((entry) => entry.entity_id === camera.id)
                      ?.platform !== 'haus' &&
                    !state.attributes?.haus_camera_proxy &&
                    state.attributes?.haus_native_camera !== 1,
                ),
            },
          }
        : {}),
    }));
  }

  async command(
    clientId: string,
    id: string,
    action: string,
    input?: { sessionId?: unknown; offer?: unknown; candidate?: unknown },
  ): Promise<unknown> {
    const camera = this.registry().cameras.find((item) => item.id === id);
    if (!camera) throw Error('camera_not_found');
    if (action === 'snapshot') {
      if (!this.snapshots.snapshot) throw Error('camera_snapshot_unavailable');
      return this.snapshots.snapshot(camera);
    }
    if (!uuid(input?.sessionId)) throw Error('invalid_camera_viewer');
    const key = `${clientId}:${input.sessionId}`;
    if (action === 'viewer') {
      if (this.viewers.has(key) || this.viewers.size >= 32) throw Error('camera_viewer_busy');
      const state: ViewerState = {
        clientId,
        cameraId: camera.id,
        owner: `ha-${clientId}-${input.sessionId}`,
        viewerId: input.sessionId,
        until: this.now() + 60000,
        key,
      };
      this.viewers.set(key, state);
      const started = this.now();
      try {
        if (!this.sessions.viewer) throw Error('camera_viewer_unavailable');
        return await this.sessions.viewer(camera, state.owner, state.viewerId, input.offer);
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        try {
          this.log({
            component: 'ha-camera',
            event: 'viewer-open-failed',
            cameraId: camera.id,
            reason: cameraFailureCode(error),
            elapsedMs: Math.max(0, this.now() - started),
            ...(typeof status === 'number' &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
              ? { status }
              : {}),
          });
        } catch {
          /* Diagnostics cannot interrupt viewer cleanup. */
        }
        await this.close(state);
        throw error;
      }
    }
    const state = this.viewers.get(key);
    if (!state || state.cameraId !== camera.id) throw Error('camera_session_not_found');
    state.until = this.now() + 60000;
    if (action === 'close') {
      await this.close(state);
      return { closed: true };
    }
    if (action === 'candidate') {
      if (!this.sessions.viewerCandidate) throw Error('camera_viewer_unavailable');
      return this.sessions.viewerCandidate(
        camera.id,
        state.owner,
        state.viewerId,
        input?.candidate,
      );
    }
    if (action === 'lease') {
      if (!this.sessions.ensure) throw Error('camera_viewer_unavailable');
      await this.sessions.ensure(camera, state.owner);
      return { renewed: true };
    }
    throw Error('invalid_camera_action');
  }

  async close(state: ViewerState): Promise<void> {
    this.viewers.delete(state.key);
    await this.sessions.closeViewer?.(state.cameraId, state.owner, state.viewerId).catch(() => {});
    await this.sessions.release?.(state.cameraId, state.owner).catch(() => {});
  }

  async tick(): Promise<void> {
    for (const state of this.viewers.values())
      if (state.until < this.now()) await this.close(state);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.viewers.values()].map((state) => this.close(state)));
    this.codes.clear();
  }
}
