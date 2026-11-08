/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import metadata from '../../../package.json' with { type: 'json' };
import { HaCameras } from '@haus/ha/node/ha-cameras';
import { Servers } from '../../servers/index.js';
import { liveChannel } from '../../stream/index.js';
import { CameraAccessBootstrap, createTalkback } from '../../camera/index.js';
import { PlaybackPreparation } from '../../events/index.js';
import { requestBody } from '../../http/index.js';
import {
  json,
  safeEqual,
  sendApiError,
  webDir,
  type CreateApiContext,
} from './types.js';
import {
  handlePreAuthRoutes,
  handleProviderAndKitsuneRoutes,
} from './integrations.js';
import { handleCameraAndEventRoutes } from './cameras.js';

export { requestBody } from '../../http/index.js';

export type CreateApiOptions = Omit<
  CreateApiContext,
  'talkback' | 'preparation' | 'haCameras' | 'cameraAccess' | 'getProviderDiscovery' | 'setProviderDiscovery'
> & {
  talkback?: CreateApiContext['talkback'];
};

export function createApi({
  config,
  ha,
  store,
  kitsune,
  recorder,
  getRegistry,
  refresh,
  cluster,
  backups,
  shared,
  warm,
  motion,
  activity,
  cameraSessions,
  homekit,
  operating,
  providers,
  nativeSources,
  nativeEntities,
  nativeMigration,
  applyProviders,
  snapshots,
  talkback: sharedTalkback,
  controlService,
  authService,
  runtime,
  serviceCatalog,
  haCatalog,
  servers = serviceCatalog
    ? new Servers({
        config: config as ConstructorParameters<typeof Servers>[0]['config'],
        ha,
        runtime,
        store: store as ConstructorParameters<typeof Servers>[0]['store'],
        catalog: serviceCatalog as ConstructorParameters<typeof Servers>[0]['catalog'],
        cluster,
        backups,
      })
    : null,
}: CreateApiOptions): Server {
  const talkback = sharedTalkback ?? createTalkback({ config });
  let providerDiscovery: Promise<unknown> | undefined;
  const preparation = new PlaybackPreparation(
    recorder as ConstructorParameters<typeof PlaybackPreparation>[0],
  );
  const haCameras =
    haCatalog && snapshots && cameraSessions
      ? new HaCameras({
          catalog: haCatalog as ConstructorParameters<typeof HaCameras>[0]['catalog'],
          registry: getRegistry as ConstructorParameters<typeof HaCameras>[0]['registry'],
          snapshots: snapshots as ConstructorParameters<typeof HaCameras>[0]['snapshots'],
          sessions: cameraSessions as NonNullable<
            ConstructorParameters<typeof HaCameras>[0]['sessions']
          >,
          onRevoke: (id) => nativeEntities?.revokeClient(id),
        })
      : undefined;
  const cameraAccess =
    cameraSessions && cluster
      ? new CameraAccessBootstrap({
          sessions: cameraSessions as NonNullable<
            ConstructorParameters<typeof CameraAccessBootstrap>[0]['sessions']
          >,
          cluster: cluster as NonNullable<
            ConstructorParameters<typeof CameraAccessBootstrap>[0]['cluster']
          >,
          config: config as ConstructorParameters<typeof CameraAccessBootstrap>[0]['config'],
        })
      : undefined;

  const ctx: CreateApiContext = {
    config,
    ha,
    store,
    kitsune,
    recorder,
    getRegistry,
    refresh,
    cluster,
    backups,
    shared,
    warm,
    motion,
    activity,
    cameraSessions,
    homekit,
    operating,
    providers,
    nativeSources,
    nativeEntities,
    nativeMigration,
    applyProviders,
    snapshots,
    talkback,
    controlService,
    authService,
    runtime,
    serviceCatalog,
    haCatalog,
    servers,
    preparation,
    haCameras,
    cameraAccess,
    getProviderDiscovery: () => providerDiscovery,
    setProviderDiscovery: (promise) => {
      providerDiscovery = promise;
    },
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://haus.invalid');
      const path = url.pathname;
      const address = req.socket.remoteAddress?.replace(/^::ffff:/, '');

      if (await handlePreAuthRoutes(req, res, path, address, ctx)) return;

      const bearerToken = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined;
      const authorized = config.standalone
        ? safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`) ||
          Boolean(bearerToken && authService && (await authService.authenticate(bearerToken)))
        : address === '172.30.32.2';
      if (!authorized) {
        json(res, 401, { error: 'authentication_required' });
        return;
      }

      if (path === '/api/camera-access' && req.method === 'POST' && cameraAccess) {
        const input = (await requestBody(req)) as Record<string, unknown>;
        json(res, 200, await cameraAccess.bootstrap(input.cameraId as string, input.clientId as string));
        return;
      }

      if (
        !config.standalone &&
        (/^\/api\/(?:providers|kitsune)(?:\/|$)/.test(path) ||
          (req.method !== 'GET' &&
            (/^\/api\/(cluster|backups|servers|ha-integration)(?:\/|$)/.test(path) ||
              /^\/api\/cameras\/camera\.[a-z0-9_]+\/homekit(?:\/|$)/.test(path))))
      ) {
        const id = req.headers['x-remote-user-id'];
        let users: Array<{ id?: string; is_active?: boolean; is_owner?: boolean; group_ids?: string[] }>;
        try {
          users = (await ha!.request({ type: 'config/auth/list' })) as typeof users;
        } catch {
          json(res, 503, {
            error: 'administrator_verification_unavailable',
          });
          return;
        }
        const user = users.find((item) => item.id === id);
        if (!user?.is_active || !(user.is_owner || user.group_ids?.includes('system-admin'))) {
          json(res, 403, { error: 'administrator_required' });
          return;
        }
      }

      if (await handleProviderAndKitsuneRoutes(req, res, path, ctx)) return;

      if (
        req.method === 'GET' &&
        ['/', '/index.html', '/app.js', '/style.css', '/icon.png'].includes(path)
      ) {
        const filename = path === '/' ? 'index.html' : path.slice(1);
        const ext = filename.split('.').at(-1) ?? '';
        const type = {
          html: 'text/html',
          js: 'text/javascript',
          css: 'text/css',
          png: 'image/png',
        }[ext];
        const bytes = await readFile(join(webDir, filename));
        res
          .writeHead(200, {
            'Content-Type': `${type}; charset=utf-8`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
              "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'",
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-cache',
          })
          .end(bytes);
        return;
      }

      if (shared && path === '/api/preferences') {
        if (req.method === 'GET') {
          json(res, 200, await shared.get());
          return;
        }
        if (req.method === 'PATCH') {
          const input = (await requestBody(req)) as Record<string, unknown>;
          const result = await shared.patch(input.baseRevision, input.patch);
          json(res, result.conflict ? 409 : 200, result);
          return;
        }
      }
      if (servers && path === '/api/servers' && req.method === 'GET') {
        json(res, 200, await servers.status());
        return;
      }
      if (servers && path === '/api/servers/home-assistant' && req.method === 'PATCH') {
        await servers.update(await requestBody(req));
        json(res, 200, await servers.status());
        return;
      }
      if (cluster && path === '/api/cluster' && req.method === 'GET') {
        json(res, 200, cluster.status());
        return;
      }
      if (cluster && path === '/api/cluster/nodes' && req.method === 'POST') {
        json(res, 201, await cluster.add(await requestBody(req)));
        return;
      }
      const nodeMatch = /^\/api\/cluster\/nodes\/([a-f0-9-]{36})(\/remove)?$/.exec(path);
      if (cluster && nodeMatch && ['POST', 'PATCH'].includes(req.method ?? '')) {
        const input = (await requestBody(req)) as Record<string, unknown>;
        if ((nodeMatch[2] && req.method === 'POST') || input.enabled === false)
          await cameraSessions?.clearContinuityNode?.(nodeMatch[1]!);
        json(
          res,
          200,
          await (nodeMatch[2] && req.method === 'POST'
            ? cluster.remove(nodeMatch[1]!)
            : cluster.update(nodeMatch[1]!, input)),
        );
        return;
      }
      if (backups && path === '/api/backups' && req.method === 'GET') {
        json(res, 200, {
          items: backups.list(),
          busy: backups.busy,
          error: backups.error,
        });
        return;
      }
      if (backups && path === '/api/backups/recovery' && req.method === 'POST') {
        await requestBody(req);
        json(res, 200, {
          ...backups.recoveryKit(),
          nodes: cluster?.nodes() ?? [],
        });
        return;
      }
      if (backups && path === '/api/backups/create' && req.method === 'POST') {
        const input = (await requestBody(req)) as Record<string, unknown>;
        if (!['haus', 'ha'].includes(String(input.kind))) throw new Error('invalid_backup_kind');
        const kind = String(input.kind);
        if (backups.canSnapshot ? !backups.canSnapshot(kind) : backups.busy) {
          json(res, 409, { error: 'backup_busy' });
          return;
        }
        if (kind === 'ha' && config.standalone) {
          json(res, 409, { error: 'supervisor_backups_unavailable' });
          return;
        }
        void backups
          .snapshot(kind)
          .then(() => cluster?.tick())
          .catch(() => {});
        json(res, 202, { started: true });
        return;
      }
      if (req.method === 'GET' && path === '/api/status') {
        json(res, 200, {
          protocol: 1,
          name: 'Haus',
          version: metadata.version,
          features: {
            homekitSecureVideo: Boolean(homekit),
            eufyTalkback: true,
            cluster: true,
            sharedPreferences: true,
            previewPreheat: true,
            nvrCameraSessions: !!cameraSessions,
            softwareMotion: !!motion,
            unifiedActivity: !!activity,
            customTalkback: true,
            recordingRepair: true,
            verifiedOriginalPlayback: true,
          },
          connected: runtime?.connected ?? ha?.connected,
          recordingEnabled: config.recording_enabled,
          storage: {
            ...(await store.totals()),
            maxBytes: config.max_storage_gb > 0 ? config.max_storage_gb * 1024 ** 3 : null,
            retentionDays: config.retention_days,
          },
          buffers: recorder.status(),
          processing: recorder.processingStatus?.(),
        });
        return;
      }
      if (haCameras && path === '/api/ha-integration' && req.method === 'POST') {
        json(
          res,
          200,
          await haCameras.setup(
            (await requestBody(req)) as Parameters<typeof haCameras.setup>[0],
          ),
        );
        return;
      }

      if (await handleCameraAndEventRoutes(req, res, url, path, ctx)) return;

      json(res, 404, { error: 'not_found' });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  const live = liveChannel(server, {
    authorize: (req) =>
      config.standalone
        ? safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`)
        : req.socket.remoteAddress?.replace(/^::ffff:/, '') === '172.30.32.2',
    shared,
    ha: ha as Parameters<typeof liveChannel>[1]['ha'],
    sources: () => cameraSessions?.sourceHealth?.() ?? [],
  });
  server.on('request', (req, res) => {
    if (
      (req.method === 'PATCH' && /^\/api\/cameras\/camera\.[a-z0-9_]+$/.test(req.url ?? '')) ||
      (req.method === 'POST' &&
        /^\/api\/cameras\/camera\.[a-z0-9_]+\/(?:operating|homekit(?:\/(?:pair|close|reset))?)$/.test(
          req.url ?? '',
        ))
    )
      res.once('finish', () => {
        if (res.statusCode < 300) live.publish('cameras');
      });
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  const accessPolicy = cameraAccess && setInterval(() => void cameraAccess.reconcile(), 15000);
  server.on('close', () => {
    talkback.stopAll();
    void haCameras?.stop();
    preparation.clear();
    clearInterval(accessPolicy);
    servers?.telemetry?.stop();
    void servers?.storageUsage?.stop();
  });
  return server;
}
