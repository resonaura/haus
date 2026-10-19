import { randomUUID } from 'node:crypto';
import { validateServiceOperation, recordingSource } from './helper-service-validation';
import { PassThrough, Readable } from 'node:stream';
import type { HomeAssistantConnection } from './connection';
import { isRecord } from './validation';
export interface HelperRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  data?: Record<string, unknown>;
}
export function validateHelperRequest(input: unknown): HelperRequest {
  if (
    !isRecord(input) ||
    !['GET', 'POST', 'PATCH'].includes(String(input.method)) ||
    typeof input.path !== 'string' ||
    input.path.length > 2048 ||
    JSON.stringify(input).length > 65536 ||
    !input.path.startsWith('/api/') ||
    input.path.includes('\\')
  )
    throw new Error('Invalid Haus service request.');
  const url = new URL(input.path, 'http://haus.invalid');
  const service = validateServiceOperation(input.method, url.pathname, input.data);
  const camera = /^\/api\/cameras\/camera\.[a-z0-9_]+$/.test(url.pathname);
  const record = /^\/api\/cameras\/camera\.[a-z0-9_]+\/record$/.test(url.pathname);
  const read =
    input.method === 'GET' &&
    ['/api/availability', '/api/status', '/api/cameras', '/api/detectors', '/api/events'].includes(
      url.pathname,
    );
  if (
    url.origin !== 'http://haus.invalid' ||
    url.hash ||
    (!read &&
      !service &&
      !(
        input.method === 'GET' &&
        /^\/api\/events\/[a-f0-9-]{36}\/(prepare|prepare-next)$/.test(url.pathname)
      ) &&
      !(camera && input.method === 'PATCH') &&
      !(record && input.method === 'POST'))
  )
    throw new Error('This Haus service operation is unavailable.');
  if (url.pathname !== '/api/events' && url.search) throw new Error('Invalid Haus service query.');
  for (const [key, value] of url.searchParams) {
    if (!['camera_id', 'from', 'to', 'cursor', 'limit', 'kind'].includes(key) || value.length > 512)
      throw new Error('Invalid timeline filter.');
  }
  if (input.method === 'GET' && input.data !== undefined)
    throw new Error('Unexpected Haus service form.');
  if (
    !service &&
    input.method !== 'GET' &&
    (!isRecord(input.data) ||
      Object.keys(input.data).some((key) => !['enabled', 'sensorIds'].includes(key)))
  )
    throw new Error('Invalid camera settings.');
  if (!service && isRecord(input.data)) {
    if (input.data.enabled !== undefined && typeof input.data.enabled !== 'boolean')
      throw new Error('Invalid camera recording state.');
    if (
      input.data.sensorIds !== undefined &&
      input.data.sensorIds !== null &&
      (!Array.isArray(input.data.sensorIds) ||
        input.data.sensorIds.length > 64 ||
        input.data.sensorIds.some(
          (id) => typeof id !== 'string' || !/^(binary_sensor|event)\.[a-z0-9_]+$/.test(id),
        ))
    )
      throw new Error('Invalid camera detectors.');
    if (record && Object.keys(input.data).length)
      throw new Error('Unexpected recording parameters.');
  }
  return {
    method: input.method as HelperRequest['method'],
    path: url.pathname + url.search,
    ...(input.data === undefined ? {} : { data: input.data as Record<string, unknown> }),
  };
}
export class HausHelper {
  private mediaSources = new Map<string, { url: string; expiresAt: number }>();
  private mediaSourceSupported = true;
  private epoch = 0;
  private warmOwner = randomUUID();
  private warmCameras = new Set<string>();
  private connectionAbort = new AbortController();
  private talk?: {
    body: PassThrough;
    abort: AbortController;
    timer: ReturnType<typeof setTimeout>;
  };
  async startTalk(cameraId: unknown) {
    if (typeof cameraId !== 'string' || !/^camera\.[a-z0-9_]+$/.test(cameraId))
      throw new Error('Invalid camera.');
    this.stopTalk();
    const body = new PassThrough({ highWaterMark: 256000 });
    const abort = new AbortController();
    const timer = setTimeout(() => this.stopTalk(), 55000);
    this.talk = { body, abort, timer };
    try {
      const response = await this.fetch(
        `/api/cameras/${cameraId}/talk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'audio/webm;codecs=opus' },
          body: Readable.toWeb(body) as ReadableStream,
          duplex: 'half',
          signal: abort.signal,
        } as RequestInit & { duplex: string },
        65000,
      );
      if (!response.ok)
        throw new Error('This camera could not start talkback. It may already be in use.');
      void response
        .arrayBuffer()
        .finally(() => {
          if (this.talk?.body === body) this.stopTalk();
        })
        .catch(() => {});
    } catch (error) {
      if (this.talk?.body === body) this.stopTalk();
      throw error;
    }
  }
  writeTalk(input: unknown) {
    if (!(input instanceof Uint8Array) || input.byteLength > 128000 || !this.talk)
      throw new Error('The microphone session is not active.');
    if (this.talk.body.writableLength > 256000) {
      this.stopTalk();
      throw new Error('The talkback connection is too slow.');
    }
    this.talk.body.write(input);
  }
  stopTalk() {
    const talk = this.talk;
    this.talk = undefined;
    if (!talk) return;
    clearTimeout(talk.timer);
    talk.body.end();
    talk.abort.abort();
    talk.body.destroy();
  }
  private surface?: { url: string; cookie?: string; expiresAt: number };
  constructor(private connection: HomeAssistantConnection) {}
  async availability() {
    const result = await this.connection.request<{
      addons: Array<{ slug: string; name: string; state: string }>;
    }>({ type: 'supervisor/api', endpoint: '/addons', method: 'get' });
    const addon = result.addons?.find((item) => /^(?:[a-z0-9]+_)?haus-helper$/.test(item.slug));
    return addon ? { installed: true, slug: addon.slug, state: addon.state } : { installed: false };
  }
  request(input: unknown) {
    return this.performRequest(input, false);
  }
  recoveryKit() {
    return this.performRequest({ method: 'POST', path: '/api/backups/recovery', data: {} }, true);
  }
  contextVersion() {
    return this.epoch;
  }
  private async performRequest(input: unknown, allowRecovery: boolean) {
    const epoch = this.epoch;
    const request = validateHelperRequest(input);
    if (request.path === '/api/backups/recovery' && !allowRecovery)
      throw new Error('Save the recovery kit through the native export dialog.');
    if (request.method !== 'GET' && /^\/api\/(cluster|backups)(?:\/|$)/.test(request.path)) {
      const user = await this.connection.request<{ is_admin?: boolean }>({
        type: 'auth/current_user',
      });
      if (!user.is_admin)
        throw new Error('An administrator can manage recording nodes and backups.');
    }
    if (epoch !== this.epoch) throw new Error('The connected home changed.');
    if (request.path === '/api/availability') return this.availability();
    const response = await this.fetch(request.path, {
      method: request.method,
      ...(request.data
        ? {
            body: JSON.stringify(
              request.path.endsWith('/warm')
                ? { ...request.data, owner: this.warmOwner }
                : request.data,
            ),
          }
        : {}),
    });
    const text = await response.text();
    if (epoch !== this.epoch) throw new Error('The connected home changed.');
    if (text.length > 4000000) throw new Error('Haus returned too much timeline data.');
    const result = JSON.parse(text);
    if (request.path.endsWith('/warm') && response.ok) {
      const id = request.path.split('/')[3];
      if (request.data?.active) this.warmCameras.add(id);
      else this.warmCameras.delete(id);
    }
    if (response.status === 409 && request.path === '/api/preferences' && isRecord(result))
      return result;
    if (!response.ok)
      throw new Error(
        isRecord(result) && typeof result.error === 'string'
          ? result.error.replaceAll('_', ' ')
          : 'The recordings service is unavailable.',
      );
    return result;
  }
  async media(input: string, range: string | null, signal?: AbortSignal) {
    const epoch = this.epoch;
    const connectionSignal = this.connectionAbort.signal;
    const url = new URL(input);
    if (url.hostname === 'streams') {
      const match = /^\/(camera\.[a-z0-9_]+)\/(index\.m3u8|segment-\d+\.ts)$/.exec(url.pathname);
      if (!match || url.search || url.hash) throw new Error('Invalid live relay address.');
      const response = await this.fetch(
        `/api/cameras/${match[1]}/live/${match[2]}`,
        { signal },
        20000,
      );
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    if (
      url.hostname !== 'recordings' ||
      !/^\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/(video|thumbnail)$/.test(url.pathname) ||
      (url.search !== '' && url.search !== '?format=1') ||
      url.hash
    )
      throw new Error('Invalid recording address.');
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error('Invalid recording range.');
    let response: Response | undefined;
    const sourceKey = url.pathname.split('/')[1];
    if (url.pathname.endsWith('/video') && this.mediaSourceSupported) {
      try {
        let source = this.mediaSources.get(sourceKey);
        if (!source || source.expiresAt < Date.now() + 15000) {
          const result = await this.fetch(`/api/events/${sourceKey}/source`, { signal }, 10000);
          if (result.status === 404) {
            this.mediaSourceSupported = false;
            await result.body?.cancel();
          } else if (result.ok) {
            const data = (await result.json()) as { source?: unknown };
            source = recordingSource(data.source);
            if (source) {
              if (this.mediaSources.size >= 16)
                this.mediaSources.delete(this.mediaSources.keys().next().value!);
              this.mediaSources.set(sourceKey, source);
            }
          } else await result.body?.cancel();
        }
        if (epoch !== this.epoch) throw new Error('The connected home changed.');
        if (source) {
          response = await fetch(source.url, {
            headers: range ? { Range: range } : {},
            redirect: 'error',
            signal: AbortSignal.any([
              AbortSignal.timeout(600000),
              connectionSignal,
              ...(signal ? [signal] : []),
            ]),
          });
          if (![200, 206, 416].includes(response.status)) {
            await response.body?.cancel();
            response = undefined;
            this.mediaSources.delete(sourceKey);
          }
        }
      } catch {
        response = undefined;
      }
    }
    if (epoch !== this.epoch) throw new Error('The connected home changed.');
    response ??= await this.fetch(
      `/api/events${url.pathname}`,
      {
        headers: range ? { Range: range } : {},
        signal,
      },
      600000,
    );
    const headers = new Headers();
    for (const key of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
    ]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }
    if (url.pathname.endsWith('/video')) headers.set('Content-Type', 'video/mp4');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  }
  private async fetch(path: string, init: RequestInit = {}, timeout = 120000) {
    const epoch = this.epoch;
    let surface = this.surface;
    if (!surface || surface.expiresAt < Date.now()) {
      const availability = await this.availability();
      if (!availability.installed || !availability.slug)
        throw new Error('Install Haus to record camera events.');
      if (availability.state !== 'started') throw new Error('Start Haus to view your recordings.');
      surface = {
        ...(await this.connection.addonSurface(availability.slug)),
        expiresAt: Date.now() + 180000,
      };
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      this.surface = surface;
    }
    const response = await fetch(new URL(path.slice(1), surface.url), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        'X-Haus-Client': '1',
        ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.any([
        AbortSignal.timeout(timeout),
        this.connectionAbort.signal,
        ...(init.signal ? [init.signal] : []),
      ]),
    });
    if ([401, 403].includes(response.status)) {
      this.surface = undefined;
      await response.body?.cancel();
      throw new Error('Your recording session needs to reconnect.');
    }
    return response;
  }
  clear() {
    const surface = this.surface,
      owner = this.warmOwner;
    if (surface)
      for (const id of this.warmCameras)
        void fetch(new URL(`api/cameras/${id}/warm`, surface.url), {
          method: 'POST',
          body: JSON.stringify({ active: false, owner }),
          headers: {
            'Content-Type': 'application/json',
            'X-Haus-Client': '1',
            ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
          },
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        })
          .then((response) => response.body?.cancel())
          .catch(() => {});
    this.warmCameras.clear();
    this.warmOwner = randomUUID();
    this.epoch++;
    this.connectionAbort.abort();
    this.connectionAbort = new AbortController();
    this.mediaSources.clear();
    this.mediaSourceSupported = true;
    this.stopTalk();
    this.surface = undefined;
  }
}
