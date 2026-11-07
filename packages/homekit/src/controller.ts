/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Readable, PassThrough } from 'node:stream';
import { HomeKitMedia } from './media.js';
import { syncCameraSpotlight } from './spotlight.js';
import { syncCameraOperating } from './operating.js';
import type * as Hap from '@homebridge/hap-nodejs';
import type {
  BridgeOptions,
  Camera,
  Entry,
  Identity,
  Route,
  Live,
  PrepareReply,
  PacketReply,
  MediaCommand,
} from './contracts.js';

const privateV4 = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const ownerFor = (id: string) =>
  `homekit-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
const failure = () => Error('HomeKit media is unavailable. Check the camera worker in Haus.');
const resolutions: [number, number, number][] = [
  [1920, 1080, 30],
  [1920, 1080, 15],
  [1280, 720, 30],
  [1280, 720, 15],
  [640, 360, 30],
  [320, 240, 15],
];

export function homekitSettings(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['enabled', 'processor'].includes(key)) ||
    !('enabled' in value) ||
    !('processor' in value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.processor !== 'string' ||
    !/^(auto|home|[a-f0-9-]{36})$/.test(value.processor)
  )
    throw Error('invalid_homekit_settings');
  return { enabled: value.enabled, processor: value.processor };
}

export function recordingProfile(configuration: Hap.CameraRecordingConfiguration, audio: boolean) {
  if (
    !configuration ||
    configuration.videoCodec?.type !== 0 ||
    configuration.audioCodec?.type !== 0
  )
    throw Error('invalid_homekit_recording');
  const [width, height, fps] = configuration.videoCodec.resolution;
  return {
    video: {
      width,
      height,
      fps,
      bitrate: configuration.videoCodec.parameters.bitRate,
      profile: configuration.videoCodec.parameters.profile,
      level: configuration.videoCodec.parameters.level,
    },
    fragmentLength: configuration.mediaContainerConfiguration.fragmentLength,
    prebufferLength: configuration.prebufferLength,
    audio,
    audioRate: [8000, 16000, 24000, 32000, 44100, 48000][configuration.audioCodec.samplerate],
    audioBitrate: configuration.audioCodec.bitrate,
  };
}

/** HAP identity lives on HA. Workers receive only expiring camera/media leases. */
export class HomeKitCameras {
  declare config: BridgeOptions['config'];
  declare store: BridgeOptions['store'];
  declare identityStorage: BridgeOptions['identityStorage'];
  declare cluster: BridgeOptions['cluster'];
  declare sessions: BridgeOptions['sessions'];
  declare registry: BridgeOptions['registry'];
  declare activity: BridgeOptions['activity'];
  declare talkback: BridgeOptions['talkback'];
  declare json: BridgeOptions['json'];
  declare request: BridgeOptions['request'];
  declare resolveSource: BridgeOptions['resolveSource'];
  declare validateSource: BridgeOptions['validateSource'];
  declare cachedSnapshot?: BridgeOptions['snapshot'];
  declare spotlight?: BridgeOptions['spotlight'];
  declare operating?: BridgeOptions['operating'];
  declare now: () => number;
  declare hap: typeof Hap;
  root!: string;
  timer?: NodeJS.Timeout;
  storageReady = false;
  entries = new Map<string, Entry>();
  private readonly identities = new Map<string, Identity>();
  localInputs = new Map<string, { cameraId: string; url: string }>();
  stopped = false;
  busy = false;
  bootId: string;
  local?: HomeKitMedia;
  constructor({
    config,
    store,
    identityStorage,
    cluster,
    sessions,
    registry,
    activity,
    talkback,
    now = Date.now,
    hap,
    json,
    request,
    resolveSource,
    validateSource,
    snapshot,
    spotlight,
    operating,
  }: BridgeOptions) {
    Object.assign(this, {
      config,
      store,
      identityStorage,
      cluster,
      sessions,
      registry,
      activity,
      talkback,
      now,
      hap,
      json,
      request,
      resolveSource,
      validateSource,
    });
    this.cachedSnapshot = snapshot;
    this.spotlight = spotlight;
    this.operating = operating;
    this.stopped = false;
    this.bootId = randomBytes(8).toString('hex');
  }
  async initialize() {
    this.root = join(this.config.data, 'homekit');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const row of await this.identityStorage.list()) {
      this.identities.set(row.cameraId, JSON.parse(row.value) as Identity);
    }
    await this.loadHap();
    this.timer = setInterval(() => void this.tick().catch(() => {}), 2000);
    this.timer.unref();
    return this;
  }
  private lifecycle: Promise<unknown> = Promise.resolve();
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(operation);
    this.lifecycle = task.catch(() => undefined);
    return task;
  }
  settings(id: string) {
    return this.store.overrides()[id]?.homekit ?? { enabled: false, processor: 'auto' };
  }
  status(id: string) {
    const settings = this.settings(id),
      entry = this.entries.get(id);
    const identity = entry?.identity ?? (this.storageReady ? this.identities.get(id) : undefined);
    const paired =
      entry?.accessory._accessoryInfo?.paired() ??
      (identity && this.hap?.AccessoryInfo.load(identity.username)?.paired());
    return {
      ...settings,
      paired: paired === true,
      pairingManagement: true,
      state: !settings.enabled
        ? 'off'
        : entry?.error
          ? 'unavailable'
          : entry?.published
            ? entry.accessory._accessoryInfo?.paired()
              ? 'paired'
              : 'pairing'
            : 'waiting',
      recording: !!entry?.recordingActive,
      prebufferReady: entry?.prebufferReady === true,
      processorName: entry?.recordRoute?.name,
      talkback: entry?.talkAvailable === true,
      ...(entry?.error ? { message: entry.error } : {}),
    };
  }
  async loadHap() {
    if (!this.hap) this.hap = await import('@homebridge/hap-nodejs');
    if (!this.storageReady) {
      this.hap.HAPStorage.setCustomStoragePath(join(this.root, 'persist'));
      this.storageReady = true;
    }
    return this.hap;
  }
  async identity(id: string): Promise<Identity> {
    const saved = this.identities.get(id);
    if (saved) return saved;
    const bytes = randomBytes(6);
    bytes[0] = (bytes[0] | 2) & 254;
    let pin;
    do {
      pin = String(randomInt(0, 100000000)).padStart(8, '0');
    } while (/^(\d)\1{7}$/.test(pin) || ['12345678', '87654321'].includes(pin));
    const identity = {
      username: [...bytes]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join(':')
        .toUpperCase(),
      pincode: `${pin.slice(0, 3)}-${pin.slice(3, 5)}-${pin.slice(5)}`,
      setupID: randomBytes(3).toString('hex').slice(0, 4).toUpperCase(),
    };
    await this.identityStorage.save(id, JSON.stringify(identity));
    this.identities.set(id, identity);
    return identity;
  }
  address() {
    const assigned = Object.values(networkInterfaces())
      .flatMap((addresses) => addresses ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal && privateV4(item.address));
    if (this.config.homekit_address) {
      if (!assigned.some((item) => item.address === this.config.homekit_address))
        throw Error('Choose a Home Assistant LAN address in the Haus add-on options.');
      return this.config.homekit_address;
    }
    const selected = assigned.find((item) => !/^172\.(17|18|30)\./.test(item.address));
    if (!selected) throw Error('HomeKit needs Home Assistant host networking and a LAN address.');
    return selected.address;
  }
  async create(camera: Camera) {
    const h = await this.loadHap();
    const accessory = new h.Accessory(
      camera.name || camera.id,
      h.uuid.generate(`haus-hksv:${camera.id}`),
    );
    const identity = await this.identity(camera.id);
    accessory
      .getService(h.Service.AccessoryInformation)!
      .setCharacteristic(h.Characteristic.Manufacturer, 'Haus')
      .setCharacteristic(h.Characteristic.Model, 'Secure Video Camera')
      .setCharacteristic(h.Characteristic.SerialNumber, identity.username.replaceAll(':', ''));
    const motion = new h.Service.MotionSensor('Camera Activity');
    accessory.addService(motion);
    const entry: Entry = {
      controller: undefined!,
      cameraId: camera.id,
      accessory,
      identity,
      motion,
      live: new Map(),
      recordStreams: new Map(),
      owner: `${ownerFor(camera.id)}-${this.bootId}`,
      generation: 0,
      closed: false,
    };
    syncCameraSpotlight(entry, h, this.spotlight);
    entry.talkAvailable = await this.talkback.available(camera, this.registry());
    const delegate: Hap.CameraStreamingDelegate & Hap.CameraRecordingDelegate = {
      handleSnapshotRequest: (_request, callback) => {
        void this.snapshot(entry).then(
          (buffer) => callback(undefined, buffer),
          () => callback(failure()),
        );
      },
      prepareStream: (request, callback) => {
        void this.prepare(entry, request).then(
          (value) => callback(undefined, value),
          () => callback(failure()),
        );
      },
      handleStreamRequest: (request, callback) => {
        void this.stream(entry, request).then(
          () => callback(),
          () => callback(failure()),
        );
      },
      updateRecordingActive: (active) => {
        entry.recordingActive = active;
        ++entry.generation;
        if (!active) this.stopRecordingNow(entry);
        void this.updateRecording(entry).catch(() => {});
      },
      updateRecordingConfiguration: (configuration) => {
        entry.configuration = configuration;
        ++entry.generation;
        void this.updateRecording(entry).catch(() => {});
      },
      handleRecordingStreamRequest: (streamId, signal) => this.recording(entry, streamId, signal),
      closeRecordingStream: (streamId) => entry.recordStreams.get(streamId)?.abort(),
      acknowledgeStream: (streamId) => entry.recordStreams.get(streamId)?.abort(),
    };
    const controller = new h.CameraController({
      cameraStreamCount: 2,
      delegate,
      streamingOptions: {
        supportedCryptoSuites: [h.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: { codec: { profiles: [0, 1, 2], levels: [0, 1, 2] }, resolutions },
        audio: {
          codecs: [
            { type: h.AudioStreamingCodecType.OPUS, samplerate: [16, 24], audioChannels: 1 },
          ],
          twoWayAudio: entry.talkAvailable,
        },
      },
      recording: {
        delegate,
        options: {
          prebufferLength: 8000,
          mediaContainerConfiguration: { type: 0, fragmentLength: 4000 },
          video: { type: 0, parameters: { profiles: [0, 1, 2], levels: [0, 1, 2] }, resolutions },
          audio: { codecs: [{ type: 0, samplerate: [1, 2, 5], audioChannels: 1 }] },
        },
      },
      sensors: { motion },
    });
    entry.controller = controller as Entry['controller'];
    accessory.configureController(controller);
    syncCameraOperating(entry, h, this.operating);
    const privacyChanged = () => {
      ++entry.generation;
      this.stopRecordingNow(entry);
      for (const streamId of entry.live.keys()) {
        controller.forceStopStreamingSession(streamId);
        void this.stopLive(entry, streamId);
      }
      for (const request of entry.recordStreams.values()) request.abort();
      void this.updateRecording(entry).catch(() => {});
    };
    controller.on('microphone-change', privacyChanged);
    controller.on('speaker-change', privacyChanged);
    controller
      .recordingManagement!.operatingModeService.getCharacteristic(
        h.Characteristic.HomeKitCameraActive,
      )
      .on('change', privacyChanged);
    controller
      .recordingManagement!.recordingManagementService.getCharacteristic(
        h.Characteristic.RecordingAudioActive,
      )
      .on('change', privacyChanged);
    accessory.addListener('error', () => {
      entry.error =
        'HomeKit could not publish this camera. Check LAN networking and restart pairing.';
    });
    this.entries.set(camera.id, entry);
    return entry;
  }
  cameraActive(entry: Entry) {
    return Boolean(
      entry.controller.recordingManagement.operatingModeService.getCharacteristic(
        this.hap.Characteristic.HomeKitCameraActive,
      ).value,
    );
  }
  async publish(entry: Entry) {
    if (entry.published || entry.closed) return;
    const address = this.address();
    await entry.accessory.publish({
      ...entry.identity,
      category: this.hap.Categories.IP_CAMERA,
      bind: [address],
      advertiser: this.hap.MDNSAdvertiser.CIAO,
    });
    entry.published = true;
    entry.error = undefined;
  }
  async pairing(id: string) {
    return this.serialize(async () => {
      const camera = this.registry().cameras.find((camera) => camera.id === id);
      if (this.stopped || !camera || !this.settings(id).enabled)
        throw Error('Enable Apple Home for this camera first.');
      const entry = this.entries.get(id) ?? (await this.create(camera));
      if (this.hap.AccessoryInfo.load(entry.identity.username)?.paired())
        return { paired: true as const };
      entry.pairUntil = this.now() + 10 * 60000;
      await this.publish(entry);
      if (!this.settings(id).enabled || this.stopped) {
        await this.remove(entry);
        throw Error('Apple Home setup was closed.');
      }
      if (entry.accessory._accessoryInfo?.paired()) return { paired: true as const };
      return {
        code: entry.identity.pincode,
        setupUri: entry.accessory.setupURI(),
        expiresAt: entry.pairUntil,
        paired: false as const,
      };
    });
  }
  async managePairing(id: string, action: 'close' | 'reset') {
    return this.serialize(async () => {
      if (this.stopped || !this.registry().cameras.some((camera) => camera.id === id))
        throw Error('camera_not_found');
      const entry = this.entries.get(id);
      if (action === 'close') {
        if (entry && !entry.accessory._accessoryInfo?.paired()) await this.remove(entry);
      } else {
        const hap = await this.loadHap();
        const identity = this.identities.get(id);
        if (entry) await this.remove(entry);
        if (identity) hap.Accessory.cleanupAccessoryData(identity.username);
        await this.identityStorage.delete(id);
        this.identities.delete(id);
      }
      return this.status(id);
    });
  }
  async localWorker() {
    if (this.local) return this.local;
    this.local = new HomeKitMedia({
      maxEncoders: 2,
      rtpPortRange: [0, 0],
      input: async (value) => {
        const input = this.localInputs.get(value.owner);
        if (!input || input.cameraId !== value.cameraId) throw Error('invalid_homekit_context');
        return (await this.validateSource({ kind: 'rtsp', url: input.url })).url;
      },
    });
    return this.local;
  }
  async route(entry: Entry, owner: string, live = false): Promise<Route> {
    const camera = this.registry().cameras.find((camera) => camera.id === entry.cameraId);
    if (!camera?.available || entry.closed || !this.cameraActive(entry)) throw failure();
    const settings = this.settings(camera.id);
    if (
      settings.processor === 'home' ||
      (settings.processor === 'auto' &&
        !this.cluster.nodes().some((node) => node.enabled && node.roles.includes('stream')))
    ) {
      const { url } = this.resolveSource(camera, this.registry(), { local: true });
      if (!url) throw failure();
      this.localInputs.set(owner, { cameraId: camera.id, url });
      return {
        local: await this.localWorker(),
        name: 'Home Assistant',
        context: { cameraId: camera.id, sessionId: randomUUID(), owner, address: this.address() },
      };
    }
    let source;
    if (settings.processor !== 'auto') {
      const node = this.cluster.nodes().find((node) => node.id === settings.processor);
      if (!node || this.cluster.health.get(node.id)?.remote?.features?.homekitMedia !== true)
        throw failure();
      source = await this.sessions.ensure(camera, owner, false, node, true);
    } else
      source = live
        ? await this.sessions.ensureLive(camera, owner)
        : await this.sessions.ensure(camera, owner, false, undefined, true);
    if (!this.cluster.health.get(source.node.id)?.remote?.features?.homekitMedia)
      throw Error('Update this NVR worker to enable HomeKit media.');
    return {
      node: source.node,
      name: source.node.name,
      source,
      context: {
        cameraId: camera.id,
        sessionId: source.id,
        owner,
        address: await this.sessions.advertiseHost(source.node),
      },
    };
  }
  async call<T = { ready: boolean }>(
    route: Route,
    input: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const data = { ...route.context, ...input };
    if (route.local) return route.local.command(data as MediaCommand, signal) as Promise<T>;
    return this.json<T>(route.node!, '/v1/homekit', {
      method: 'POST',
      data,
      signal,
      timeout: 20000,
    });
  }
  async binary(
    route: Route,
    input: { action: 'talk' | 'snapshot'; sessionID?: string },
    signal?: AbortSignal,
  ): Promise<{ buffer?: Buffer; stream?: Readable }> {
    if (route.local)
      return route.local.command(
        { ...route.context, ...input } as MediaCommand,
        signal,
      ) as Promise<{ buffer?: Buffer; stream?: Readable }>;
    const response = await this.request(route.node!, '/v1/homekit', {
      method: 'POST',
      data: { ...route.context, ...input },
      signal,
      timeout: input.action === 'talk' ? 3600000 : 15000,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw failure();
    }
    if (input.action === 'talk')
      return {
        stream: Readable.fromWeb(response.body! as unknown as NodeReadableStream<Uint8Array>),
      };
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 2 * 1024 ** 2) throw failure();
    return { buffer: data };
  }
  async snapshot(entry: Entry) {
    if (this.cachedSnapshot) {
      const camera = this.registry().cameras.find((camera) => camera.id === entry.cameraId);
      if (!camera) throw failure();
      return (await this.cachedSnapshot(camera)).buffer;
    }
    if (entry.snapshot && this.now() - entry.snapshot.at < 2000) return entry.snapshot.buffer;
    const owner = `${entry.owner}-snapshot`;
    let route: Route | undefined;
    try {
      route = entry.recordRoute ?? (await this.route(entry, owner));
      const { buffer } = await this.binary(route, { action: 'snapshot' });
      if (!buffer) throw failure();
      entry.snapshot = { at: this.now(), buffer };
      return buffer;
    } catch (error) {
      if (entry.snapshot && this.now() - entry.snapshot.at < 30000) return entry.snapshot.buffer;
      throw error;
    } finally {
      if (route && route !== entry.recordRoute) await this.release(route);
    }
  }
  async sourceSnapshot(camera: Camera) {
    if (this.cluster.nodes().some((node) => node.enabled && node.roles.includes('stream')))
      throw failure();
    const owner = `hk-snapshot-${randomUUID()}`;
    const { url } = this.resolveSource(camera, this.registry(), { local: true });
    this.localInputs.set(owner, { cameraId: camera.id, url });
    try {
      return await (
        await this.localWorker()
      ).snapshot({ owner, cameraId: camera.id, sessionId: randomUUID(), address: this.address() });
    } finally {
      this.localInputs.delete(owner);
    }
  }
  async prepare(entry: Entry, request: Hap.PrepareStreamRequest) {
    if (entry.live.has(request.sessionID)) throw failure();
    const route = await this.route(entry, `hk-live-${request.sessionID}`, true);
    if (entry.closed || !this.cameraActive(entry)) {
      await this.release(route);
      throw failure();
    }
    const state: Live = { route, request, abort: new AbortController() };
    entry.live.set(request.sessionID, state);
    try {
      const result = await this.call<PrepareReply>(
        route,
        {
          action: 'prepare',
          request: {
            ...request,
            video: {
              ...request.video,
              key: request.video.srtp_key.toString('hex'),
              salt: request.video.srtp_salt.toString('hex'),
              srtp_key: undefined,
              srtp_salt: undefined,
            },
            audio: {
              ...request.audio,
              key: request.audio.srtp_key.toString('hex'),
              salt: request.audio.srtp_salt.toString('hex'),
              srtp_key: undefined,
              srtp_salt: undefined,
            },
          },
        },
        state.abort.signal,
      );
      // The receiver advertises the same session crypto that the controller supplied.
      for (const kind of ['video', 'audio'] as const)
        Object.assign(result[kind], {
          srtp_key: request[kind].srtp_key,
          srtp_salt: request[kind].srtp_salt,
        });
      return result;
    } catch (error) {
      await this.stopLive(entry, request.sessionID);
      throw error;
    }
  }
  async stream(entry: Entry, request: Hap.StreamingRequest) {
    if (request.type === 'stop') return this.stopLive(entry, request.sessionID);
    const state = entry.live.get(request.sessionID);
    if (!state || !this.cameraActive(entry)) throw failure();
    if (request.type === 'reconfigure') {
      if (!state.started) throw failure();
      request = { ...state.started, video: { ...state.started.video, ...request.video } };
    }
    const microphone = entry.accessory.getService(this.hap.Service.Microphone);
    const speaker = entry.accessory.getService(this.hap.Service.Speaker);
    const talk =
      entry.talkAvailable && !speaker?.getCharacteristic(this.hap.Characteristic.Mute).value;
    const previousTalk = state.talk;
    state.talk = undefined;
    previousTalk?.abort.abort();
    await previousTalk?.task;
    if (state.abort.signal.aborted || entry.live.get(request.sessionID) !== state) throw failure();
    state.started = request;
    await this.call(
      state.route,
      {
        action: 'start',
        request,
        microphoneMuted: Boolean(microphone?.getCharacteristic(this.hap.Characteristic.Mute).value),
        microphoneVolume:
          microphone?.getCharacteristic(this.hap.Characteristic.Volume).value ?? 100,
        talkback: talk,
        speakerVolume: speaker?.getCharacteristic(this.hap.Characteristic.Volume).value ?? 100,
      },
      state.abort.signal,
    );
    if (talk && !state.abort.signal.aborted && entry.live.get(request.sessionID) === state) {
      const abort = new AbortController();
      const signal = AbortSignal.any([state.abort.signal, abort.signal]);
      const task = this.talk(entry, state, signal).catch(() => {});
      state.talk = { abort, task };
    }
  }
  async talk(entry: Entry, state: Live, signal = state.abort.signal) {
    const { stream } = await this.binary(
      state.route,
      { action: 'talk', sessionID: state.request.sessionID },
      signal,
    );
    if (!stream) throw failure();
    if (signal.aborted) {
      stream.destroy();
      throw failure();
    }
    const req = Object.assign(new PassThrough(), { headers: {} as Record<string, string> });
    req.headers = { 'x-haus-client': '1', 'content-type': 'audio/webm' };
    const res = Object.assign(new PassThrough(), { writeHead: () => res, flushHeaders: () => {} });
    res.resume();
    res.writeHead = () => res;
    res.flushHeaders = () => {};
    const stop = () => {
      stream.destroy();
      req.destroy();
      res.destroy();
    };
    signal.addEventListener('abort', stop, { once: true });
    stream.on('error', stop);
    stream.pipe(req);
    try {
      await this.talkback.stream(
        this.registry().cameras.find((camera) => camera.id === entry.cameraId)!,
        this.registry(),
        req,
        res,
      );
    } finally {
      signal.removeEventListener('abort', stop);
      stop();
    }
  }
  async stopLive(entry: Entry, id: string) {
    const state = entry.live.get(id);
    entry.live.delete(id);
    if (!state) return;
    state.abort.abort();
    await this.call(state.route, { action: 'stop', sessionID: id }).catch(() => {});
    await this.release(state.route);
  }
  async release(route: Route) {
    this.localInputs.delete(route.context.owner);
    if (route.node) await this.sessions.release(route.context.cameraId, route.context.owner);
  }
  stopRecordingNow(entry: Entry) {
    for (const stream of entry.recordStreams.values()) stream.abort();
    if (entry.recordRoute)
      void this.call(entry.recordRoute, {
        action: 'configure',
        configuration: null,
        generation: entry.generation,
      }).catch(() => {});
    entry.prebufferReady = false;
  }
  async updateRecording(entry: Entry) {
    if (entry.updating || entry.closed) return;
    entry.updating = true;
    const generation = entry.generation;
    try {
      const management = entry.controller.recordingManagement;
      const enabled = entry.recordingActive && !!entry.configuration && this.cameraActive(entry);
      if (!enabled) {
        if (entry.recordRoute) {
          for (const stream of entry.recordStreams.values()) stream.abort();
          await this.call(entry.recordRoute, {
            action: 'configure',
            configuration: null,
            generation,
          }).catch(() => {});
          await this.release(entry.recordRoute);
          entry.recordRoute = undefined;
        }
        entry.prebufferReady = false;
        return;
      }
      const audio = Boolean(
        management.recordingManagementService.getCharacteristic(
          this.hap.Characteristic.RecordingAudioActive,
        ).value,
      );
      const configuration = recordingProfile(entry.configuration!, audio);
      const settings = this.settings(entry.cameraId);
      const fingerprint = JSON.stringify([settings.processor, configuration]);
      // Never change the negotiated format of a recording already being consumed.
      if (entry.recordStreams.size && entry.fingerprint !== fingerprint) return;
      if (!entry.recordRoute || entry.fingerprint !== fingerprint) {
        if (entry.recordRoute) {
          await this.call(entry.recordRoute, {
            action: 'configure',
            configuration: null,
            generation,
          }).catch(() => {});
          await this.release(entry.recordRoute);
        }
        entry.recordRoute = await this.route(entry, entry.owner);
        entry.fingerprint = fingerprint;
      }
      if (entry.recordRoute.node) {
        const source = await this.sessions.ensure(
          this.registry().cameras.find((camera) => camera.id === entry.cameraId)!,
          entry.owner,
        );
        if (
          source.id !== entry.recordRoute.context.sessionId ||
          source.node.id !== entry.recordRoute.node.id
        ) {
          for (const stream of entry.recordStreams.values()) stream.abort();
          entry.recordRoute = {
            node: source.node,
            source,
            name: source.node.name,
            context: {
              ...entry.recordRoute.context,
              sessionId: source.id,
              address: await this.sessions.advertiseHost(source.node),
            },
          };
        }
      }
      if (generation !== entry.generation || entry.closed) {
        this.stopRecordingNow(entry);
        return;
      }
      const result = await this.call(entry.recordRoute, {
        action: 'configure',
        configuration,
        generation,
      });
      if (generation !== entry.generation || entry.closed) {
        this.stopRecordingNow(entry);
        return;
      }
      entry.prebufferReady = result.ready === true;
      entry.error = undefined;
    } catch (error) {
      entry.error = /Update this NVR/.test(error instanceof Error ? error.message : '')
        ? (error as Error).message
        : 'HomeKit is waiting for an available media worker. Haus keeps the camera’s Apple Home pairing.';
      entry.prebufferReady = false;
      if (entry.recordRoute) {
        await this.release(entry.recordRoute);
        entry.recordRoute = undefined;
      }
    } finally {
      entry.updating = false;
    }
  }
  async *recording(entry: Entry, streamId: number, signal?: AbortSignal) {
    const abort = new AbortController();
    entry.recordStreams.set(streamId, abort);
    const route = entry.recordRoute;
    if (!route) {
      entry.recordStreams.delete(streamId);
      throw failure();
    }
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    let reader: PacketReply | undefined;
    try {
      reader = await this.call<PacketReply>(route, { action: 'open' }, combined);
      yield { data: Buffer.from(reader.data!, 'base64'), isLast: false };
      let cursor = reader.cursor;
      const started = this.now();
      while (!combined.aborted) {
        const packet = await this.call<PacketReply>(
          route,
          { action: 'next', readerId: reader.readerId, cursor },
          combined,
        );
        if (combined.aborted) return;
        if (!packet.data) continue;
        cursor = packet.cursor;
        const last =
          this.now() - (entry.lastActivity ?? started) > 10000 || this.now() - started > 300000;
        yield { data: Buffer.from(packet.data, 'base64'), isLast: last };
        if (last) return;
      }
    } finally {
      entry.recordStreams.delete(streamId);
      if (reader)
        await this.call(route, { action: 'close', readerId: reader.readerId }).catch(() => {});
    }
  }
  async remove(entry: Entry) {
    entry.closed = true;
    ++entry.generation;
    for (const stream of entry.recordStreams.values()) stream.abort();
    for (const id of entry.live.keys()) await this.stopLive(entry, id);
    if (entry.recordRoute) {
      await this.call(entry.recordRoute, {
        action: 'configure',
        configuration: null,
        generation: entry.generation,
      }).catch(() => {});
      await this.release(entry.recordRoute);
    }
    if (entry.published) await entry.accessory.unpublish();
    this.entries.delete(entry.cameraId);
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      await this.serialize(() => this.reconcile());
    } finally {
      this.busy = false;
    }
  }
  private async reconcile() {
    if (this.stopped) return;
    for (const entry of this.entries.values())
      if (
        !this.settings(entry.cameraId).enabled ||
        !this.registry().cameras.some((camera) => camera.id === entry.cameraId)
      )
        await this.remove(entry);
    for (const camera of this.registry().cameras) {
      if (!this.settings(camera.id).enabled) continue;
      let entry = this.entries.get(camera.id);
      try {
        entry ??= await this.create(camera);
        // Paired identities are always reachable; an unpaired advertisement needs an explicit window.
        if (!entry.published && this.hap.AccessoryInfo.load(entry.identity.username)?.paired())
          await this.publish(entry);
        if (
          entry.published &&
          !entry.accessory._accessoryInfo?.paired() &&
          (entry.pairUntil ?? 0) < this.now()
        ) {
          await entry.accessory.unpublish();
          entry.published = false;
        }
        const activity = this.activity.status(camera.id);
        const active = activity.available && activity.active && this.cameraActive(entry);
        entry.motion.updateCharacteristic(this.hap.Characteristic.MotionDetected, !!active);
        syncCameraSpotlight(entry, this.hap, this.spotlight);
        syncCameraOperating(entry, this.hap, this.operating);
        if (active) entry.lastActivity = this.now();
        await this.updateRecording(entry);
        for (const state of entry.live.values()) {
          if (state.route.node) {
            try {
              const current = await this.sessions.ensure(camera, state.route.context.owner);
              if (
                current.node.id !== state.route.node.id ||
                current.id !== state.route.context.sessionId
              )
                throw failure();
            } catch {
              entry.controller.forceStopStreamingSession(state.request.sessionID);
              await this.stopLive(entry, state.request.sessionID);
              continue;
            }
          }
          await this.call(state.route, { action: 'lease', sessionID: state.request.sessionID });
        }
      } catch {
        if (entry)
          entry.error =
            'Apple Home is waiting for its camera worker. Check networking and available server capacity.';
      }
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.lifecycle;
    for (const entry of this.entries.values()) await this.remove(entry);
    await this.local?.stop();
  }
}
