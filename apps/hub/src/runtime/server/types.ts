/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import type { HaCameras } from '@haus/ha/node/ha-cameras';
import type { HubAuthService } from '../../auth/index.js';
import type { PlaybackPreparation } from '../../events/index.js';
import type { CameraAccessBootstrap } from '../../camera/index.js';

export const webDir = join(dirname(fileURLToPath(import.meta.url)), '../../../web');

export const publicCamera = (
  camera: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!camera) return undefined;
  const {
    talkback,
    nativeSource: _nativeSource,
    nativeTalkback: _nativeTalkback,
    kitsuneSource: _kitsuneSource,
    ...visible
  } = camera;
  return { ...visible, talkbackConfigured: Boolean(talkback) };
};

export const safeEqual = (a: string | undefined, b: string | undefined): boolean => {
  const left = Buffer.from(a || ''),
    right = Buffer.from(b || '');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

export const json = (res: ServerResponse, status: number, value: unknown): ServerResponse =>
  res
    .writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(value));

export function sendApiError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.destroyed) {
    res.destroy();
    return;
  }
  const message = String((error as Error)?.message ?? error);
  if (/^kitsune_(?:setting_requires_review|missing_field)(?::[a-zA-Z]+)?$/.test(message)) {
    json(res, 409, { error: message.split(':')[0] });
    return;
  }
  if (['kitsune_unknown_vendor', 'kitsune_native_onboarding_required'].includes(message)) {
    json(res, 400, { error: message });
    return;
  }
  if (
    [
      'kitsune_plugin_capacity',
      'kitsune_capability_unavailable',
      'camera_control_busy',
      'camera_control_unconfirmed',
      'camera_control_unavailable',
      'recording_storage_limit',
    ].includes(message)
  ) {
    json(res, 409, { error: message });
    return;
  }
  if (message === 'archived_original_required_for_repair') {
    json(res, 503, { error: message });
    return;
  }
  const client = /^(invalid_|json_required|body_too_large|recording_disabled)/.test(message);
  json(res, client ? 400 : 503, {
    error: client ? message : 'service_temporarily_unavailable',
  });
}

export interface RegistrySnapshotLike {
  states: Array<{
    entity_id: string;
    state: string;
    attributes: { friendly_name?: string; [key: string]: unknown };
    [key: string]: unknown;
  }>;
  entities: Array<{ entity_id: string; platform?: string; [key: string]: unknown }>;
  devices: Array<{ id: string; [key: string]: unknown }>;
  cameras: Array<
    Record<string, unknown> & {
      id: string;
      name: string;
      aliases?: string[];
      available?: boolean;
      enabled?: boolean;
    }
  >;
  areas?: Array<{ area_id: string; name?: string; [key: string]: unknown }>;
}

export interface CreateApiContext {
  config: {
    data: string;
    media: string;
    standalone?: boolean;
    apiToken?: string;
    recording_enabled?: boolean;
    max_storage_gb: number;
    retention_days?: number;
    eufy_ws_url?: string;
    [key: string]: unknown;
  };
  ha?: {
    connected?: boolean;
    request(message: Record<string, unknown>): Promise<unknown>;
    registry(): Promise<RegistrySnapshotLike>;
    on?(event: string, listener: (...args: unknown[]) => void): unknown;
    off?(event: string, listener: (...args: unknown[]) => void): unknown;
    [key: string]: unknown;
  };
  store: {
    media?: string;
    totals(): Promise<{
      bytes: number;
      archivedBytes: number;
      unavailableBytes: number;
      totalBytes: number;
      localEvents: number;
      archivedEvents: number;
      [key: string]: unknown;
    }>;
    recordedDays(input: { cameraId: string; boundaries: number[] }): Promise<unknown>;
    list(filters: Record<string, unknown>): Promise<Record<string, unknown>>;
    availability(filters: Record<string, unknown>): Promise<unknown>;
    overrides(): Promise<Record<string, Record<string, unknown>>>;
    setCamera(id: string, value: Record<string, unknown>): Promise<unknown>;
    pinMedia(id: string, signal: AbortSignal): Promise<() => void>;
    get(id: string): Promise<
      | (Record<string, unknown> & {
          id: string;
          status: string;
          playbackBytes?: number | null;
          localOriginal?: boolean;
          localPlayback?: boolean;
          playbackVersion?: number;
        })
      | undefined
    >;
    archive: {
      hasVerifiedLocation(id: string, variant: string, version?: number): Promise<boolean>;
    };
    path(id: string, ext: string): string;
    setLocal(id: string, variant: string, local: boolean): Promise<unknown>;
    [key: string]: unknown;
  };
  kitsune?: {
    hub: {
      canWebhook(pluginId: string, token: string): boolean;
      webhook(
        pluginId: string,
        route: string | undefined,
        request: Record<string, unknown>,
        token: string,
      ): Promise<{ code: number; headers: Record<string, string>; body: string | Buffer }>;
      catalog(): Array<{ id: string; route: { package: string }; [key: string]: unknown }>;
      plugins: Map<
        string,
        {
          plugin: { version?: string | null };
          call(method: string): Promise<unknown>;
        }
      >;
    };
    onboard(vendor: string, fields: unknown): Promise<unknown>;
    create(vendor: string, settings: unknown): Promise<unknown>;
    enable(
      vendor: string,
      version?: string,
    ): Promise<{ version?: string | null; driver?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  recorder: {
    status(): unknown;
    processingStatus?(): unknown;
    trigger(id: string): Promise<unknown>;
    preparePlayback?(
      event: unknown,
      priority?: number,
      options?: { forceCompatibility?: boolean },
    ): Promise<string>;
    [key: string]: unknown;
  };
  getRegistry: () => RegistrySnapshotLike;
  refresh: () => Promise<void>;
  cluster?: {
    abort?: AbortController;
    health?: Map<string, Record<string, unknown>>;
    refreshHealth?(): Promise<unknown>;
    status(): {
      nodes?: Array<
        Record<string, unknown> & {
          id: string;
          name: string;
          url: string;
          enabled: boolean;
          roles: string[];
        }
      >;
      [key: string]: unknown;
    };
    add(input: unknown): Promise<unknown>;
    remove(id: string): Promise<unknown>;
    update(id: string, input: unknown): Promise<unknown>;
    nodes(): Array<{ id: string; key: string; url: string; roles: string[]; [key: string]: unknown }>;
    tick(): Promise<unknown>;
    source(event: unknown): Promise<unknown>;
    archiveMedia?(
      event: unknown,
      variant: string,
      range: string | undefined,
      signal: AbortSignal,
      method: string | undefined,
    ): Promise<{ response: Response; release: () => void } | null>;
    media(
      event: unknown,
      range: string | undefined,
      signal: AbortSignal,
    ): Promise<Response | null>;
    [key: string]: unknown;
  };
  backups?: {
    list(): Array<{ digest: string; kind: string; path: string; [key: string]: unknown }>;
    busy?: boolean;
    error?: string | null;
    markChanged(): void;
    recoveryKit(): Record<string, unknown>;
    canSnapshot?(kind: string): boolean;
    snapshot(kind: string): Promise<unknown>;
    [key: string]: unknown;
  };
  shared?: {
    revision?: string;
    get(): Promise<unknown>;
    patch(
      baseRevision: unknown,
      patch: unknown,
    ): Promise<{ conflict?: boolean; [key: string]: unknown }>;
    subscribe(listener: () => void): void | (() => void);
    [key: string]: unknown;
  };
  warm?: {
    entries: Map<string, { job?: { id: string; node: { url: string; key: string } } }>;
    source(
      token: string,
      resource: string,
    ): Promise<{ response: Response; url: URL; entry: unknown }>;
    resource(entry: unknown, value: string): string;
    touch(camera: unknown, owner: unknown, active: boolean, preview: boolean): Promise<unknown>;
    [key: string]: unknown;
  };
  motion?: {
    status(cameraId: string): unknown;
    [key: string]: unknown;
  };
  activity?: {
    status(cameraId: string): unknown;
    [key: string]: unknown;
  };
  cameraSessions?: {
    registry?(): unknown;
    camera?(cameraId: string): unknown;
    advertiseHost?(node: unknown): Promise<string>;
    ensure?(camera: unknown, owner: string): Promise<unknown>;
    release?(cameraId: string, owner: string): Promise<unknown>;
    viewerCandidate?(cameraId: string, owner: string, viewerId: string, candidate: unknown): Promise<unknown>;
    clearContinuityNode?(nodeId: string): Promise<unknown>;
    closeViewer(cameraId: string, owner: unknown, viewerId: unknown): Promise<unknown>;
    viewer(camera: unknown, owner: unknown, viewerId: unknown, offer: unknown): Promise<unknown>;
    syncContinuity?(force?: boolean): Promise<unknown>;
    sourceHealth?(): unknown[];
    [key: string]: unknown;
  };
  homekit?: {
    status(cameraId: string): unknown;
    pairing(cameraId: string): Promise<unknown>;
    managePairing(cameraId: string, action: 'close' | 'reset'): Promise<unknown>;
    tick(): Promise<unknown>;
    [key: string]: unknown;
  };
  operating?: {
    read(cameraId: string): unknown;
    write(cameraId: string, control: unknown, entityId: string, value: boolean): Promise<unknown>;
  };
  providers?: {
    list(): Array<{ id: string; [key: string]: unknown }>;
    add(input: unknown): Promise<unknown>;
    remove(id: string): Promise<unknown>;
    [key: string]: unknown;
  };
  nativeSources?: {
    preview(bridgeId: string, registry: unknown): unknown;
    import(bridgeId: string, cameras: unknown, registry: unknown): Promise<unknown>;
    [key: string]: unknown;
  };
  nativeEntities?: {
    revokeClient(clientId: string): Promise<unknown>;
    acknowledge(clientId: string, input: unknown): Promise<unknown>;
    devices(): unknown[];
    command(cameraId: string, entityId: string, input: unknown): Promise<unknown>;
    handoverStatus(
      bridgeId: string,
      registry: unknown,
      ignoredLegacy?: Set<string>,
    ): { state: string; [key: string]: unknown };
    transaction<T>(id: string, action: () => Promise<T> | T): Promise<T>;
    completeHandover(id: string): Promise<unknown>;
    [key: string]: unknown;
  };
  nativeMigration?: {
    ignoredLegacy(bridgeId: string, registry: unknown): Set<string>;
    status(bridgeId: string): unknown;
    review(bridgeId: string): Promise<unknown>;
    start(bridgeId: string, input: unknown, undo: boolean): unknown;
    beforeHandover(bridgeId: string): Promise<void>;
    handoverStarted(bridgeId: string): Promise<void>;
    handoverFinished(bridgeId: string): Promise<void>;
    [key: string]: unknown;
  };
  applyProviders?: () => Promise<void>;
  snapshots?: {
    snapshot(camera: unknown): Promise<{
      mime: string;
      stale?: boolean;
      at: number;
      buffer: Buffer;
    }>;
  };
  talkback: {
    available(camera: unknown, registry: unknown): Promise<boolean> | boolean;
    stream(
      camera: unknown,
      registry: unknown,
      req: IncomingMessage,
      res: ServerResponse,
    ): Promise<unknown>;
    stopAll(): void;
  };
  controlService?: unknown;
  authService?: HubAuthService;
  runtime?: { connected?: boolean; [key: string]: unknown };
  serviceCatalog?: {
    policy(name: string): string | undefined;
    savePolicy(name: string, value: string): Promise<unknown> | unknown;
    savePlugin(vendor: string, version: string | null): Promise<unknown>;
    [key: string]: unknown;
  };
  haCatalog?: unknown;
  servers?: {
    status(): Promise<unknown>;
    update(patch: unknown): Promise<void>;
    telemetry?: { stop(): void };
    storageUsage?: { stop(): Promise<void> | void } | null;
  } | null;
  preparation: PlaybackPreparation;
  haCameras?: HaCameras;
  cameraAccess?: CameraAccessBootstrap;
  getProviderDiscovery: () => Promise<unknown> | undefined;
  setProviderDiscovery: (promise: Promise<unknown> | undefined) => void;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
  address: string | undefined,
  ctx: CreateApiContext,
) => Promise<boolean>;
