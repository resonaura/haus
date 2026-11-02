/*
 * Haus — A thoughtful home for Home Assistant.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import dgram from 'node:dgram';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { HomeKitFragments } from './fragments.js';
import type {
  MediaOptions,
  MediaContext,
  MediaCommand,
  Video,
  Configure,
  Packet,
  Prepare,
  Start,
  Recorder,
  MediaSession,
  PrepareReply,
} from './contracts.js';
import { privateIp } from '@haus/media/source';

const integer = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const id = (n: unknown): n is string => typeof n === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(n);
const port = (n: unknown): n is number => integer(n, 1, 65535);
const uuid = (n: unknown): n is string => typeof n === 'string' && /^[a-f0-9-]{36}$/.test(n);
const rates = [8000, 16000, 24000, 32000, 44100, 48000];
const ffInput = (url: string) => [
  '-rtsp_transport',
  'tcp',
  '-timeout',
  '10000000',
  '-probesize',
  '32768',
  '-analyzeduration',
  '500000',
  '-i',
  url,
];
const base = ['-hide_banner', '-loglevel', 'error', '-nostdin'];

export function homekitVideo(value: Video) {
  if (
    !value ||
    !integer(value.width, 160, 1920) ||
    !integer(value.height, 120, 1080) ||
    value.width % 2 ||
    value.height % 2 ||
    !integer(value.fps, 1, 30) ||
    !integer(value.bitrate, 32, 8000) ||
    !integer(value.profile, 0, 2) ||
    !integer(value.level, 0, 2)
  )
    throw Error('invalid_homekit_video');
  return {
    width: value.width,
    height: value.height,
    fps: value.fps,
    bitrate: value.bitrate,
    profile: value.profile,
    level: value.level,
  };
}
const encodeVideo = (v: Video, seconds: number) => [
  '-map',
  '0:v:0',
  '-an',
  '-sn',
  '-dn',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-tune',
  'zerolatency',
  '-threads',
  '1',
  '-vf',
  `scale=${v.width}:${v.height}:force_original_aspect_ratio=decrease,pad=${v.width}:${v.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
  '-r',
  String(v.fps),
  '-b:v',
  `${v.bitrate}k`,
  '-maxrate',
  `${v.bitrate}k`,
  '-bufsize',
  `${v.bitrate * 2}k`,
  '-profile:v',
  ['baseline', 'main', 'high'][v.profile],
  '-level:v',
  ['3.1', '3.2', '4.0'][v.level],
  '-g',
  String(Math.max(1, Math.round(v.fps * seconds))),
  '-keyint_min',
  String(Math.max(1, Math.round(v.fps * seconds))),
  '-sc_threshold',
  '0',
];

/** Bounded HomeKit encoders use a leased existing source. They never open a camera themselves. */
export class HomeKitMedia {
  declare input: MediaOptions['input'];
  declare capacity: MediaOptions['capacity'];
  declare maxEncoders: number;
  declare ffmpeg: string;
  declare spawnProcess: typeof spawn;
  declare now: () => number;
  declare inputArgs: (input: string) => string[];
  declare rtpPortRange: [number, number];
  recorders = new Map<string, Recorder>();
  streams = new Map<string, MediaSession>();
  children = new Set<ChildProcess>();
  encoders = new Set<ChildProcess>();
  generations = new Map<string, { generation: number; at: number }>();
  timer: NodeJS.Timeout;
  stopped = false;
  constructor({
    input,
    capacity,
    maxEncoders = 2,
    ffmpeg = process.env.HAUS_FFMPEG_BIN || 'ffmpeg',
    spawnProcess = spawn,
    now = Date.now,
    inputArgs = ffInput,
    rtpPortRange = [8600, 8631],
  }: MediaOptions) {
    Object.assign(this, {
      input,
      capacity,
      maxEncoders,
      ffmpeg,
      spawnProcess,
      now,
      inputArgs,
      rtpPortRange,
    });
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }
  status() {
    return {
      profile: 1,
      active: this.children.size,
      max: this.maxEncoders,
      pressured: this.capacity?.pressured === true,
    };
  }
  child(
    args: string[],
    stdio: SpawnOptions['stdio'] = ['ignore', 'pipe', 'ignore'],
    admitted = true,
  ) {
    if (
      this.stopped ||
      this.children.size >= this.maxEncoders * 2 + 4 ||
      (admitted && (this.capacity?.pressured || this.encoders.size >= this.maxEncoders))
    )
      throw Error('homekit_capacity_busy');
    const child = this.spawnProcess(this.ffmpeg, [...base, ...args], { stdio, windowsHide: true });
    this.children.add(child);
    if (admitted) this.encoders.add(child);
    child.once('close', () => {
      this.children.delete(child);
      this.encoders.delete(child);
    });
    child.on('error', () => {});
    return child;
  }
  kill(child: ChildProcess | undefined) {
    if (!child || child.exitCode !== null || child.killed) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1500);
    timer.unref();
  }
  async terminate(child: ChildProcess | undefined) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'close').catch(() => {});
    this.kill(child);
    await ended;
  }
  context(value: MediaContext) {
    if (
      !value ||
      !/^camera\.[a-z0-9_]{1,120}$/.test(value.cameraId) ||
      !id(value.owner) ||
      !uuid(value.sessionId) ||
      !privateIp(value.address)
    )
      throw Error('invalid_homekit_context');
    return this.input(value);
  }
  async configure(value: Configure) {
    if (!id(value?.owner) || !Number.isSafeInteger(value.generation) || value.generation < 0)
      throw Error('invalid_homekit_context');
    const prior = this.generations.get(value.owner);
    if (prior && value.generation < prior.generation)
      throw Error('homekit_configuration_superseded');
    // A privacy stop wins even if a slower, older configure request completes later.
    const update = { generation: value.generation, at: this.now() };
    this.generations.set(value.owner, update);
    if (value.configuration === null) {
      await this.terminate(this.removeRecorder(value.owner));
      return { active: false };
    }
    const configuration = value.configuration;
    const video = homekitVideo(configuration?.video);
    if (
      !integer(configuration?.fragmentLength, 1000, 4000) ||
      !integer(configuration?.prebufferLength, 4000, 8000) ||
      !rates.includes(configuration.audioRate) ||
      !integer(configuration.audioBitrate, 16, 128) ||
      typeof configuration.audio !== 'boolean'
    )
      throw Error('invalid_homekit_recording');
    const input = await this.context(value);
    if (this.generations.get(value.owner) !== update || this.stopped)
      throw Error('homekit_configuration_superseded');
    const old = this.recorders.get(value.owner);
    const fingerprint = JSON.stringify([value.sessionId, configuration]);
    if (old?.fingerprint === fingerprint && !old.failed) {
      old.until = this.now() + 60000;
      return { active: true, ready: !!old.initialization };
    }
    await this.terminate(this.removeRecorder(value.owner));
    if (this.generations.get(value.owner) !== update || this.stopped)
      throw Error('homekit_configuration_superseded');
    const seconds = configuration.fragmentLength / 1000;
    const videoArgs = encodeVideo(video, seconds).filter((v) => v !== '-an');
    const child = this.child([
      ...this.inputArgs(input),
      ...videoArgs,
      ...(configuration.audio
        ? [
            '-map',
            '0:a:0',
            '-c:a',
            'aac',
            '-ar',
            String(configuration.audioRate),
            '-ac',
            '1',
            '-b:a',
            `${configuration.audioBitrate}k`,
          ]
        : ['-an']),
      '-f',
      'mp4',
      '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof',
      '-flush_packets',
      '1',
      'pipe:1',
    ]);
    const recorder: Recorder = {
      child,
      fingerprint,
      configuration,
      fragments: [],
      bytes: 0,
      sequence: 0,
      until: this.now() + 60000,
      readers: new Map(),
      waiters: new Set(),
    };
    this.recorders.set(value.owner, recorder);
    const parser = new HomeKitFragments((data, initialization) => {
      if (initialization) recorder.initialization = data;
      else {
        recorder.fragments.push({ sequence: ++recorder.sequence, at: this.now(), data });
        recorder.bytes += data.length;
        const keep = configuration.prebufferLength + configuration.fragmentLength * 3;
        while (
          recorder.fragments.length > 1 &&
          (recorder.bytes > 12 * 1024 ** 2 || recorder.fragments[1].at < this.now() - keep)
        )
          recorder.bytes -= recorder.fragments.shift()!.data.length;
      }
      for (const done of recorder.waiters) done();
    });
    child.stdout!.on('data', (chunk) => {
      try {
        parser.push(chunk);
      } catch {
        recorder.failed = true;
        this.kill(child);
      }
    });
    const failed = () => {
      recorder.failed = true;
      for (const done of recorder.waiters) done();
    };
    child.once('error', failed);
    child.once('close', failed);
    return { active: true, ready: false };
  }
  removeRecorder(owner: string) {
    const recorder = this.recorders.get(owner);
    this.recorders.delete(owner);
    if (!recorder) return;
    recorder.failed = true;
    this.kill(recorder.child);
    for (const done of recorder.waiters) done();
    return recorder.child;
  }
  async packet(value: Packet, signal?: AbortSignal) {
    const recorder = this.recorders.get(value.owner);
    if (!recorder || recorder.failed) throw Error('homekit_recording_unavailable');
    if (value.action === 'open') {
      if (!recorder.initialization || !recorder.fragments.length)
        throw Error('homekit_prebuffer_warming');
      if (recorder.readers.size) throw Error('homekit_recording_busy');
      const readerId = randomUUID();
      const after = this.now() - recorder.configuration.prebufferLength;
      const first =
        recorder.fragments.find((part) => part.at >= after) ?? recorder.fragments.at(-1);
      recorder.readers.set(readerId, this.now() + 30000);
      return {
        readerId,
        cursor: first!.sequence - 1,
        data: recorder.initialization.toString('base64'),
      };
    }
    if (typeof value.readerId !== 'string' || !recorder.readers.has(value.readerId))
      throw Error('invalid_homekit_reader');
    if (value.action === 'close') {
      recorder.readers.delete(value.readerId);
      return { closed: true };
    }
    if (typeof value.cursor !== 'number' || !Number.isSafeInteger(value.cursor) || value.cursor < 0)
      throw Error('invalid_homekit_cursor');
    recorder.readers.set(value.readerId, this.now() + 30000);
    const cursor = value.cursor;
    if (cursor >= recorder.sequence)
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          recorder.waiters.delete(done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, 5000);
        recorder.waiters.add(done);
        if (signal?.aborted) done();
        else signal?.addEventListener('abort', done, { once: true });
      });
    if (recorder.failed) throw Error('homekit_recording_unavailable');
    const part = recorder.fragments.find((item) => item.sequence > cursor);
    if (part && part.sequence !== cursor + 1) throw Error('homekit_recording_overrun');
    return part
      ? { cursor: part.sequence, data: part.data.toString('base64') }
      : { cursor: value.cursor };
  }
  async bindRtp(protocol: 'udp4' | 'udp6') {
    const [first, last] = this.rtpPortRange;
    for (let number = first; number <= last; number++) {
      const socket = dgram.createSocket(protocol);
      try {
        socket.bind(number);
        await once(socket, 'listening');
        return socket;
      } catch (error) {
        try {
          socket.close();
        } catch {}
        if (
          !(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') ||
          number === last
        )
          throw error;
      }
    }
    throw Error('homekit_ports_busy');
  }
  async prepare(value: Prepare): Promise<PrepareReply> {
    const request = value.request;
    if (!uuid(request?.sessionID) || !privateIp(request.targetAddress) || this.streams.size >= 8)
      throw Error('invalid_homekit_session');
    for (const kind of ['audio', 'video'] as const) {
      const media = request[kind];
      if (
        !port(media?.port) ||
        media.srtpCryptoSuite !== 0 ||
        !/^[a-f0-9]{32}$/.test(media.key) ||
        !/^[a-f0-9]{28}$/.test(media.salt)
      )
        throw Error('invalid_homekit_crypto');
    }
    await this.context(value);
    if (this.streams.has(request.sessionID)) throw Error('homekit_session_busy');
    const session: MediaSession = {
      context: value,
      request,
      until: this.now() + 30000,
      ssrc: { audio: 0, video: 0 },
      sockets: {},
      senders: {},
      forward: false,
      children: new Set(),
    };
    this.streams.set(request.sessionID, session);
    try {
      for (const kind of ['video', 'audio'] as const) {
        const socket = await this.bindRtp(request.targetAddress.includes(':') ? 'udp6' : 'udp4');
        session.sockets[kind] = socket;
        session.ssrc[kind] = randomBytes(4).readUInt32BE();
        socket.on('error', () => this.stopStream(request.sessionID));
        socket.on('message', (bytes, remote) => {
          if (remote.address.replace(/^::ffff:/, '') !== request.targetAddress) return;
          session.until = this.now() + 45000;
          if (kind === 'audio' && session.forward && bytes.length <= 4096)
            socket.send(bytes, session.talkPort, '127.0.0.1', () => {});
        });
        const sender = dgram.createSocket('udp4');
        session.senders[kind] = sender;
        sender.on('error', () => this.stopStream(request.sessionID));
        sender.on('message', (packet) =>
          socket.send(packet, request[kind].port, request.targetAddress, () => {}),
        );
        sender.bind(0, '127.0.0.1');
        await once(sender, 'listening');
      }
      return {
        addressOverride: value.address,
        video: { port: session.sockets.video!.address().port, ssrc: session.ssrc.video },
        audio: { port: session.sockets.audio!.address().port, ssrc: session.ssrc.audio },
      };
    } catch (error) {
      this.stopStream(request.sessionID);
      throw error;
    }
  }
  async start(value: Start) {
    const session = this.streams.get(value.request?.sessionID);
    if (!session || session.context.owner !== value.owner) throw Error('invalid_homekit_session');
    const v = value.request.video,
      a = value.request.audio;
    const video = homekitVideo({ ...v, bitrate: v.max_bit_rate });
    if (
      !integer(v.pt, 96, 127) ||
      !integer(v.mtu, 188, 1400) ||
      a?.codec !== 'OPUS' ||
      ![16, 24].includes(a.sample_rate) ||
      !integer(a.pt, 96, 127) ||
      !integer(a.max_bit_rate, 8, 128) ||
      ![20, 40, 60].includes(a.packet_time)
    )
      throw Error('invalid_homekit_stream');
    const input = await this.context(session.context);
    const previous = [...session.children];
    session.children.clear();
    session.forward = false;
    session.talk?.destroy();
    session.talkClaimed = false;
    await Promise.all(previous.map((child) => this.terminate(child)));
    if (this.streams.get(value.request.sessionID) !== session)
      throw Error('invalid_homekit_session');
    const output = (kind: 'video' | 'audio', pt: number) => [
      '-payload_type',
      String(pt),
      '-ssrc',
      String(session.ssrc[kind] | 0),
      '-f',
      'rtp',
      '-srtp_out_suite',
      'AES_CM_128_HMAC_SHA1_80',
      '-srtp_out_params',
      Buffer.from(session.request[kind].key + session.request[kind].salt, 'hex').toString('base64'),
      `srtp://127.0.0.1:${session.senders[kind]!.address().port}?rtcpport=${session.senders[kind]!.address().port}&pkt_size=${kind === 'video' ? v.mtu : 400}`,
    ];
    const child = this.child([
      ...this.inputArgs(input),
      ...encodeVideo(video, 1),
      ...output('video', v.pt),
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      'libopus',
      '-application',
      'lowdelay',
      '-frame_duration',
      String(a.packet_time),
      '-ar',
      String(a.sample_rate * 1000),
      '-ac',
      '1',
      '-b:a',
      `${a.max_bit_rate}k`,
      '-af',
      `volume=${value.microphoneMuted ? 0 : Math.max(0, Math.min(1, (value.microphoneVolume ?? 100) / 100))}`,
      ...output('audio', a.pt),
      '-progress',
      'pipe:1',
    ]);
    session.children.add(child);
    session.started = true;
    session.until = this.now() + 45000;
    child.once('close', () => {
      if (session.children.has(child)) this.stopStream(value.request.sessionID);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stopStream(value.request.sessionID);
        reject(Error('homekit_stream_timeout'));
      }, 12000);
      const done = (error?: boolean) => {
        clearTimeout(timer);
        child.stdout!.off('data', ready);
        child.off('error', fail);
        child.off('close', fail);
        if (error) reject(Error('homekit_stream_failed'));
        else resolve();
      };
      const ready = (data: Buffer) => {
        if (/frame=\s*[1-9]/.test(String(data))) done();
      };
      const fail = () => done(true);
      child.stdout!.on('data', ready);
      child.once('error', fail);
      child.once('close', fail);
    });
    if (value.talkback) await this.startTalk(session, a, value.speakerVolume);
    return { started: true };
  }
  async startTalk(session: MediaSession, audio: Start['request']['audio'], volume = 100) {
    const reservation = dgram.createSocket('udp4');
    reservation.bind(0, '127.0.0.1');
    await once(reservation, 'listening');
    session.talkPort = reservation.address().port;
    reservation.close();
    const key = Buffer.from(session.request.audio.key + session.request.audio.salt, 'hex').toString(
      'base64',
    );
    const sdp = `v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=Haus HomeKit Talkback\r\nc=IN IP4 127.0.0.1\r\nt=0 0\r\nm=audio ${session.talkPort} RTP/SAVP ${audio.pt}\r\na=rtpmap:${audio.pt} opus/48000/2\r\na=fmtp:${audio.pt} minptime=10;useinbandfec=1\r\na=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${key}\r\n`;
    const child = this.child(
      [
        '-protocol_whitelist',
        'pipe,udp,rtp,crypto',
        '-f',
        'sdp',
        '-i',
        'pipe:0',
        '-vn',
        '-c:a',
        'libopus',
        '-ar',
        '16000',
        '-ac',
        '1',
        '-b:a',
        '24k',
        '-af',
        `volume=${Math.max(0, Math.min(1, volume / 100))}`,
        '-f',
        'webm',
        '-live',
        '1',
        '-cluster_time_limit',
        '100',
        'pipe:1',
      ],
      ['pipe', 'pipe', 'ignore'],
      false,
    );
    session.children.add(child);
    session.talk = new PassThrough({ highWaterMark: 128 * 1024 });
    child.stdout!.pipe(session.talk);
    child.stdin!.on('error', () => {});
    child.stdin!.end(sdp);
    session.forward = true;
  }
  stopStream(sessionId: string) {
    const session = this.streams.get(sessionId);
    this.streams.delete(sessionId);
    if (!session) return;
    session.forward = false;
    for (const child of session.children) this.kill(child);
    for (const socket of Object.values(session.sockets)) {
      try {
        socket.close();
      } catch {}
    }
    for (const socket of Object.values(session.senders)) {
      try {
        socket.close();
      } catch {}
    }
    session.talk?.destroy();
  }
  async snapshot(value: MediaContext) {
    const input = await this.context(value);
    const child = this.child(
      [
        ...this.inputArgs(input),
        '-frames:v',
        '1',
        '-an',
        '-vf',
        'scale=640:-2',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      undefined,
      false,
    );
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(() => this.kill(child), 8000);
    try {
      for await (const data of child.stdout!) {
        bytes += data.length;
        if (bytes > 2 * 1024 ** 2) throw Error('homekit_snapshot_too_large');
        chunks.push(data);
      }
      const data = Buffer.concat(chunks);
      if (!data.length || data[0] !== 255 || data[1] !== 216)
        throw Error('homekit_snapshot_unavailable');
      return { buffer: data, mime: 'image/jpeg' };
    } finally {
      clearTimeout(timer);
      this.kill(child);
    }
  }
  async command(value: MediaCommand, signal?: AbortSignal) {
    if (!value || !id(value.owner)) throw Error('invalid_homekit_context');
    if (value.action === 'configure') return this.configure(value);
    if (value.action === 'open' || value.action === 'next' || value.action === 'close')
      return this.packet(value, signal);
    if (value.action === 'prepare') return this.prepare(value);
    if (value.action === 'start') return this.start(value);
    if (value.action === 'stop') {
      const session = this.streams.get(value.sessionID);
      if (session?.context.owner === value.owner) this.stopStream(value.sessionID);
      return { stopped: true };
    }
    if (value.action === 'snapshot') return this.snapshot(value);
    if (value.action === 'talk') {
      const session = this.streams.get(value.sessionID);
      if (!session?.talk || session.context.owner !== value.owner || session.talkClaimed)
        throw Error('homekit_talk_unavailable');
      session.talkClaimed = true;
      return { stream: session.talk, mime: 'audio/webm' };
    }
    if (value.action === 'lease') {
      await this.context(value);
      const recorder = this.recorders.get(value.owner);
      if (recorder) recorder.until = this.now() + 60000;
      const session = value.sessionID ? this.streams.get(value.sessionID) : undefined;
      if (session?.context.owner === value.owner) session.until = this.now() + 45000;
      return { renewed: true };
    }
    throw Error('invalid_homekit_action');
  }
  sweep() {
    for (const [id, recorder] of this.recorders) {
      if (recorder.until <= this.now()) this.removeRecorder(id);
      for (const [reader, until] of recorder.readers)
        if (until <= this.now()) recorder.readers.delete(reader);
    }
    for (const [id, session] of this.streams) if (session.until <= this.now()) this.stopStream(id);
    for (const [owner, update] of this.generations)
      if (!this.recorders.has(owner) && update.at < this.now() - 120000)
        this.generations.delete(owner);
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    for (const id of this.streams.keys()) this.stopStream(id);
    for (const id of this.recorders.keys()) this.removeRecorder(id);
    const children = [...this.children];
    for (const child of children) this.kill(child);
    await Promise.allSettled(children.map((child) => once(child, 'close')));
  }
}
