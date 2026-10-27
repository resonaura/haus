import { randomUUID } from 'node:crypto';
import { fetchMedia } from './media-fetch';
import { resilientMediaBody } from './media-body';
import { recordingPreparation } from './recording-preparation';
import { validateServiceOperation, recordingSource } from './helper-service-validation';
import { PassThrough, Readable } from 'node:stream';
import type { HomeAssistantConnection } from './connection';
import { isRecord } from './validation';
import { HelperLive } from './helper-live';
import type { NativeEvent } from '../shared/native';
import type { SecureStore } from './secure-store';
import { CameraAccessClient } from './camera-access-client';
export interface HelperRequest {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  data?: Record<string, unknown>;
}
type HelperSurface = { url: string; cookie?: string; expiresAt: number };
type RecordingPreparationResult = { supported: true; event: unknown } | { supported: false };
class HelperOperationError extends Error {
  constructor(readonly code: string) {
    super(code.replaceAll('_', ' '));
  }
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
    [
      '/api/availability',
      '/api/status',
      '/api/cameras',
      '/api/detectors',
      '/api/events',
      '/api/events/calendar',
    ].includes(url.pathname);
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
  if (!['/api/events', '/api/events/calendar'].includes(url.pathname) && url.search)
    throw new Error('Invalid Haus service query.');
  for (const [key, value] of url.searchParams) {
    if (
      ![
        'camera_id',
        'from',
        'to',
        'cursor',
        'limit',
        'kind',
        'status',
        'direction',
        'boundaries',
      ].includes(key) ||
      value.length > 512
    )
      throw new Error('Invalid timeline filter.');
  }
  if (input.method === 'GET' && input.data !== undefined)
    throw new Error('Unexpected Haus service form.');
  if (
    !service &&
    input.method !== 'GET' &&
    (!isRecord(input.data) ||
      Object.keys(input.data).some(
        (key) => !['enabled', 'sensorIds', 'motionDetection', 'talkback'].includes(key),
      ))
  )
    throw new Error('Invalid camera settings.');
  if (!service && isRecord(input.data)) {
    if (input.data.talkback !== undefined && input.data.talkback !== null) {
      const target = input.data.talkback;
      if (
        !isRecord(target) ||
        Object.keys(target).length !== 1 ||
        !(
          (typeof target.entityId === 'string' &&
            /^(sensor|text|input_text)\.[a-z0-9_]+$/.test(target.entityId)) ||
          (typeof target.url === 'string' &&
            target.url.length <= 2048 &&
            target.url.startsWith('rtmp://'))
        )
      )
        throw new Error('Choose a valid camera microphone source.');
    }
    if (input.data.motionDetection !== undefined) {
      const motion = input.data.motionDetection;
      if (
        !isRecord(motion) ||
        Object.keys(motion).some((key) => !['enabled', 'mode'].includes(key)) ||
        typeof motion.enabled !== 'boolean' ||
        !['objects', 'motion'].includes(String(motion.mode))
      )
        throw new Error('Invalid motion recording settings.');
    }
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
  private preparedRecordings = new Map<string, Promise<RecordingPreparationResult>>();
  private repairingRecordings = new Map<string, Promise<RecordingPreparationResult>>();
  private mediaSources = new Map<string, { url: string; expiresAt: number }>();
  private mediaSourceSupported = true;
  private epoch = 0;
  private previewSupport?: { expiresAt: number; ready: Promise<boolean> };
  private warmOwner = randomUUID();
  private warmCameras = new Map<string, string>();
  private cameraViewers = new Map<
    string,
    { camera: string; viewerId: string; expiresAt: number }
  >();
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
  private surface?: HelperSurface;
  private surfaceRequest?: Promise<HelperSurface>;
  private live?: HelperLive;
  private direct?: CameraAccessClient;
  constructor(
    private connection: HomeAssistantConnection,
    emit?: (event: NativeEvent) => void,
    store?: SecureStore,
  ) {
    if (emit)
      this.live = new HelperLive(
        () => this.getSurface(),
        () => connection.serverUrl,
        (event) => {
          emit(event);
          if (event.type === 'helper-live' && event.topic === 'cameras') this.direct?.invalidate();
          if (event.type === 'helper-live' && !event.online) void this.direct?.poll();
        },
      );
    if (store)
      this.direct = new CameraAccessClient(
        () => connection.serverUrl,
        store,
        async (cameraId, clientId) => {
          const response = await this.fetch(
            '/api/camera-access',
            { method: 'POST', body: JSON.stringify({ cameraId, clientId }) },
            15000,
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw Error('Independent camera access is not available.');
          }
          const text = await response.text();
          if (text.length > 100000) throw Error('Camera access response is too large.');
          return JSON.parse(text);
        },
        () => Boolean(this.live?.connected && connection.connected),
        (scope, sources) =>
          emit?.({
            type: 'helper-live',
            origin: 'nvr',
            scope,
            online: true,
            sources,
            topic: 'home',
          }),
        () => connection.credentialScope,
      );
  }
  resumeCameras() {
    this.live?.start();
    void this.direct?.resume().catch(() => {});
  }
  async availability() {
    const result = await this.connection.request<{
      addons: Array<{ slug: string; name: string; state: string }>;
    }>({ type: 'supervisor/api', endpoint: '/addons', method: 'get' });
    const addon = result.addons?.find((item) => /^(?:[a-z0-9]+_)?haus-helper$/.test(item.slug));
    return addon ? { installed: true, slug: addon.slug, state: addon.state } : { installed: false };
  }
  async request(input: unknown) {
    this.live?.start();
    const request = validateHelperRequest(input),
      epoch = this.epoch,
      scope = this.connection.serverUrl;
    const match = /^\/api\/cameras\/(camera\.[a-z0-9_]+)\/(warm|viewer(?:\/close)?)$/.exec(
      request.path,
    );
    const operation =
      match?.[2] === 'viewer/close' ? 'close' : (match?.[2] as 'warm' | 'viewer' | undefined);
    if (this.direct && match && request.method === 'POST') {
      if (operation === 'viewer' || (operation === 'warm' && request.data?.active === true))
        void this.direct.prepare(match[1]).catch(() => {});
      if (
        (!this.connection.connected || this.direct.isPinned(match[1])) &&
        (await this.direct.available(match[1])) &&
        epoch === this.epoch
      )
        return this.direct.request(match[1], operation!, request.data ?? {}, scope);
    }
    try {
      return await this.performRequest(request, false);
    } catch (error) {
      const permitted =
        !(error instanceof HelperOperationError) ||
        [
          'camera_nvr_required',
          'camera_nvr_session_unavailable',
          'service_temporarily_unavailable',
        ].includes(error.code);
      if (
        permitted &&
        epoch === this.epoch &&
        this.direct &&
        match &&
        request.method === 'POST' &&
        (!this.connection.connected || !this.live?.connected) &&
        (await this.direct.available(match[1]))
      )
        return this.direct.request(match[1], operation!, request.data ?? {}, scope);
      throw error;
    }
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
    if (
      request.method !== 'GET' &&
      /^\/api\/(cluster|backups|servers)(?:\/|$)/.test(request.path)
    ) {
      const user = await this.connection.request<{ is_admin?: boolean }>({
        type: 'auth/current_user',
      });
      if (!user.is_admin)
        throw new Error('An administrator can manage recording nodes and backups.');
    }
    if (epoch !== this.epoch) throw new Error('The connected home changed.');
    if (request.path === '/api/availability') return this.availability();
    if (request.path.endsWith('/warm') && request.data?.preview === true && request.data.active) {
      if (!this.previewSupport || this.previewSupport.expiresAt < Date.now()) {
        this.previewSupport = {
          expiresAt: Date.now() + 60000,
          ready: this.fetch('/api/status')
            .then(async (response) => {
              const status = await response.json();
              return (
                response.ok &&
                isRecord(status) &&
                isRecord(status.features) &&
                status.features.previewPreheat === true
              );
            })
            .catch(() => false),
        };
      }
      if (!(await this.previewSupport.ready)) return { warm: false, reason: 'update_helper' };
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
    }

    const viewer = /^\/api\/cameras\/(camera\.[a-z0-9_]+)\/viewer(\/close)?$/.exec(request.path);
    const viewerKey = viewer ? `${viewer[1]}:${request.data!.viewerId}` : undefined;
    if (viewer && !viewer[2]) {
      for (const [key, entry] of this.cameraViewers)
        if (entry.expiresAt < Date.now()) this.cameraViewers.delete(key);
      if (this.cameraViewers.size >= 128 && !this.cameraViewers.has(viewerKey!))
        throw new Error('Too many camera viewers are reconnecting. Try again shortly.');
      this.cameraViewers.set(viewerKey!, {
        camera: viewer[1],
        viewerId: String(request.data!.viewerId),
        expiresAt: Date.now() + 90000,
      });
    }

    const preparation = /^\/api\/events\/[a-f0-9-]{36}\/(prepare|prepare-next|repair)$/.test(
      request.path,
    );
    const perform = () =>
      this.fetch(
        request.path,
        {
          method: request.method,
          ...(preparation ? { headers: { 'X-Haus-Async-Prepare': '1' } } : {}),
          ...(request.data
            ? {
                body: JSON.stringify(
                  request.path.endsWith('/warm')
                    ? {
                        ...request.data,
                        owner: this.warmOwner + (request.data.preview === true ? '-preview' : ''),
                      }
                    : /\/viewer(?:\/close)?$/.test(request.path)
                      ? { ...request.data, owner: this.warmOwner }
                      : request.data,
                ),
              }
            : {}),
        },
        preparation
          ? 30000
          : request.path.endsWith('/viewer')
            ? 25000
            : request.path.endsWith('/viewer/close')
              ? 8000
              : 120000,
      );
    const repairMatch = /^\/api\/events\/([a-f0-9-]{36})\/repair$/.exec(request.path);
    if (repairMatch) {
      const result = await this.repairRecording(repairMatch[1], perform);
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      return result.supported ? result.event : null;
    }
    const prepareMatch = /^\/api\/events\/([a-f0-9-]{36})\/prepare$/.exec(request.path);
    if (prepareMatch) {
      const result = await this.prepareRecording(prepareMatch[1], perform);
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      if (!result.supported) throw new Error('Update Haus Helper to prepare camera recordings.');
      return result.event;
    }
    const response = await perform();
    const text = await response.text();
    if (epoch !== this.epoch) throw new Error('The connected home changed.');
    if (text.length > 4000000) throw new Error('Haus returned too much timeline data.');
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        response.ok
          ? 'The recording service returned an unexpected response.'
          : 'The recording service is reconnecting. Try again shortly.',
      );
    }
    if (viewer?.[2] && response.ok) this.cameraViewers.delete(viewerKey!);
    if (request.path.endsWith('/warm') && response.ok) {
      const id = request.path.split('/')[3];
      const owner = this.warmOwner + (request.data?.preview === true ? '-preview' : '');
      const key = `${id}:${owner}`;
      if (request.data?.active) this.warmCameras.set(key, id);
      else this.warmCameras.delete(key);
    }
    if (response.status === 409 && request.path === '/api/preferences' && isRecord(result))
      return result;
    if (viewer && !viewer[2] && response.status === 404 && isRecord(result)) {
      if (result.error === 'not_found') throw new Error('helper_viewer_route_missing');
      if (result.error === 'camera_not_found') throw new Error('helper_camera_not_registered');
    }
    if (!response.ok)
      throw new HelperOperationError(
        isRecord(result) && typeof result.error === 'string'
          ? result.error
          : 'The recordings service is unavailable.',
      );
    return result;
  }
  private repairRecording(id: string, request: () => Promise<Response>) {
    const known = this.repairingRecordings.get(id);
    if (known) return known;
    this.preparedRecordings.delete(id);
    this.mediaSources.delete(id);
    const task = this.prepareRecording(id, request);
    this.repairingRecordings.set(id, task);
    void task
      .finally(() => {
        if (this.repairingRecordings.get(id) === task) this.repairingRecordings.delete(id);
      })
      .catch(() => {});
    return task;
  }
  private prepareRecording(id: string, request?: () => Promise<Response>) {
    const repairing = this.repairingRecordings.get(id);
    if (repairing) return repairing;
    const known = this.preparedRecordings.get(id);
    if (known) return known;
    const epoch = this.epoch;
    const task = (async () => {
      const response = await recordingPreparation(
        request ??
          (() =>
            this.fetch(
              `/api/events/${id}/prepare`,
              { headers: { 'X-Haus-Async-Prepare': '1' } },
              30000,
            )),
        this.connectionAbort.signal,
      );
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      if (response.status === 404) {
        this.mediaSourceSupported = false;
        await response.body?.cancel();
        return { supported: false } as const;
      }
      if (!response.ok)
        throw new Error('This recording is still being prepared. Try again shortly.');
      const text = await response.text();
      if (text.length > 4000000) throw new Error('Haus returned too much timeline data.');
      let event: unknown;
      try {
        event = JSON.parse(text);
      } catch {
        throw new Error('The recording service returned an unexpected response.');
      }
      // Grants obtained before preparation may still point at the legacy source.
      this.mediaSources.delete(id);
      return { supported: true, event } as const;
    })().catch((reason) => {
      if (this.preparedRecordings.get(id) === task) this.preparedRecordings.delete(id);
      throw reason;
    });
    if (this.preparedRecordings.size >= 24)
      this.preparedRecordings.delete(this.preparedRecordings.keys().next().value!);
    this.preparedRecordings.set(id, task);
    return task;
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
      !['', '?format=1', '?format=1&original=1'].includes(url.search) ||
      url.hash
    )
      throw new Error('Invalid recording address.');
    const original = url.search === '?format=1&original=1';
    if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error('Invalid recording range.');
    let response: Response | undefined;
    const sourceKey = url.pathname.split('/')[1];
    if (url.pathname.endsWith('/video') && !original) {
      const preparation = await this.prepareRecording(sourceKey);
      if (!preparation.supported) this.mediaSourceSupported = false;
      if (signal?.aborted) throw new DOMException('Recording request cancelled.', 'AbortError');
    }
    if (url.pathname.endsWith('/video') && !original && this.mediaSourceSupported) {
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
          response = await fetchMedia(source.url, {
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
    const mediaPath = original ? `/api/events/${sourceKey}/original` : `/api/events${url.pathname}`;
    response ??= await this.fetch(
      mediaPath,
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
    const body = url.pathname.endsWith('/video')
      ? resilientMediaBody(
          response,
          (start, end, resumeSignal) => {
            if (epoch !== this.epoch) throw new Error('The connected home changed.');
            return this.fetch(
              mediaPath,
              { headers: { Range: `bytes=${start}-${end}` }, signal: resumeSignal },
              600000,
            );
          },
          AbortSignal.any([connectionSignal, ...(signal ? [signal] : [])]),
        )
      : response.body;
    return new Response(body, { status: response.status, headers });
  }
  private getSurface() {
    if (this.surface && (this.surface.expiresAt >= Date.now() || this.live?.connected))
      return Promise.resolve(this.surface);
    if (this.surfaceRequest) return this.surfaceRequest;
    const epoch = this.epoch;
    const task = (async () => {
      const availability = await this.availability();
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      if (!availability.installed || !availability.slug)
        throw new Error('Install Haus to record camera events.');
      if (availability.state !== 'started') throw new Error('Start Haus to view your recordings.');
      const surface = {
        ...(await this.connection.addonSurface(availability.slug)),
        expiresAt: Date.now() + 180000,
      };
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      this.surface = surface;
      return surface;
    })().finally(() => {
      if (this.surfaceRequest === task) this.surfaceRequest = undefined;
    });
    this.surfaceRequest = task;
    return task;
  }
  private surfaceFor(signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<HelperSurface>((resolve, reject) => {
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      void this.getSurface()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', aborted));
    });
  }
  private async fetch(path: string, init: RequestInit = {}, timeout = 120000) {
    const epoch = this.epoch;
    // Renewal and a possible retry share the original deadline/cancellation.
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      this.connectionAbort.signal,
      ...(init.signal ? [init.signal] : []),
    ]);
    const read = ['GET', 'HEAD'].includes(init.method ?? 'GET');
    for (let attempt = 0; ; attempt++) {
      const surface = await this.surfaceFor(signal);
      signal.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('The connected home changed.');
      const response = await fetch(new URL(path.slice(1), surface.url), {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers,
          'X-Haus-Client': '1',
          ...(surface.cookie ? { Cookie: `ingress_session=${surface.cookie}` } : {}),
        },
        redirect: 'error',
        signal,
      });
      const denied = [401, 403].includes(response.status);
      // A structured helper error belongs to that operation. Only the ingress
      // gateway's own failure requires renewing its session before another read.
      const gateway =
        [502, 503, 504].includes(response.status) &&
        !/\bjson\b/i.test(response.headers.get('content-type') ?? '');
      if (denied || gateway) {
        // A late old-session failure must not discard another caller's renewal.
        if (this.surface === surface) this.surface = undefined;
        if (read && attempt === 0) {
          await response.body?.cancel();
          continue;
        }
      }
      if (denied) {
        await response.body?.cancel();
        throw new Error('Your recording session needs to reconnect.');
      }
      return response;
    }
  }
  clear() {
    this.direct?.clear();
    this.live?.stop();
    const surface = this.surface;
    if (surface) {
      const release = (path: string, data: Record<string, unknown>) =>
        void fetch(new URL(path, surface.url), {
          method: 'POST',
          body: JSON.stringify(data),
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
      for (const [key, id] of this.warmCameras)
        release(`api/cameras/${id}/warm`, { active: false, owner: key.slice(id.length + 1) });
      for (const entry of this.cameraViewers.values())
        release(`api/cameras/${entry.camera}/viewer/close`, {
          viewerId: entry.viewerId,
          owner: this.warmOwner,
        });
    }
    this.cameraViewers.clear();
    this.warmCameras.clear();
    this.previewSupport = undefined;
    this.warmOwner = randomUUID();
    this.epoch++;
    this.connectionAbort.abort();
    this.connectionAbort = new AbortController();
    this.mediaSources.clear();
    this.preparedRecordings.clear();
    this.repairingRecordings.clear();
    this.mediaSourceSupported = true;
    this.stopTalk();
    this.surface = undefined;
    this.surfaceRequest = undefined;
  }
}
