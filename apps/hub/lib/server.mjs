/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { handleControlRoute } from '../dist/control/index.js';
import { handleAuthRoute } from '../dist/auth/index.js';
import { Servers } from "./servers.mjs";
import { liveChannel } from "./playback/channel.mjs";
import { CameraAccessBootstrap } from "./camera/access.mjs";
import { rewritePlaylist } from "./camera/warm.mjs";
import { motionSettings } from "./motion/settings.mjs";
import { homekitSettings } from "./homekit.mjs";
import { HaCameras } from "@haus/ha/node/ha-cameras";
import { discoverProviderBridges } from './provider/discovery.mjs';
import { connectManagedProvider } from './provider/managed.mjs';
import { createTalkback, customTalkback } from "./camera/talkback.mjs";
import { requestBody } from "@haus/hub/http";
import { createServer } from "node:http";
import metadata from "../package.json" with { type: "json" };
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { detectionKind } from "@haus/ha/node/discovery";
import { parseRange } from "./playback/media.mjs";
import { PlaybackPreparation } from "./playback/preparation.mjs";
const web = join(dirname(fileURLToPath(import.meta.url)), "../web");
const publicCamera = (camera) => {
  if (!camera) return undefined;
  const { talkback, nativeSource, nativeTalkback, kitsuneSource, ...visible } = camera;
  return { ...visible, talkbackConfigured: Boolean(talkback) };
};
const safeEqual = (a, b) => {
  const left = Buffer.from(a || ""), right = Buffer.from(b || "");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};
const json = (res, status, value) =>
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(JSON.stringify(value));
export { requestBody } from "@haus/hub/http";
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
    ? new Servers({ config, ha, runtime, store, catalog: serviceCatalog, cluster, backups })
    : null,
}) {
  const talkback = sharedTalkback ?? createTalkback({ config });
  let providerDiscovery;
  const preparation = new PlaybackPreparation(recorder);
  const haCameras = haCatalog && snapshots && cameraSessions ? new HaCameras({ catalog: haCatalog, registry: getRegistry, snapshots, sessions: cameraSessions, onRevoke: (id) => nativeEntities?.revokeClient(id) }) : undefined;
  const cameraAccess =
    cameraSessions && cluster
      ? new CameraAccessBootstrap({ sessions: cameraSessions, cluster, config })
      : undefined;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://haus.invalid");
      const path = url.pathname;
      const address = req.socket.remoteAddress?.replace(/^::ffff:/, "");
      if (authService && path.startsWith("/api/auth/")) {
        const handled = await handleAuthRoute(req, res, path, {
          service: authService,
          readBody: requestBody,
        });
        if (handled) return;
      }
      if (controlService && path.startsWith("/api/control/")) {
        let actorId = config.standalone
          ? (safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`) ? 'local-admin' : undefined)
          : (address === "172.30.32.2" ? (req.headers['x-ingress-user'] || 'ingress-admin') : undefined);
        if (!actorId && authService && req.headers.authorization?.startsWith("Bearer ")) {
          const clientSession = await authService.authenticate(req.headers.authorization.slice(7));
          if (clientSession && (clientSession.clientRole === 'admin' || clientSession.clientRole === 'member')) {
            actorId = clientSession.clientId;
          }
        }
        const handled = await handleControlRoute(req, res, path, {
          service: controlService,
          actorId,
          readBody: requestBody,
        });
        if (handled) return;
      }
      const hook = /^\/api\/kitsune\/hooks\/([a-f0-9]{64})\/([^/]+)\/([^/]*)(?:\/.*)?$/.exec(path);
      if (kitsune && hook && ['GET', 'POST'].includes(req.method)) {
        if (!kitsune.hub.canWebhook(decodeURIComponent(hook[2]), hook[1])) return json(res, 401, { error: 'webhook_authentication_required' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) throw Error('body_too_large'); }
        const headers = Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === 'string'));
        const result = await kitsune.hub.webhook(decodeURIComponent(hook[2]), decodeURIComponent(hook[3]) || undefined, { method: req.method, url: req.url, rootPath: '/api/kitsune/hooks/' + hook[1] + '/' + hook[2] + '/' + hook[3] + '/', headers, body }, hook[1]);
        res.writeHead(result.code, result.headers); res.end(result.body); return;
      }

      if (haCameras && path.startsWith("/ha/")) {
        if (req.method === "POST" && path === "/ha/enroll") return json(res, 200, await haCameras.enroll(await requestBody(req)));
        const clientId = haCameras.authenticate(req);
        if (!clientId) return json(res, 401, { error: "camera_access_required" });
        if (path.startsWith('/ha/native/')) {
          if (!nativeEntities || !haCameras.canManageNative(clientId)) return json(res, 403, { error: 'native_access_required' });
          if (path === '/ha/native/ready' && req.method === 'POST') return json(res, 200, await nativeEntities.acknowledge(clientId, await requestBody(req)));
          if (path === '/ha/native/devices' && req.method === 'GET') return json(res, 200, { devices: nativeEntities.devices() });
          const target = /^\/ha\/native\/(camera\.[a-z0-9_]+)\/([a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127})\/command$/.exec(path);
          if (!target || req.method !== 'POST') return json(res, 404, { error: 'not_found' });
          return json(res, 200, await nativeEntities.command(target[1], target[2], await requestBody(req)));
        }
        if (path === "/ha/revoke" && req.method === "POST") { await requestBody(req); return json(res, 200, await haCameras.revoke(clientId)); }
        if (path === "/ha/cameras" && req.method === "GET") return json(res, 200, { profile: 1, nativeFeatures: { disabledReadiness: true }, cameras: haCameras.cameras() });
        const match = /^\/ha\/cameras\/(camera\.[a-z0-9_]+)\/(snapshot|viewer|candidate|close|lease)$/.exec(path);
        if (!match || (match[2] === "snapshot" ? req.method !== "GET" : req.method !== "POST")) return json(res, 404, { error: "not_found" });
        const result = await haCameras.command(clientId, match[1], match[2], match[2] === "snapshot" ? {} : await requestBody(req));
        if (match[2] === "snapshot") return res.writeHead(200, { "Content-Type": result.mime, "Cache-Control": "no-store", "X-Haus-Snapshot-Captured-At": String(result.at), "X-Haus-Snapshot-Stale": result.stale ? "1" : "0" }).end(result.buffer);
        return json(res, 200, result);
      }
      if (path === "/health" && ["127.0.0.1", "::1"].includes(address))
        return json(res, 200, { status: "ok" });
      const sourceMatch =
        /^\/cluster\/source\/([a-f0-9]{48})\/([a-f0-9]{24}(?:\.(?:m3u8|ts|m4s|mp4|aac|key))?)$/.exec(
          path,
        );
      if (warm && sourceMatch && req.method === "GET") {
        const upstream = await warm.source(sourceMatch[1], sourceMatch[2]);
        if (!upstream.response.ok) {
          await upstream.response.body?.cancel();
          return json(res, 503, { error: "source_unavailable" });
        }
        const mime =
          upstream.response.headers.get("content-type") ??
          "application/octet-stream";
        if (/mpegurl/i.test(mime) || upstream.url.pathname.endsWith(".m3u8")) {
          const text = await upstream.response.text();
          if (text.length > 256000) throw new Error("invalid_playlist");
          const body = rewritePlaylist(
            text,
            upstream.url.href,
            (value) =>
              `/cluster/source/${sourceMatch[1]}/${warm.resource(upstream.entry, value)}`,
          );
          return res
            .writeHead(200, {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store",
            })
            .end(body);
        }
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "no-store",
        });
        await pipeline(upstream.response.body, res).catch(() => {});
        return;
      }
      const bearerToken = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : undefined;
      const authorized = config.standalone
        ? safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`) || Boolean(bearerToken && authService && (await authService.authenticate(bearerToken)))
        : address === "172.30.32.2";
      if (!authorized)
        return json(res, 401, { error: "authentication_required" });
      if (
        path === "/api/camera-access" &&
        req.method === "POST" &&
        cameraAccess
      ) {
        const input = await requestBody(req);
        return json(
          res,
          200,
          await cameraAccess.bootstrap(input.cameraId, input.clientId),
        );
      }
      if (
        !config.standalone &&
        (/^\/api\/(?:providers|kitsune)(?:\/|$)/.test(path) || (req.method !== "GET" &&
        (/^\/api\/(cluster|backups|servers|ha-integration)(?:\/|$)/.test(path) || /^\/api\/cameras\/camera\.[a-z0-9_]+\/homekit(?:\/|$)/.test(path))))
      ) {
        const id = req.headers["x-remote-user-id"];
        let users;
        try {
          users = await ha.request({ type: "config/auth/list" });
        } catch {
          return json(res, 503, {
            error: "administrator_verification_unavailable",
          });
        }
        const user = users.find((user) => user.id === id);
        if (
          !user?.is_active ||
          !(user.is_owner || user.group_ids?.includes("system-admin"))
        )
          return json(res, 403, { error: "administrator_required" });
      }
      if (kitsune && path.startsWith('/api/kitsune')) {
        if (req.method === 'GET' && path === '/api/kitsune/catalog') return json(res, 200, { vendors: kitsune.hub.catalog() });
        const match = /^\/api\/kitsune\/([a-z][a-z0-9-]*)\/(enable|create|settings|onboard)$/.exec(path);
        if (match && req.method === 'POST') {
          const input = await requestBody(req);
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('invalid_kitsune_operation');
          if (match[2] === 'onboard') {
            if (Object.keys(input).join(',') !== 'fields' || !input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields) || Object.values(input.fields).some(value => typeof value !== 'string')) throw Error('invalid_kitsune_operation');
            const result = await kitsune.onboard(match[1], input.fields);
            const route = kitsune.hub.catalog().find(item => item.id === match[1])?.route;
            if (!serviceCatalog) throw Error('service_catalog_unavailable');
            const plugin = route ? kitsune.hub.plugins.get(route.package) : undefined;
            await serviceCatalog.savePlugin(match[1], plugin?.plugin.version ?? null);
            backups?.markChanged(); return json(res, 200, { created: result });
          }
          if (match[2] === 'create') {
            if (Object.keys(input).join(',') !== 'settings' || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) throw Error('invalid_kitsune_operation');
            const result = await kitsune.create(match[1], input.settings);
            if (!serviceCatalog) throw Error('service_catalog_unavailable');
            const route = kitsune.hub.catalog().find(item => item.id === match[1])?.route;
            const plugin = route ? kitsune.hub.plugins.get(route.package) : undefined;
            await serviceCatalog.savePlugin(match[1], plugin?.plugin.version ?? null);
            backups?.markChanged(); return json(res, 200, { created: result });
          }
          if (Object.keys(input).length) throw Error('invalid_kitsune_operation');
          const result = await kitsune.enable(match[1]);
          if (!serviceCatalog) throw Error('service_catalog_unavailable');
          await serviceCatalog.savePlugin(match[1], result.version ?? null);
          if (match[2] === 'settings' && result.driver === 'npm') {
            const preset = kitsune.hub.catalog().find(item => item.id === match[1]);
            const runtime = kitsune.hub.plugins.get(preset.route.package);
            return json(res, 200, { settings: await runtime.call('getCreateDeviceSettings') });
          }
          backups?.markChanged(); return json(res, 200, result);
        }
        return json(res, 400, { error: 'invalid_kitsune_operation' });
      }
      if (providers && nativeSources && path.startsWith('/api/providers')) {
        if (req.method === 'GET' && path === '/api/providers') return json(res, 200, { providers: providers.list() });
        if (req.method === 'GET' && path === '/api/providers/handover') {
          const registry = await ha.registry();
          return json(res, 200, { bridges: providers.list().map((provider) => ({ ...nativeEntities.handoverStatus(provider.id, registry, nativeMigration?.ignoredLegacy(provider.id, registry)), migration: nativeMigration?.status(provider.id) })) });
        }
        const input = req.method === 'POST' ? await requestBody(req) : null;
        if (req.method === 'POST' && (!input || typeof input !== 'object' || Array.isArray(input))) throw Error('invalid_native_provider_operation');
        const migration = /^\/api\/providers\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/migration(?:\/(review|apply|undo))?$/.exec(path);
        if (migration && nativeMigration) {
          if (req.method === 'GET' && !migration[2]) return json(res, 200, nativeMigration.status(migration[1]));
          if (req.method === 'POST' && migration[2] === 'review' && !Object.keys(input).length) return json(res, 200, await nativeMigration.review(migration[1]));
          if (req.method === 'POST' && ['apply', 'undo'].includes(migration[2])) return json(res, 202, nativeMigration.start(migration[1], input, migration[2] === 'undo'));
          return json(res, 400, { error: 'invalid_native_migration' });
        }
        if (req.method === 'POST' && path === '/api/providers/discover' && Object.keys(input).length === 0) {
          providerDiscovery ??= discoverProviderBridges(config).finally(() => { providerDiscovery = undefined; });
          return json(res, 200, { providers: await providerDiscovery });
        }
        if (req.method === 'POST' && path === '/api/providers/enroll') return json(res, 201, await providers.add(input));
        if (req.method === 'POST' && path === '/api/providers/connect' && Object.keys(input).join(',') === 'bridgeId' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.bridgeId))
          return json(res, 201, await connectManagedProvider(config, providers, input.bridgeId));
        const match = /^\/api\/providers\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/(import|remove|handover))?$/.exec(path);
        if (match && req.method === 'GET' && !match[2]) return json(res, 200, { cameras: nativeSources.preview(match[1], getRegistry()) });
        if (match && req.method === 'POST' && match[2] === 'import' && Object.keys(input).join(',') === 'cameras') {
          const cameras = await nativeSources.import(match[1], input.cameras, getRegistry());
          backups?.markChanged();
          await applyProviders();
          return json(res, 200, { cameras });
        }
        if (match && req.method === 'POST' && match[2] === 'remove' && !Object.keys(input).length) {
          await providers.remove(match[1]); await applyProviders(); return json(res, 200, { removed: true });
        }
        if (match && req.method === 'POST' && match[2] === 'handover' && !Object.keys(input).length) {
          const result = await nativeEntities.transaction(match[1], async () => {
            const registry = await ha.registry();
            const status = nativeEntities.handoverStatus(match[1], registry, nativeMigration?.ignoredLegacy(match[1], registry));
            if (!['ready', 'connected'].includes(status.state)) return { error: status.state === 'migration_required' ? 'native_ha_migration_required' : 'native_ha_not_ready' };
            await nativeMigration?.beforeHandover(match[1]);
            await nativeMigration?.handoverStarted(match[1]);
            const result = await nativeEntities.completeHandover(match[1]);
            await nativeMigration?.handoverFinished(match[1]);
            return result;
          });
          return json(res, result.error ? 409 : 200, result);
        }
        return json(res, 400, { error: 'invalid_native_provider_operation' });
      }
      if (
        req.method === "GET" &&
        ["/", "/index.html", "/app.js", "/style.css", "/icon.png"].includes(
          path,
        )
      ) {
        const filename = path === "/" ? "index.html" : path.slice(1);
        const type = {
          html: "text/html",
          js: "text/javascript",
          css: "text/css",
          png: "image/png",
        }[filename.split(".").at(-1)];
        const bytes = await readFile(join(web, filename));
        res
          .writeHead(200, {
            "Content-Type": `${type}; charset=utf-8`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-cache",
          })
          .end(bytes);
        return;
      }
      if (shared && path === "/api/preferences") {
        if (req.method === "GET") return json(res, 200, await shared.get());
        if (req.method === "PATCH") {
          const input = await requestBody(req);
          const result = await shared.patch(input.baseRevision, input.patch);
          return json(res, result.conflict ? 409 : 200, result);
        }
      }
      if (servers && path === "/api/servers" && req.method === "GET")
        return json(res, 200, await servers.status());
      if (
        servers &&
        path === "/api/servers/home-assistant" &&
        req.method === "PATCH"
      ) {
        await servers.update(await requestBody(req));
        return json(res, 200, await servers.status());
      }
      if (cluster && path === "/api/cluster" && req.method === "GET")
        return json(res, 200, cluster.status());
      if (cluster && path === "/api/cluster/nodes" && req.method === "POST")
        return json(res, 201, await cluster.add(await requestBody(req)));
      const nodeMatch =
        /^\/api\/cluster\/nodes\/([a-f0-9-]{36})(\/remove)?$/.exec(path);
      if (cluster && nodeMatch && ["POST", "PATCH"].includes(req.method)) {
        const input = await requestBody(req);
        if ((nodeMatch[2] && req.method === "POST") || input.enabled === false)
          await cameraSessions?.clearContinuityNode?.(nodeMatch[1]);
        return json(
          res,
          200,
          await (nodeMatch[2] && req.method === "POST"
            ? cluster.remove(nodeMatch[1])
            : cluster.update(nodeMatch[1], input)),
        );
      }
      if (backups && path === "/api/backups" && req.method === "GET")
        return json(res, 200, {
          items: backups.list(),
          busy: backups.busy,
          error: backups.error,
        });
      if (
        backups &&
        path === "/api/backups/recovery" &&
        req.method === "POST"
      ) {
        await requestBody(req);
        return json(res, 200, {
          ...backups.recoveryKit(),
          nodes: cluster?.nodes() ?? [],
        });
      }
      if (backups && path === "/api/backups/create" && req.method === "POST") {
        const input = await requestBody(req);
        if (!["haus", "ha"].includes(input.kind))
          throw new Error("invalid_backup_kind");
        if (
          backups.canSnapshot ? !backups.canSnapshot(input.kind) : backups.busy
        )
          return json(res, 409, { error: "backup_busy" });
        if (input.kind === "ha" && config.standalone)
          return json(res, 409, { error: "supervisor_backups_unavailable" });
        void backups
          .snapshot(input.kind)
          .then(() => cluster?.tick())
          .catch(() => {});
        return json(res, 202, { started: true });
      }
      if (req.method === "GET" && path === "/api/status")
        return json(res, 200, {
          protocol: 1,
          name: "Haus",
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
            maxBytes:
              config.max_storage_gb > 0
                ? config.max_storage_gb * 1024 ** 3
                : null,
            retentionDays: config.retention_days,
          },
          buffers: recorder.status(),
          processing: recorder.processingStatus?.(),
        });
      if (haCameras && path === "/api/ha-integration" && req.method === "POST") return json(res, 200, await haCameras.setup(await requestBody(req)));
      if (req.method === "GET" && path === "/api/cameras")
        return json(res, 200, {
          cameras: await Promise.all(
            getRegistry().cameras.map(async (camera) => ({
              ...publicCamera(camera),
              ...(motion ? { motionStatus: motion.status(camera.id) } : {}),
              ...(activity ? { activity: activity.status(camera.id) } : {}),
              ...(homekit ? { homekit: homekit.status(camera.id) } : {}),
              ...(operating ? { operating: operating.read(camera.id) } : {}),
              talkAvailable: await talkback.available(camera, getRegistry()),
            })),
          ),
        });
      if (req.method === "GET" && path === "/api/detectors")
        return json(res, 200, {
          detectors: getRegistry()
            .states.filter((state) => detectionKind(state))
            .map((state) => ({
              id: state.entity_id,
              name: state.attributes.friendly_name ?? state.entity_id,
              kind: detectionKind(state),
            })),
        });
      if (req.method === "GET" && path === "/api/events/calendar") {
        const requestedId = url.searchParams.get("camera_id");
        if (!/^camera\.[a-z0-9_]+$/.test(requestedId ?? ""))
          throw new Error("invalid_camera");
        const boundaries = (url.searchParams.get("boundaries") ?? "")
          .split(",")
          .map(Number);
        if (
          boundaries.length < 2 ||
          boundaries.length > 32 ||
          boundaries.some(
            (at, index) =>
              !Number.isSafeInteger(at) ||
              at < 0 ||
              (index > 0 &&
                (at <= boundaries[index - 1] ||
                  at - boundaries[index - 1] > 48 * 3600000)),
          )
        )
          throw new Error("invalid_calendar");
        const cameraId =
          getRegistry().cameras.find(
            (item) =>
              item.id === requestedId || item.aliases?.includes(requestedId),
          )?.id ?? requestedId;
        return json(res, 200, {
          days: await store.recordedDays({ cameraId, boundaries }),
        });
      }
      if (req.method === "GET" && path === "/api/events") {
        const cameraId = url.searchParams.get("camera_id") || undefined;
        if (cameraId && !/^camera\.[a-z0-9_]+$/.test(cameraId))
          throw new Error("invalid_camera");
        const number = (key, fallback) => {
          const raw = url.searchParams.get(key);
          const value = raw === null ? fallback : Number(raw);
          if (!Number.isSafeInteger(value) || value < 0)
            throw new Error("invalid_filter");
          return value;
        };
        const kind = url.searchParams.get("kind") || undefined;
        const status = url.searchParams.get("status") || undefined;
        if (
          status &&
          !["ready", "failed", "interrupted", "recording"].includes(status)
        )
          throw new Error("invalid_status");
        if (
          kind &&
          ![
            "motion",
            "person",
            "pet",
            "vehicle",
            "doorbell",
            "manual",
          ].includes(kind)
        )
          throw new Error("invalid_kind");
        const direction = url.searchParams.get("direction") ?? "older";
        if (!["older", "newer"].includes(direction))
          throw new Error("invalid_direction");
        const filters = {
          direction,
          cameraId:
            getRegistry().cameras.find(
              (item) =>
                item.id === cameraId || item.aliases?.includes(cameraId),
            )?.id ?? cameraId,
          from: number("from", 0),
          to: number("to", Date.now() + 60000),
          limit: Math.min(200, Math.max(1, number("limit", 60))),
          cursor: url.searchParams.get("cursor") || undefined,
          kind,
          status,
        };
        return json(res, 200, {
          ...(await store.list(filters)),
          availability: await store.availability(filters),
        });
      }
      const cameraMatch =
        /^\/api\/cameras\/(camera\.[a-z0-9_]+)(?:\/(record|snapshot|talk|warm|operating|viewer(?:\/close)?|homekit(?:\/(?:pair|close|reset))?))?$/.exec(
          path,
        );
      if (cameraMatch) {
        const requestedId = cameraMatch[1];
        const camera = getRegistry().cameras.find(
          (item) =>
            item.id === requestedId || item.aliases?.includes(requestedId),
        );
        const id = camera?.id;
        if (!camera) return json(res, 404, { error: "camera_not_found" });
        if (operating && req.method === 'POST' && cameraMatch[2] === 'operating') {
          const input = await requestBody(req);
          if (
            Object.keys(input).sort().join(',') !== 'control,entityId,value' ||
            !['indicator', 'nightVision'].includes(input.control) ||
            typeof input.entityId !== 'string' ||
            typeof input.value !== 'boolean'
          )
            throw Error('invalid_camera_control');
          await operating.write(id, input.control, input.entityId, input.value);
          return json(res, 200, { accepted: true });
        }
        if (homekit && req.method === "POST" && cameraMatch[2]?.startsWith("homekit")) {
          const input = await requestBody(req);
          if (cameraMatch[2] === "homekit/pair") {
            if (Object.keys(input).length) throw Error("invalid_homekit_pairing");
            return json(res, 200, await homekit.pairing(id));
          }
          if (cameraMatch[2] === 'homekit/close' || cameraMatch[2] === 'homekit/reset') {
            if (Object.keys(input).length) throw Error('invalid_homekit_pairing');
            const action = cameraMatch[2] === 'homekit/close' ? 'close' : 'reset';
            const status = await homekit.managePairing(id, action);
            if (action === 'reset') backups?.markChanged();
            return json(res, 200, status);
          }
          const settings = homekitSettings(input);
          if (!["auto", "home"].includes(settings.processor) && !cluster?.nodes().some((node) => node.id === settings.processor && node.roles.includes("stream"))) throw Error("invalid_homekit_processor");
          const overrides = await store.overrides();
          await store.setCamera(id, { ...(overrides[id] ?? {}), homekit: settings });
          backups?.markChanged();
          await homekit.tick();
          return json(res, 200, homekit.status(id));
        }
        if (
          cameraSessions &&
          req.method === "POST" &&
          cameraMatch[2]?.startsWith("viewer")
        ) {
          const input = await requestBody(req);
          return json(
            res,
            200,
            cameraMatch[2] === "viewer/close"
              ? await cameraSessions.closeViewer(
                  id,
                  input.owner,
                  input.viewerId,
                )
              : await cameraSessions.viewer(
                  camera,
                  input.owner,
                  input.viewerId,
                  input.offer,
                ),
          );
        }
        if (warm && req.method === "POST" && cameraMatch[2] === "warm") {
          const input = await requestBody(req);
          if (typeof input.active !== "boolean")
            throw new Error("invalid_warm_session");
          return json(
            res,
            200,
            await warm.touch(
              camera,
              input.owner,
              input.active,
              input.preview === true,
            ),
          );
        }
        if (req.method === "POST" && cameraMatch[2] === "talk")
          return await talkback.stream(camera, getRegistry(), req, res);
        if (req.method === "GET" && cameraMatch[2] === "snapshot") {
          if (!snapshots) throw Error("snapshot_unavailable");
          const image = await snapshots.snapshot(camera);
          return res
            .writeHead(200, {
              "Content-Type": image.mime,
              "Cache-Control": "no-store",
              "X-Haus-Snapshot-Stale": image.stale ? "1" : "0",
              "X-Haus-Snapshot-Captured-At": String(image.at),
            })
            .end(image.buffer);
        }
        if (req.method === "POST" && cameraMatch[2] === "record") {
          await requestBody(req);
          return json(res, 201, await recorder.trigger(id));
        }
        if (req.method === "PATCH" && !cameraMatch[2]) {
          const body = await requestBody(req);
          const overrides = await store.overrides();
          const old = overrides[id] ?? {};
          const next = { ...old };
          if (body.talkback !== undefined)
            next.talkback = customTalkback(body.talkback, getRegistry());
          if (body.motionDetection !== undefined)
            next.motionDetection = motionSettings(body.motionDetection);
          if (body.enabled !== undefined) {
            if (typeof body.enabled !== "boolean")
              throw new Error("invalid_enabled");
            next.enabled = body.enabled;
          }
          if (body.sensorIds !== undefined) {
            if (body.sensorIds === null) delete next.sensorIds;
            else {
              if (
                !Array.isArray(body.sensorIds) ||
                body.sensorIds.length > 64 ||
                body.sensorIds.some(
                  (sensor) =>
                    !getRegistry().states.some(
                      (state) =>
                        state.entity_id === sensor && detectionKind(state),
                    ),
                )
              )
                throw new Error("invalid_detectors");
              next.sensorIds = [...new Set(body.sensorIds)];
            }
          }
          await store.setCamera(id, next);
          backups?.markChanged();
          await refresh();
          await cameraAccess?.reconcile();
          await cameraSessions?.syncContinuity?.(true);
          return json(res, 200, {
            camera: publicCamera(
              getRegistry().cameras.find((item) => item.id === id),
            ),
          });
        }
      }
      const liveMatch =
        /^\/api\/cameras\/(camera\.[a-z0-9_]+)\/live\/(index\.m3u8|segment-\d+\.ts)$/.exec(
          path,
        );
      if (warm && liveMatch && req.method === "GET") {
        const entry = warm.entries.get(liveMatch[1]);
        if (!entry?.job) return json(res, 404, { error: "stream_not_ready" });
        const response = await (
          await import("@haus/servers")
        ).nodeRequest(
          entry.job.node,
          `/v1/streams/${entry.job.id}/${liveMatch[2]}`,
          { timeout: 15000 },
        );
        if (!response.ok) {
          await response.body?.cancel();
          return json(res, 503, { error: "stream_unavailable" });
        }
        const mime = liveMatch[2].endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t";
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "no-store",
        });
        await pipeline(response.body, res).catch(() => {});
        return;
      }
      const eventMatch =
        /^\/api\/events\/([a-f0-9-]{36})(?:\/(video|thumbnail|prepare|prepare-next|source|original|repair))?$/.exec(
          path,
        );
      if (
        eventMatch &&
        ((["GET", "HEAD"].includes(req.method) && eventMatch[2] !== "repair") ||
          (req.method === "POST" && eventMatch[2] === "repair"))
      ) {
        const requestAbort = new AbortController();
        const signal = cluster?.abort?.signal
          ? AbortSignal.any([requestAbort.signal, cluster.abort.signal])
          : requestAbort.signal;
        const closeRequest = () => requestAbort.abort();
        const abortResponse = () => res.destroy();
        res.once("close", closeRequest);
        signal.addEventListener("abort", abortResponse, { once: true });
        let releaseEvent;
        try {
          releaseEvent = await store.pinMedia(eventMatch[1], signal);
          const event = await store.get(eventMatch[1]);
          if (!event) return json(res, 404, { error: "event_not_found" });
          if (!eventMatch[2]) return json(res, 200, event);
          if (event.status !== "ready")
            return json(res, 409, { error: "video_not_ready" });
          if (eventMatch[2] === "source")
            return json(res, 200, {
              source: (await cluster?.source(event)) ?? null,
            });
          if (["prepare", "prepare-next", "repair"].includes(eventMatch[2])) {
            if (eventMatch[2] === "repair") {
              const body = await requestBody(req);
              if (
                !body ||
                typeof body !== "object" ||
                Array.isArray(body) ||
                Object.keys(body).length
              )
                throw new Error("invalid_repair_request");
            }
            const options = {
              forceCompatibility:
                eventMatch[2] === "repair" ||
                req.headers["x-haus-compatibility-repair"] === "1",
            };
            if (
              eventMatch[2] === "repair" ||
              req.headers["x-haus-async-prepare"] === "1"
            ) {
              const state = preparation.status(
                event,
                eventMatch[2] === "prepare-next" ? 0 : 20,
                options,
              );
              if (state === "preparing")
                return json(res, 202, { status: state, retryAfterMs: 1000 });
              if (state !== "ready")
                return json(res, 503, { error: "preparation_failed" });
              return json(res, 200, await store.get(event.id));
            }
            await recorder.preparePlayback(
              event,
              eventMatch[2] === "prepare-next" ? 0 : 20,
              options,
            );
            return json(res, 200, await store.get(event.id));
          }
          const original = eventMatch[2] === "original";
          const variant =
            original || !event.playbackBytes ? "original" : "prepared";
          const local =
            variant === "original" ? event.localOriginal : event.localPlayback;
          const knownArchive =
            (original || eventMatch[2] === "video") &&
            local &&
            (await store.archive.hasVerifiedLocation(
              event.id,
              variant,
              variant === "prepared" ? event.playbackVersion : 0,
            ));
          const missingLocal =
            knownArchive &&
            (await stat(
              store.path(
                event.id,
                variant === "prepared" ? "playback.mp4" : "mp4",
              ),
            ).then(
              () => false,
              (error) => error.code === "ENOENT",
            ));
          if (missingLocal) await store.setLocal(event.id, variant, false);
          if (
            (original || eventMatch[2] === "video") &&
            (!local || missingLocal) &&
            cluster?.archiveMedia
          ) {
            const archived = await cluster.archiveMedia(
              event,
              variant,
              req.headers.range,
              signal,
              req.method,
            );
            if (!archived)
              return json(res, 503, { error: "archived_media_unavailable" });
            try {
              const remote = archived.response;
              const headers = {
                "Content-Type": "video/mp4",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=3600",
              };
              for (const key of [
                "content-length",
                "content-range",
                "accept-ranges",
              ])
                if (remote.headers.get(key))
                  headers[key] = remote.headers.get(key);
              res.writeHead(remote.status, headers);
              if (req.method === "HEAD") {
                await remote.body?.cancel();
                res.end();
              } else {
                res.flushHeaders();
                await pipeline(remote.body, res).catch(() => {});
              }
              return;
            } finally {
              archived.release();
            }
          }
          const type = original || eventMatch[2] === "video" ? "mp4" : "jpg";
          const file =
            type === "mp4" && !original && recorder.preparePlayback
              ? await recorder.preparePlayback(event)
              : store.path(event.id, type);
          if (type === "mp4" && !original && cluster && req.method === "GET") {
            const remote = await cluster.media(
              await store.get(event.id),
              req.headers.range,
              signal,
            );
            if (remote) {
              const headers = {
                "Content-Type": "video/mp4",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, max-age=3600",
              };
              for (const key of [
                "content-length",
                "content-range",
                "accept-ranges",
              ])
                if (remote.headers.get(key))
                  headers[key] = remote.headers.get(key);
              res.writeHead(remote.status, headers);
              await pipeline(remote.body, res).catch(() => {});
              return;
            }
          }
          let info;
          try {
            info = await stat(file);
          } catch {
            return json(res, 404, { error: "media_not_found" });
          }
          let range;
          try {
            range = parseRange(req.headers.range, info.size);
          } catch {
            return res
              .writeHead(416, { "Content-Range": `bytes */${info.size}` })
              .end();
          }
          const headers = {
            "Content-Type": type === "mp4" ? "video/mp4" : "image/jpeg",
            "Content-Length": range.end - range.start + 1,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          };
          if (range.partial)
            headers["Content-Range"] =
              `bytes ${range.start}-${range.end}/${info.size}`;
          res.writeHead(range.partial ? 206 : 200, headers);
          if (req.method === "HEAD") return res.end();
          await pipeline(
            createReadStream(file, { start: range.start, end: range.end }),
            res,
          ).catch(() => {});
          return;
        } finally {
          releaseEvent?.();
          res.off("close", closeRequest);
          signal.removeEventListener("abort", abortResponse);
        }
      }
      json(res, 404, { error: "not_found" });
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      const message = String(error.message);
      if (/^kitsune_(?:setting_requires_review|missing_field)(?::[a-zA-Z]+)?$/.test(message))
        return json(res, 409, { error: message.split(':')[0] });
      if (['kitsune_unknown_vendor', 'kitsune_native_onboarding_required'].includes(message))
        return json(res, 400, { error: message });
      if (['kitsune_plugin_capacity', 'kitsune_capability_unavailable', 'camera_control_busy', 'camera_control_unconfirmed', 'camera_control_unavailable', 'recording_storage_limit'].includes(message))
        return json(res, 409, { error: message });
      if (message === "archived_original_required_for_repair")
        return json(res, 503, { error: message });
      const client = /^(invalid_|json_required|body_too_large|recording_disabled)/.test(message);
      json(res, client ? 400 : 503, {
        error: client ? message : "service_temporarily_unavailable",
      });
    }
  });
  const live = liveChannel(server, {
    authorize: (req) =>
      config.standalone
        ? safeEqual(req.headers.authorization, `Bearer ${config.apiToken}`)
        : req.socket.remoteAddress?.replace(/^::ffff:/, "") === "172.30.32.2",
    shared,
    ha,
    sources: () => cameraSessions?.sourceHealth?.() ?? [],
  });
  server.on("request", (req, res) => {
    if (
      (req.method === "PATCH" && /^\/api\/cameras\/camera\.[a-z0-9_]+$/.test(req.url ?? "")) ||
      (req.method === "POST" && /^\/api\/cameras\/camera\.[a-z0-9_]+\/(?:operating|homekit(?:\/(?:pair|close|reset))?)$/.test(req.url ?? ""))
    )
      res.once("finish", () => {
        if (res.statusCode < 300) live.publish("cameras");
      });
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  const accessPolicy =
    cameraAccess && setInterval(() => void cameraAccess.reconcile(), 15000);
  server.on("close", () => {
    talkback.stopAll();
    void haCameras?.stop();
    preparation.clear();
    clearInterval(accessPolicy);
    servers?.telemetry?.stop();
    void servers?.storageUsage?.stop();
  });
  return server;
}
