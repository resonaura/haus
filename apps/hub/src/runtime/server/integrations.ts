/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { handleControlRoute } from '../../control/index.js';
import type { ControlService } from '../../control/index.js';
import { handleAuthRoute } from '../../auth/index.js';
import { rewritePlaylist } from '../../camera/index.js';
import { connectManagedProvider, discoverProviderBridges } from '../../providers/index.js';
import { requestBody } from '../../http/index.js';
import { json, safeEqual, type CreateApiContext } from './types.js';

export async function handlePreAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  address: string | undefined,
  ctx: CreateApiContext,
): Promise<boolean> {
  const { config, authService, controlService, kitsune, haCameras, nativeEntities, warm } = ctx;
  if (authService && path.startsWith('/api/auth/')) {
    const handled = await handleAuthRoute(req, res, path, {
      service: authService as Parameters<typeof handleAuthRoute>[3]['service'],
      readBody: requestBody,
    });
    if (handled) return true;
  }
  if (controlService && path.startsWith('/api/control/')) {
    let actorId: string | undefined = config.standalone
      ? safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`)
        ? 'local-admin'
        : undefined
      : address === '172.30.32.2'
        ? (typeof req.headers['x-ingress-user'] === 'string' && req.headers['x-ingress-user']) ||
          'ingress-admin'
        : undefined;
    if (!actorId && authService && req.headers.authorization?.startsWith('Bearer ')) {
      const clientSession = await authService.authenticate(req.headers.authorization.slice(7));
      if (
        clientSession &&
        (clientSession.clientRole === 'admin' || clientSession.clientRole === 'member')
      ) {
        actorId = clientSession.clientId;
      }
    }
    const handled = await handleControlRoute(req, res, path, {
      service: controlService as ControlService,
      actorId,
      readBody: requestBody,
    });
    if (handled) return true;
  }
  const hook = /^\/api\/kitsune\/hooks\/([a-f0-9]{64})\/([^/]+)\/([^/]*)(?:\/.*)?$/.exec(path);
  if (kitsune && hook && ['GET', 'POST'].includes(req.method ?? '')) {
    const pluginId = decodeURIComponent(hook[2]!);
    if (!kitsune.hub.canWebhook(pluginId, hook[1])) {
      json(res, 401, { error: 'webhook_authentication_required' });
      return true;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 65536) throw Error('body_too_large');
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([, value]) => typeof value === 'string'),
    );
    const result = await kitsune.hub.webhook(
      pluginId,
      decodeURIComponent(hook[3]!) || undefined,
      {
        method: req.method,
        url: req.url,
        rootPath: '/api/kitsune/hooks/' + hook[1] + '/' + hook[2] + '/' + hook[3] + '/',
        headers,
        body,
      },
      hook[1],
    );
    res.writeHead(result.code, result.headers);
    res.end(result.body);
    return true;
  }
  if (haCameras && path.startsWith('/ha/')) {
    if (req.method === 'POST' && path === '/ha/enroll') {
      json(
        res,
        200,
        await haCameras.enroll((await requestBody(req)) as Parameters<typeof haCameras.enroll>[0]),
      );
      return true;
    }
    const clientId = haCameras.authenticate(req);
    if (!clientId) {
      json(res, 401, { error: 'camera_access_required' });
      return true;
    }
    if (path.startsWith('/ha/native/')) {
      if (!nativeEntities || !haCameras.canManageNative(clientId)) {
        json(res, 403, { error: 'native_access_required' });
        return true;
      }
      if (path === '/ha/native/ready' && req.method === 'POST') {
        json(res, 200, await nativeEntities.acknowledge(clientId, await requestBody(req)));
        return true;
      }
      if (path === '/ha/native/devices' && req.method === 'GET') {
        json(res, 200, { devices: nativeEntities.devices() });
        return true;
      }
      const target =
        /^\/ha\/native\/(camera\.[a-z0-9_]+)\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})\/command$/.exec(
          path,
        );
      if (!target || req.method !== 'POST') {
        json(res, 404, { error: 'not_found' });
        return true;
      }
      json(
        res,
        200,
        await nativeEntities.command(target[1]!, target[2]!, await requestBody(req)),
      );
      return true;
    }
    if (path === '/ha/revoke' && req.method === 'POST') {
      await requestBody(req);
      json(res, 200, await haCameras.revoke(clientId));
      return true;
    }
    if (path === '/ha/cameras' && req.method === 'GET') {
      json(res, 200, {
        profile: 1,
        nativeFeatures: { disabledReadiness: true },
        cameras: haCameras.cameras(),
      });
      return true;
    }
    const match =
      /^\/ha\/cameras\/(camera\.[a-z0-9_]+)\/(snapshot|viewer|candidate|close|lease)$/.exec(path);
    if (!match || (match[2] === 'snapshot' ? req.method !== 'GET' : req.method !== 'POST')) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    const result = (await haCameras.command(
      clientId,
      match[1]!,
      match[2]!,
      match[2] === 'snapshot'
        ? {}
        : ((await requestBody(req)) as Parameters<typeof haCameras.command>[3]),
    )) as { mime: string; at: number; stale?: boolean; buffer: Buffer };
    if (match[2] === 'snapshot') {
      res
        .writeHead(200, {
          'Content-Type': result.mime,
          'Cache-Control': 'no-store',
          'X-Haus-Snapshot-Captured-At': String(result.at),
          'X-Haus-Snapshot-Stale': result.stale ? '1' : '0',
        })
        .end(result.buffer);
      return true;
    }
    json(res, 200, result);
    return true;
  }
  if (path === '/health' && ['127.0.0.1', '::1'].includes(address ?? '')) {
    json(res, 200, { status: 'ok' });
    return true;
  }
  const sourceMatch =
    /^\/cluster\/source\/([a-f0-9]{48})\/([a-f0-9]{24}(?:\.(?:m3u8|ts|m4s|mp4|aac|key))?)$/.exec(
      path,
    );
  if (warm && sourceMatch && req.method === 'GET') {
    const upstream = await warm.source(sourceMatch[1], sourceMatch[2]);
    if (!upstream.response.ok) {
      await upstream.response.body?.cancel();
      json(res, 503, { error: 'source_unavailable' });
      return true;
    }
    const mime = upstream.response.headers.get('content-type') ?? 'application/octet-stream';
    if (/mpegurl/i.test(mime) || upstream.url.pathname.endsWith('.m3u8')) {
      const text = await upstream.response.text();
      if (text.length > 256000) throw new Error('invalid_playlist');
      const body = rewritePlaylist(
        text,
        upstream.url.href,
        (value: string) =>
          `/cluster/source/${sourceMatch[1]}/${warm.resource(upstream.entry, value)}`,
      );
      res
        .writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        })
        .end(body);
      return true;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    if (upstream.response.body) {
      await pipeline(Readable.from(upstream.response.body), res).catch(() => {});
    } else {
      res.end();
    }
    return true;
  }
  return false;
}

export async function handleProviderAndKitsuneRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  ctx: CreateApiContext,
): Promise<boolean> {
  const {
    config,
    ha,
    kitsune,
    serviceCatalog,
    backups,
    providers,
    nativeSources,
    nativeEntities,
    nativeMigration,
    applyProviders,
    getRegistry,
  } = ctx;
  if (kitsune && path.startsWith('/api/kitsune')) {
    if (req.method === 'GET' && path === '/api/kitsune/catalog') {
      json(res, 200, { vendors: kitsune.hub.catalog() });
      return true;
    }
    const match = /^\/api\/kitsune\/([a-z][a-z0-9-]*)\/(enable|create|settings|onboard)$/.exec(
      path,
    );
    if (match && req.method === 'POST') {
      const input = (await requestBody(req)) as Record<string, unknown>;
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('invalid_kitsune_operation');
      const vendor = match[1]!;
      if (match[2] === 'onboard') {
        if (
          Object.keys(input).join(',') !== 'fields' ||
          !input.fields ||
          typeof input.fields !== 'object' ||
          Array.isArray(input.fields) ||
          Object.values(input.fields as Record<string, unknown>).some(
            (value) => typeof value !== 'string',
          )
        )
          throw Error('invalid_kitsune_operation');
        const result = await kitsune.onboard(vendor, input.fields);
        const route = kitsune.hub
          .catalog()
          .find((item: { id: string; route?: { package: string } }) => item.id === vendor)?.route;
        if (!serviceCatalog) throw Error('service_catalog_unavailable');
        const plugin = route ? kitsune.hub.plugins.get(route.package) : undefined;
        await serviceCatalog.savePlugin(vendor, plugin?.plugin.version ?? null);
        backups?.markChanged();
        json(res, 200, { created: result });
        return true;
      }
      if (match[2] === 'create') {
        if (
          Object.keys(input).join(',') !== 'settings' ||
          !input.settings ||
          typeof input.settings !== 'object' ||
          Array.isArray(input.settings)
        )
          throw Error('invalid_kitsune_operation');
        const result = await kitsune.create(vendor, input.settings);
        if (!serviceCatalog) throw Error('service_catalog_unavailable');
        const route = kitsune.hub
          .catalog()
          .find((item: { id: string; route?: { package: string } }) => item.id === vendor)?.route;
        const plugin = route ? kitsune.hub.plugins.get(route.package) : undefined;
        await serviceCatalog.savePlugin(vendor, plugin?.plugin.version ?? null);
        backups?.markChanged();
        json(res, 200, { created: result });
        return true;
      }
      if (Object.keys(input).length) throw Error('invalid_kitsune_operation');
      const result = await kitsune.enable(vendor);
      if (!serviceCatalog) throw Error('service_catalog_unavailable');
      await serviceCatalog.savePlugin(vendor, result.version ?? null);
      if (match[2] === 'settings' && result.driver === 'npm') {
        const preset = kitsune.hub
          .catalog()
          .find((item: { id: string; route: { package: string } }) => item.id === vendor);
        const runtime = preset ? kitsune.hub.plugins.get(preset.route.package) : undefined;
        json(res, 200, { settings: await runtime!.call('getCreateDeviceSettings') });
        return true;
      }
      backups?.markChanged();
      json(res, 200, result);
      return true;
    }
    json(res, 400, { error: 'invalid_kitsune_operation' });
    return true;
  }
  if (providers && nativeSources && path.startsWith('/api/providers')) {
    if (req.method === 'GET' && path === '/api/providers') {
      json(res, 200, { providers: providers.list() });
      return true;
    }
    if (req.method === 'GET' && path === '/api/providers/handover') {
      const registry = await ha!.registry();
      json(res, 200, {
        bridges: providers.list().map((provider: { id: string }) => ({
          ...nativeEntities!.handoverStatus(
            provider.id,
            registry,
            nativeMigration?.ignoredLegacy(provider.id, registry),
          ),
          migration: nativeMigration?.status(provider.id),
        })),
      });
      return true;
    }
    const input =
      req.method === 'POST' ? ((await requestBody(req)) as Record<string, unknown>) : null;
    if (req.method === 'POST' && (!input || typeof input !== 'object' || Array.isArray(input)))
      throw Error('invalid_native_provider_operation');
    const migration =
      /^\/api\/providers\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/migration(?:\/(review|apply|undo))?$/.exec(
        path,
      );
    if (migration && nativeMigration) {
      if (req.method === 'GET' && !migration[2]) {
        json(res, 200, nativeMigration.status(migration[1]!));
        return true;
      }
      if (req.method === 'POST' && migration[2] === 'review' && !Object.keys(input!).length) {
        json(res, 200, await nativeMigration.review(migration[1]!));
        return true;
      }
      if (req.method === 'POST' && ['apply', 'undo'].includes(migration[2] ?? '')) {
        json(res, 202, nativeMigration.start(migration[1]!, input!, migration[2] === 'undo'));
        return true;
      }
      json(res, 400, { error: 'invalid_native_migration' });
      return true;
    }
    if (
      req.method === 'POST' &&
      path === '/api/providers/discover' &&
      Object.keys(input!).length === 0
    ) {
      let discovery = ctx.getProviderDiscovery();
      if (!discovery) {
        discovery = discoverProviderBridges(config).finally(() => {
          ctx.setProviderDiscovery(undefined);
        });
        ctx.setProviderDiscovery(discovery);
      }
      json(res, 200, { providers: await discovery });
      return true;
    }
    if (req.method === 'POST' && path === '/api/providers/enroll') {
      json(res, 201, await providers.add(input!));
      return true;
    }
    if (
      req.method === 'POST' &&
      path === '/api/providers/connect' &&
      Object.keys(input!).join(',') === 'bridgeId' &&
      typeof input!.bridgeId === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input!.bridgeId)
    ) {
      json(
        res,
        201,
        await connectManagedProvider(
          config as Parameters<typeof connectManagedProvider>[0],
          providers as Parameters<typeof connectManagedProvider>[1],
          input!.bridgeId,
        ),
      );
      return true;
    }
    const match =
      /^\/api\/providers\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/(import|remove|handover))?$/.exec(
        path,
      );
    if (match && req.method === 'GET' && !match[2]) {
      json(res, 200, { cameras: nativeSources.preview(match[1]!, getRegistry()) });
      return true;
    }
    if (
      match &&
      req.method === 'POST' &&
      match[2] === 'import' &&
      Object.keys(input!).join(',') === 'cameras'
    ) {
      const cameras = await nativeSources.import(match[1]!, input!.cameras, getRegistry());
      backups?.markChanged();
      await applyProviders?.();
      json(res, 200, { cameras });
      return true;
    }
    if (match && req.method === 'POST' && match[2] === 'remove' && !Object.keys(input!).length) {
      await providers.remove(match[1]!);
      await applyProviders?.();
      json(res, 200, { removed: true });
      return true;
    }
    if (match && req.method === 'POST' && match[2] === 'handover' && !Object.keys(input!).length) {
      const bridgeId = match[1]!;
      const result = await nativeEntities!.transaction(bridgeId, async () => {
        const registry = await ha!.registry();
        const status = nativeEntities!.handoverStatus(
          bridgeId,
          registry,
          nativeMigration?.ignoredLegacy(bridgeId, registry),
        );
        if (!['ready', 'connected'].includes(status.state))
          return {
            error:
              status.state === 'migration_required'
                ? 'native_ha_migration_required'
                : 'native_ha_not_ready',
          };
        await nativeMigration?.beforeHandover(bridgeId);
        await nativeMigration?.handoverStarted(bridgeId);
        const handoverResult = await nativeEntities!.completeHandover(bridgeId);
        await nativeMigration?.handoverFinished(bridgeId);
        return handoverResult;
      });
      json(res, (result as { error?: string }).error ? 409 : 200, result);
      return true;
    }
    json(res, 400, { error: 'invalid_native_provider_operation' });
    return true;
  }
  return false;
}
