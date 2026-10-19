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
    (!read && !(camera && input.method === 'PATCH') && !(record && input.method === 'POST'))
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
    input.method !== 'GET' &&
    (!isRecord(input.data) ||
      Object.keys(input.data).some((key) => !['enabled', 'sensorIds'].includes(key)))
  )
    throw new Error('Invalid camera settings.');
  if (isRecord(input.data)) {
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
  async request(input: unknown) {
    const request = validateHelperRequest(input);
    if (request.path === '/api/availability') return this.availability();
    const response = await this.fetch(request.path, {
      method: request.method,
      ...(request.data ? { body: JSON.stringify(request.data) } : {}),
    });
    const text = await response.text();
    if (text.length > 4000000) throw new Error('Haus returned too much timeline data.');
    const result = JSON.parse(text);
    if (!response.ok)
      throw new Error(
        isRecord(result) && typeof result.error === 'string'
          ? result.error.replaceAll('_', ' ')
          : 'The recordings service is unavailable.',
      );
    return result;
  }
  async media(input: string, range: string | null, signal?: AbortSignal) {
    const url = new URL(input);
    if (
      url.hostname !== 'recordings' ||
      !/^\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/(video|thumbnail)$/.test(url.pathname) ||
      (url.search !== '' && url.search !== '?format=1') ||
      url.hash
    )
      throw new Error('Invalid recording address.');
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error('Invalid recording range.');
    const response = await this.fetch(
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
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  }
  private async fetch(path: string, init: RequestInit = {}, timeout = 120000) {
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
    this.stopTalk();
    this.surface = undefined;
  }
}
