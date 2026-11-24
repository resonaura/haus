/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import type { MediaRuntime } from './tools.js';

export interface VideoFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly format: 'bgra';
}

interface VideoDecodeOptions {
  /** URL supplied by the local playback relay. No session credentials cross this boundary. */
  readonly source: URL;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly startSeconds?: number;
  readonly signal: AbortSignal;
}

const FIRST_FRAME_TIMEOUT_MS = 20_000;
const FRAME_TIMEOUT_MS = 8000;

/** Decode a paced video stream to packed pixels without buffering multiple decoded frames. */
export async function* decodeVideoFrames(
  runtime: MediaRuntime,
  { source, width, height, fps, startSeconds, signal }: VideoDecodeOptions,
): AsyncGenerator<VideoFrame> {
  if (source.origin !== `http://127.0.0.1:${source.port}` || source.username || source.password) {
    throw new Error('Video decoding requires a local HTTP relay.');
  }
  if (
    !Number.isInteger(width) ||
    width < 2 ||
    width > 1920 ||
    !Number.isInteger(height) ||
    height < 2 ||
    height > 1080 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60
  )
    throw new Error('Invalid video frame profile.');

  signal.throwIfAborted();
  const stalled = new AbortController();
  const scope = AbortSignal.any([signal, stalled.signal]);
  const seekArgs =
    typeof startSeconds === 'number' && Number.isFinite(startSeconds) && startSeconds > 0
      ? ['-ss', String(startSeconds)]
      : [];
  const child = runtime.spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-rw_timeout',
      '10000000',
      '-protocol_whitelist',
      'http,tcp,crypto',
      '-re',
      ...seekArgs,
      '-i',
      source.href,
      '-map',
      '0:v:0',
      '-an',
      '-sn',
      '-dn',
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1,setsar=1,fps=${fps}`,
      '-pix_fmt',
      'bgra',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const completion = new Promise<boolean>((resolve) => {
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
  const cancel = () => child.kill('SIGKILL');
  const abortStalledDecoder = () =>
    stalled.abort(new Error('The camera stopped delivering video frames.'));
  let frameDeadline = setTimeout(abortStalledDecoder, FIRST_FRAME_TIMEOUT_MS);
  process.once('exit', cancel);
  scope.addEventListener('abort', cancel, { once: true });
  try {
    scope.throwIfAborted();
    const stdout = child.stdout;
    if (!stdout) throw new Error('The video decoder has no output.');
    const frameLength = width * height * 4;
    let pixels = Buffer.allocUnsafe(frameLength);
    let filled = 0;
    for await (const chunk of stdout) {
      const bytes: unknown = chunk;
      if (!Buffer.isBuffer(bytes)) throw new Error('Invalid video decoder output.');
      let offset = 0;
      while (offset < bytes.length) {
        scope.throwIfAborted();
        const copied = bytes.copy(pixels, filled, offset, offset + frameLength - filled);
        filled += copied;
        offset += copied;
        if (filled !== frameLength) continue;
        clearTimeout(frameDeadline);
        yield { width, height, pixels, format: 'bgra' };
        scope.throwIfAborted();
        frameDeadline = setTimeout(abortStalledDecoder, FRAME_TIMEOUT_MS);
        pixels = Buffer.allocUnsafe(frameLength);
        filled = 0;
      }
    }
    scope.throwIfAborted();
    if (!(await completion) || filled !== 0)
      throw new Error('The video stream ended unexpectedly.');
  } finally {
    clearTimeout(frameDeadline);
    scope.removeEventListener('abort', cancel);
    process.removeListener('exit', cancel);
    if (child.exitCode === null && child.signalCode === null) cancel();
    await completion;
  }
}
