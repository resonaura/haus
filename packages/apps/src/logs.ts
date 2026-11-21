/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { request } from 'node:http';

const CONTAINER_ID_RE = /^[a-f0-9]{64}$/;
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

export interface DockerContainerLogOptions {
  readonly tail?: number;
  readonly since?: number;
  readonly timestamps?: boolean;
}

export interface DockerLogStreamPort {
  getContainerLogs(
    containerId: string,
    options?: DockerContainerLogOptions,
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
  streamContainerLogs(
    containerId: string,
    options: DockerContainerLogOptions,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

function clampTail(tail?: number): number {
  if (tail === undefined || !Number.isFinite(tail)) return 200;
  return Math.max(1, Math.min(2000, Math.floor(tail)));
}

function buildLogsPath(
  containerId: string,
  options: DockerContainerLogOptions & { readonly follow?: boolean } = {},
): string {
  if (!CONTAINER_ID_RE.test(containerId)) throw Error('invalid_container_id');
  const query = new URLSearchParams({
    stdout: '1',
    stderr: '1',
    tail: String(clampTail(options.tail)),
    timestamps: options.timestamps === false ? '0' : '1',
  });
  if (options.follow) query.set('follow', '1');
  if (options.since !== undefined && Number.isFinite(options.since) && options.since >= 0) {
    query.set('since', String(Math.floor(options.since)));
  }
  return `/v1.45/containers/${containerId}/logs?${query.toString()}`;
}

/**
 * Incrementally demultiplexes Docker's 8-byte multiplexed log stream framing
 * (`[streamType, 0, 0, 0, sizeBE32]`) as well as plain TTY UTF-8 streams into clean text lines.
 */
export class DockerLogDemuxer {
  private mode: 'unknown' | 'multiplexed' | 'raw' = 'unknown';
  private pendingBytes: Buffer = Buffer.alloc(0);
  private pendingText = '';

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.mode === 'raw') {
      this.appendText(chunk.toString('utf8'));
      return;
    }

    this.pendingBytes =
      this.pendingBytes.length > 0 ? Buffer.concat([this.pendingBytes, chunk]) : chunk;

    if (this.mode === 'unknown') {
      if (this.pendingBytes.length < 8) return;
      const streamType = this.pendingBytes[0];
      const looksMultiplexed =
        (streamType === 1 || streamType === 2) &&
        this.pendingBytes[1] === 0 &&
        this.pendingBytes[2] === 0 &&
        this.pendingBytes[3] === 0;
      if (!looksMultiplexed) {
        this.mode = 'raw';
        const raw = this.pendingBytes.toString('utf8');
        this.pendingBytes = Buffer.alloc(0);
        this.appendText(raw);
        return;
      }
      this.mode = 'multiplexed';
    }

    let offset = 0;
    while (offset + 8 <= this.pendingBytes.length) {
      const streamType = this.pendingBytes[offset];
      if (
        (streamType !== 1 && streamType !== 2 && streamType !== 0) ||
        this.pendingBytes[offset + 1] !== 0 ||
        this.pendingBytes[offset + 2] !== 0 ||
        this.pendingBytes[offset + 3] !== 0
      ) {
        // Fallback to raw text if framing ever diverges.
        this.mode = 'raw';
        const rest = this.pendingBytes.subarray(offset).toString('utf8');
        this.pendingBytes = Buffer.alloc(0);
        this.appendText(rest);
        return;
      }
      const frameLen = this.pendingBytes.readUInt32BE(offset + 4);
      if (offset + 8 + frameLen > this.pendingBytes.length) break;
      const payload = this.pendingBytes.subarray(offset + 8, offset + 8 + frameLen);
      this.appendText(payload.toString('utf8'));
      offset += 8 + frameLen;
    }
    this.pendingBytes =
      offset > 0 ? Buffer.from(this.pendingBytes.subarray(offset)) : this.pendingBytes;
  }

  flush(): void {
    if (this.pendingBytes.length > 0) {
      if (this.mode === 'unknown' || this.mode === 'raw') {
        this.appendText(this.pendingBytes.toString('utf8'));
      }
      this.pendingBytes = Buffer.alloc(0);
    }
    const remainder = stripAnsi(this.pendingText).replace(/\r$/, '');
    this.pendingText = '';
    if (remainder.length > 0) {
      this.onLine(remainder);
    }
  }

  private appendText(text: string): void {
    this.pendingText += text;
    let newlineIdx = this.pendingText.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = stripAnsi(this.pendingText.slice(0, newlineIdx)).replace(/\r$/, '');
      this.pendingText = this.pendingText.slice(newlineIdx + 1);
      this.onLine(line);
      newlineIdx = this.pendingText.indexOf('\n');
    }
  }
}

/** Reads a bounded tail of stdout/stderr log lines from a Docker container via its Unix socket. */
export function readDockerContainerLogs(
  socketPath: string,
  containerId: string,
  options: DockerContainerLogOptions = {},
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const path = buildLogsPath(containerId, { ...options, follow: false });
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const lines: string[] = [];
    const demuxer = new DockerLogDemuxer((line) => lines.push(line));
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(
      { socketPath, method: 'GET', path, signal, timeout: SNAPSHOT_TIMEOUT_MS },
      (response) => {
        if (!response.statusCode || response.statusCode >= 400) {
          response.destroy();
          fail(
            Error(response.statusCode === 404 ? 'container_not_found' : 'docker_request_failed'),
          );
          return;
        }
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_SNAPSHOT_BYTES) {
            req.destroy();
            if (!settled) {
              settled = true;
              demuxer.flush();
              resolve(lines);
            }
            return;
          }
          demuxer.push(Buffer.from(chunk));
        });
        response.once('error', () => fail(Error('docker_request_failed')));
        response.once('end', () => {
          if (settled) return;
          settled = true;
          demuxer.flush();
          resolve(lines);
        });
      },
    );
    req.once('timeout', () => {
      fail(Error('docker_request_timeout'));
      req.destroy();
    });
    req.once('error', () =>
      fail(Error(signal?.aborted ? 'app_operation_cancelled' : 'docker_unavailable')),
    );
    req.end();
  });
}

/** Streams real-time stdout/stderr log lines (`follow=1`) until the container exits or `signal` aborts. */
export function streamDockerContainerLogs(
  socketPath: string,
  containerId: string,
  options: DockerContainerLogOptions,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const path = buildLogsPath(containerId, { ...options, follow: true });
  return new Promise((resolve, reject) => {
    let settled = false;
    const demuxer = new DockerLogDemuxer(onLine);
    const done = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      demuxer.flush();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(error);
    };
    const req = request({ socketPath, method: 'GET', path }, (response) => {
      if (!response.statusCode || response.statusCode >= 400) {
        response.destroy();
        fail(Error(response.statusCode === 404 ? 'container_not_found' : 'docker_request_failed'));
        return;
      }
      response.on('data', (chunk: Buffer) => {
        if (signal.aborted) return;
        demuxer.push(Buffer.from(chunk));
      });
      response.once('error', () => {
        if (signal.aborted) done();
        else fail(Error('docker_request_failed'));
      });
      response.once('end', done);
      response.once('close', done);
    });
    const onAbort = () => {
      req.destroy();
      done();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    req.once('error', () => {
      if (signal.aborted) done();
      else fail(Error('docker_unavailable'));
    });
    req.end();
  });
}
