/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Writable } from 'node:stream';

const assetName = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,120}\.(m3u8|ts|m4s|mp4)$/;
const mediaFileName = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,120}\.(mp4|m4s|ts|mkv|webm)$/;
const maxManifestBytes = 256 * 1024;

export interface LocalHlsRelay {
  readonly url: URL;
  close(): Promise<void>;
}

type ReadHlsAsset = (asset: string, signal: AbortSignal) => Promise<Response>;
type ReadMediaAsset = (range: string | null, signal: AbortSignal) => Promise<Response>;

async function readManifest(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxManifestBytes) throw new Error('HLS manifest exceeds the size limit.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }

  const lines = text.split(/\r?\n/);
  if (lines[0] !== '#EXTM3U') throw new Error('Invalid HLS manifest.');
  for (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    if (!value.startsWith('#')) {
      if (!assetName.test(value)) throw new Error('The HLS manifest references an external asset.');
      continue;
    }
    for (const match of value.matchAll(/\bURI\s*=\s*([^,]*)/gi)) {
      const uri = /^"([^"]+)"$/.exec(match[1].trim())?.[1];
      if (!uri || !assetName.test(uri))
        throw new Error('The HLS manifest references an external asset.');
    }
  }
  return text;
}

async function startLoopbackRelay(
  onRequest: (
    request: IncomingMessage,
    response: ServerResponse,
    host: string,
    lifetime: AbortController,
  ) => Promise<void>,
  signal: AbortSignal,
  entryName: string,
): Promise<LocalHlsRelay> {
  signal.throwIfAborted();
  const lifetime = new AbortController();
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  let host = '';
  const server = createServer((request, response) => void onRequest(request, response, host, lifetime));
  server.maxConnections = 12;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    if (closing) return closing;
    signal.removeEventListener('abort', close);
    lifetime.abort();
    closing = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    return closing;
  }
  const address = server.address();
  if (signal.aborted || !address || typeof address === 'string') {
    await close();
    signal.throwIfAborted();
    throw new Error('The local media relay could not start.');
  }
  host = `127.0.0.1:${address.port}`;
  signal.addEventListener('abort', close, { once: true });
  return { url: new URL(`http://${host}${prefix}${entryName}`), close, prefix } as LocalHlsRelay & {
    prefix: string;
  };
}

/** Exposes one authorized HLS resource set to a local decoder for the lifetime of its viewer. */
export async function openLocalHlsRelay(
  readAsset: ReadHlsAsset,
  signal: AbortSignal,
): Promise<LocalHlsRelay> {
  let tokenPrefix = '';
  const relay = await startLoopbackRelay(
    async (request, response, host, lifetime) => {
      const uri = request.url;
      const name = tokenPrefix && uri?.startsWith(tokenPrefix) ? uri.slice(tokenPrefix.length) : '';
      if (request.method !== 'GET' || request.headers.host !== host || !assetName.test(name)) {
        response.writeHead(404).end();
        return;
      }
      const aborted = new AbortController();
      const closed = () => aborted.abort();
      response.once('close', closed);
      const scope = AbortSignal.any([lifetime.signal, aborted.signal]);
      try {
        const content = await readAsset(name, scope);
        if (scope.aborted || !content.ok || !content.body) {
          await content.body?.cancel();
          if (!scope.aborted) response.writeHead(content.status === 404 ? 404 : 502).end();
          return;
        }
        const manifest = name.endsWith('.m3u8');
        const headers = {
          'Cache-Control': 'no-store',
          'Content-Type': manifest
            ? 'application/vnd.apple.mpegurl'
            : name.endsWith('.ts')
              ? 'video/mp2t'
              : 'video/mp4',
        };
        if (manifest) {
          const text = await readManifest(content.body);
          if (!scope.aborted) response.writeHead(200, headers).end(text);
        } else {
          response.writeHead(200, headers);
          await content.body.pipeTo(Writable.toWeb(response), { signal: scope });
        }
      } catch {
        if (response.destroyed || scope.aborted) return;
        if (response.headersSent) response.destroy();
        else response.writeHead(502).end();
      } finally {
        response.removeListener('close', closed);
      }
    },
    signal,
    'index.m3u8',
  );
  tokenPrefix = new URL('.', relay.url).pathname;
  return { url: relay.url, close: relay.close };
}

/** Exposes one authorized recorded media clip to a local decoder with HTTP Range forwarding. */
export async function openLocalMediaRelay(
  readMedia: ReadMediaAsset,
  signal: AbortSignal,
  filename = 'clip.mp4',
): Promise<LocalHlsRelay> {
  if (!mediaFileName.test(filename)) throw new Error('Invalid media filename.');
  let expectedPath = '';
  const relay = await startLoopbackRelay(
    async (request, response, host, lifetime) => {
      const method = request.method ?? 'GET';
      if (
        (method !== 'GET' && method !== 'HEAD') ||
        request.headers.host !== host ||
        request.url !== expectedPath
      ) {
        response.writeHead(404).end();
        return;
      }
      const rawRange = request.headers.range;
      if (rawRange !== undefined && !/^bytes=\d*-\d*$/.test(rawRange)) {
        response.writeHead(400).end();
        return;
      }
      const aborted = new AbortController();
      const closed = () => aborted.abort();
      response.once('close', closed);
      const scope = AbortSignal.any([lifetime.signal, aborted.signal]);
      try {
        const content = await readMedia(rawRange ?? null, scope);
        if (scope.aborted || (!content.ok && content.status !== 206)) {
          await content.body?.cancel();
          if (!scope.aborted) {
            const status =
              content.status === 404 || content.status === 416 ? content.status : 502;
            response.writeHead(status).end();
          }
          return;
        }
        const headers: Record<string, string> = {
          'Cache-Control': 'no-store',
          'Content-Type': content.headers.get('content-type') || 'video/mp4',
        };
        for (const key of ['content-length', 'content-range', 'accept-ranges']) {
          const val = content.headers.get(key);
          if (val) headers[key] = val;
        }
        response.writeHead(content.status, headers);
        if (method === 'HEAD' || !content.body) {
          await content.body?.cancel();
          response.end();
        } else {
          await content.body.pipeTo(Writable.toWeb(response), { signal: scope });
        }
      } catch {
        if (response.destroyed || scope.aborted) return;
        if (response.headersSent) response.destroy();
        else response.writeHead(502).end();
      } finally {
        response.removeListener('close', closed);
      }
    },
    signal,
    filename,
  );
  expectedPath = relay.url.pathname;
  return { url: relay.url, close: relay.close };
}
