import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { SecureStore } from './secure-store';
import { isRecord } from './validation';

interface Route {
  nodeId: string;
  url: string;
  allowHttp: boolean;
  id: string;
  cameraId: string;
  expiresAt: number;
  key: string;
}
interface Bundle {
  cameraId: string;
  requestedId: string;
  expiresAt: number;
  nodes: Route[];
}
const privateIp = (value: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(value) ||
  /^(fc|fd)[a-f0-9:]+$/i.test(value) ||
  value === '::1';
function bundle(value: unknown, camera: string): Bundle | undefined {
  if (
    !isRecord(value) ||
    (value.cameraId !== camera && value.requestedId !== camera) ||
    !/^camera\.[a-z0-9_]+$/.test(String(value.cameraId)) ||
    !Number.isSafeInteger(value.expiresAt) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 8
  )
    return;
  const nodes: Route[] = [];
  for (const node of value.nodes) {
    if (
      !isRecord(node) ||
      node.cameraId !== value.cameraId ||
      typeof node.nodeId !== 'string' ||
      node.nodeId.length > 128 ||
      !/^[a-f0-9]{32}$/.test(String(node.id)) ||
      !/^[a-f0-9]{64}$/.test(String(node.key)) ||
      node.expiresAt !== value.expiresAt ||
      typeof node.allowHttp !== 'boolean' ||
      typeof node.url !== 'string'
    )
      return;
    const url = new URL(node.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== node.url ||
      url.username ||
      url.password ||
      (url.protocol === 'http:' && !node.allowHttp)
    )
      return;
    nodes.push({
      nodeId: node.nodeId,
      cameraId: String(value.cameraId),
      url: url.origin,
      allowHttp: node.allowHttp,
      expiresAt: Number(node.expiresAt),
      id: String(node.id),
      key: String(node.key),
    });
  }
  return {
    cameraId: String(value.cameraId),
    requestedId: camera,
    expiresAt: Number(value.expiresAt),
    nodes,
  };
}

/** Native-only, camera-scoped HMAC routes. No master node key or camera credentials enter the app. */
export class CameraAccessClient {
  private epoch = 0;
  private instance = randomBytes(8).toString('hex');
  private abort = new AbortController();
  private clientId: string = randomUUID();
  private loaded?: Promise<void>;
  private cameras = new Map<string, Bundle>();
  private pending = new Map<string, Promise<void>>();
  private prepareAfter = new Map<string, number>();
  private refreshAfter = new Map<string, number>();
  private invalidated = new Set<string>();
  private pinned = new Map<string, Route>();
  private failed = new Map<string, number>();
  private viewers = new Map<string, { camera: string; viewerId: string }>();
  private wanted = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  constructor(
    private scope: () => string | undefined,
    private store: Pick<SecureStore, 'loadCameraAccess' | 'saveCameraAccess'>,
    private issue: (camera: string, clientId: string) => Promise<unknown>,
    private helperOnline: () => boolean = () => true,
    private observe: (
      scope: string,
      sources: { id: string; available: boolean; expiresAt: number }[],
    ) => void = () => {},
    private cacheScope: () => string | undefined = scope,
  ) {}
  private load() {
    if (this.loaded) return this.loaded;
    const epoch = this.epoch,
      scope = this.cacheScope();
    return (this.loaded = this.store
      .loadCameraAccess()
      .then((value) => {
        if (
          epoch !== this.epoch ||
          !isRecord(value) ||
          value.scope !== scope ||
          scope !== this.cacheScope() ||
          !isRecord(value.cameras)
        )
          return;
        if (typeof value.clientId === 'string' && /^[a-f0-9-]{36}$/.test(value.clientId))
          this.clientId = value.clientId;
        for (const [id, input] of Object.entries(value.cameras).slice(0, 64)) {
          if (!/^camera\.[a-z0-9_]+$/.test(id)) continue;
          try {
            const value = bundle(input, id);
            if (value && value.expiresAt > Date.now()) this.cameras.set(id, value);
          } catch {
            /* Preserve valid independent entries. */
          }
        }
      })
      .catch(() => {}));
  }
  async prepare(camera: string) {
    this.wanted.set(camera, Date.now() + 60000);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 5000);
    const epoch = this.epoch,
      scope = this.scope();
    await this.load();
    if (epoch !== this.epoch || scope !== this.scope()) return;
    if (
      !this.invalidated.has(camera) &&
      (this.refreshAfter.get(camera) ?? 0) > Date.now() &&
      (this.cameras.get(camera)?.expiresAt ?? 0) > Date.now() + 2 * 3600000
    )
      return;
    if ((this.prepareAfter.get(camera) ?? 0) > Date.now()) return;
    if (this.pending.has(camera)) return this.pending.get(camera);
    if (!scope || this.pending.size >= 16) return;
    const task = this.issue(camera, this.clientId)
      .then(async (input) => {
        if (epoch !== this.epoch || scope !== this.scope()) return;
        const value = bundle(input, camera);
        if (
          !value?.nodes.length ||
          value.expiresAt <= Date.now() ||
          value.expiresAt > Date.now() + 86500000
        )
          return;
        this.cameras.set(camera, value);
        this.refreshAfter.set(camera, Date.now() + 300000);
        this.invalidated.delete(camera);
        const storageScope = this.cacheScope();
        if (storageScope)
          await this.store.saveCameraAccess(storageScope, this.clientId, camera, value);
      })
      .catch(() => {
        if (epoch === this.epoch) this.prepareAfter.set(camera, Date.now() + 60000);
      })
      .finally(() => {
        if (this.pending.get(camera) === task) this.pending.delete(camera);
      });
    this.pending.set(camera, task);
    return task;
  }
  async available(camera: string) {
    if (!this.scope() || !this.cacheScope()) return false;
    const epoch = this.epoch;
    await this.load();
    if (epoch !== this.epoch) return false;
    const value = this.cameras.get(camera);
    return Boolean(
      !this.invalidated.has(camera) && value?.nodes.length && value.expiresAt > Date.now(),
    );
  }
  isPinned(camera: string) {
    return this.pinned.has(camera);
  }
  invalidate() {
    for (const id of this.cameras.keys()) this.invalidated.add(id);
    this.prepareAfter.clear();
    this.refreshAfter.clear();
  }
  async resume() {
    const epoch = this.epoch;
    await this.load();
    if (epoch !== this.epoch) return;
    for (const camera of this.cameras.keys()) this.wanted.set(camera, Date.now() + 60000);
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 5000);
    await this.poll();
  }
  async poll() {
    if (this.polling || this.helperOnline() || !this.scope()) return;
    this.polling = true;
    const epoch = this.epoch,
      scope = this.scope()!;
    try {
      await this.load();
      const sources: { id: string; available: boolean; expiresAt: number }[] = [];
      for (const [camera, value] of this.cameras) {
        if (epoch !== this.epoch) return;
        if (
          value.expiresAt <= Date.now() ||
          this.invalidated.has(camera) ||
          ((this.wanted.get(camera) ?? 0) < Date.now() && !this.pinned.has(camera))
        )
          continue;
        let available = false;
        for (const route of value.nodes) {
          if ((this.failed.get(route.nodeId) ?? 0) > Date.now()) continue;
          try {
            const result = await this.fetch(route, 'status', undefined, 1500);
            if (result.cameraId === route.cameraId && result.ready === true) {
              available = true;
              break;
            }
          } catch {
            this.failed.set(route.nodeId, Date.now() + 5000);
          }
        }
        sources.push({ id: camera, available, expiresAt: Date.now() + 10000 });
      }
      if (epoch === this.epoch && scope === this.scope() && sources.length)
        this.observe(scope, sources);
    } finally {
      this.polling = false;
    }
  }
  private async fetch(
    route: Route,
    operation: string,
    data?: Record<string, unknown>,
    timeout = 5000,
    cancellation = this.abort.signal,
    instance = this.instance,
  ) {
    if (route.expiresAt <= Date.now()) throw Error('Camera access expired.');
    const path = `/v1/client/camera/${operation}`,
      method = data ? 'POST' : 'GET';
    const text = data ? JSON.stringify({ ...data, clientSession: instance }) : undefined;
    const digest = createHash('sha256')
        .update(text ?? '')
        .digest('hex'),
      time = String(Date.now()),
      nonce = randomBytes(16).toString('hex');
    const signature = createHmac('sha256', route.key)
      .update([method, path, time, nonce, digest].join('\n'))
      .digest('hex');
    const url = new URL(route.url);
    const headers: Record<string, string> = {
      'x-haus-camera-access': route.id,
      'x-haus-time': time,
      'x-haus-nonce': nonce,
      'x-haus-digest': digest,
      'x-haus-signature': signature,
      'Content-Type': 'application/json',
    };
    if (url.protocol === 'http:') {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
      if (!addresses.length || addresses.some((item) => !privateIp(item.address)))
        throw Error('Camera node must be private.');
      headers.Host = url.host;
      url.hostname = addresses[0].address.includes(':')
        ? `[${addresses[0].address}]`
        : addresses[0].address;
    }
    cancellation.throwIfAborted();
    const response = await fetch(new URL(path, url), {
      method,
      body: text,
      headers,
      redirect: 'error',
      signal: AbortSignal.any([cancellation, AbortSignal.timeout(timeout)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401)
        for (const [id, value] of this.cameras)
          if (value.cameraId === route.cameraId) this.invalidated.add(id);
      throw Error('Independent camera node is unavailable.');
    }
    const bytes = await response.text();
    if (bytes.length > 100000) throw Error('Camera response is too large.');
    return JSON.parse(bytes);
  }
  async request(
    camera: string,
    operation: 'warm' | 'viewer' | 'close',
    data: Record<string, unknown>,
    expectedScope = this.scope(),
  ) {
    const epoch = this.epoch;
    if (!expectedScope || !this.cacheScope()) throw Error('Connect to your home first.');
    if (expectedScope !== this.scope()) throw Error('The connected home changed.');
    await this.load();
    if (epoch !== this.epoch || expectedScope !== this.scope())
      throw Error('The connected home changed.');
    const value = this.cameras.get(camera);
    if (!value || value.expiresAt <= Date.now())
      throw Error('Independent camera access is unavailable.');
    const releasing = operation === 'close' || (operation === 'warm' && data.active === false);
    const routes = value.nodes.filter(
      (route) => releasing || (this.failed.get(route.nodeId) ?? 0) <= Date.now(),
    );
    const pin = this.pinned.get(camera);
    routes.sort((a, b) => Number(b.nodeId === pin?.nodeId) - Number(a.nodeId === pin?.nodeId));
    if (releasing) {
      if (operation === 'close') this.viewers.delete(`${camera}:${data.viewerId}`);
      await Promise.allSettled(routes.map((route) => this.fetch(route, operation, data, 3000)));
      return operation === 'close' ? { closed: true } : { warm: false };
    }
    if (operation === 'viewer' && this.viewers.size >= 32) throw Error('Too many camera viewers.');
    const checks = await Promise.allSettled(
      routes.map(async (route) => ({
        route,
        status: await this.fetch(route, 'status', undefined, 1500),
      })),
    );
    if (epoch !== this.epoch) throw Error('The connected home changed.');
    const eligible = checks.flatMap((result) =>
      result.status === 'fulfilled' &&
      (result.value.status.present === true ||
        result.value.status.ready === true ||
        result.value.status.active < result.value.status.max)
        ? [result.value]
        : [],
    );
    eligible.sort(
      (a, b) =>
        Number(b.route.nodeId === pin?.nodeId) - Number(a.route.nodeId === pin?.nodeId) ||
        Number(b.status.ready) - Number(a.status.ready) ||
        a.status.active / Math.max(1, a.status.max) - b.status.active / Math.max(1, b.status.max),
    );
    for (const { route } of eligible) {
      try {
        const result = await this.fetch(
          route,
          operation,
          data,
          operation === 'viewer' ? 18000 : 5000,
        );
        if (epoch !== this.epoch) throw Error('The connected home changed.');
        this.pinned.set(camera, route);
        this.failed.delete(route.nodeId);
        if (operation === 'viewer')
          this.viewers.set(`${camera}:${data.viewerId}`, {
            camera,
            viewerId: String(data.viewerId),
          });
        return result;
      } catch {
        if (epoch !== this.epoch) throw Error('The connected home changed.');
        this.failed.set(route.nodeId, Date.now() + 5000);
      }
    }
    throw Error('Independent camera nodes are unavailable or busy.');
  }
  clear() {
    const instance = this.instance;
    const cleanup = AbortSignal.timeout(3000);
    for (const viewer of this.viewers.values())
      for (const route of this.cameras.get(viewer.camera)?.nodes ?? [])
        void this.fetch(
          route,
          'close',
          { viewerId: viewer.viewerId },
          3000,
          cleanup,
          instance,
        ).catch(() => {});
    for (const camera of this.pinned.keys())
      for (const route of this.cameras.get(camera)?.nodes ?? [])
        for (const preview of [true, false])
          void this.fetch(route, 'warm', { active: false, preview }, 3000, cleanup, instance).catch(
            () => {},
          );
    this.viewers.clear();
    this.instance = randomBytes(8).toString('hex');
    ++this.epoch;
    this.abort.abort();
    this.abort = new AbortController();
    this.loaded = undefined;
    this.cameras.clear();
    this.pending.clear();
    this.prepareAfter.clear();
    this.refreshAfter.clear();
    this.invalidated.clear();
    this.pinned.clear();
    this.failed.clear();
    this.wanted.clear();
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
