/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { cameraFailureCodes, cameraFailureCode } from '@haus/media/camera';

export { cameraFailureCode };

export const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function sign(
  key: string,
  method: string,
  path: string,
  digest = EMPTY_DIGEST,
  now = Date.now(),
  nonce = randomBytes(16).toString('hex'),
) {
  const time = String(now);
  const signature = createHmac('sha256', key)
    .update([method, path, time, nonce, digest].join('\n'))
    .digest('hex');
  return {
    'x-haus-time': time,
    'x-haus-nonce': nonce,
    'x-haus-digest': digest,
    'x-haus-signature': signature,
  };
}

export function authenticator(key: string, clock = () => Date.now()) {
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32)
    throw new Error('A unique node key of at least 32 bytes is required');
  const nonces = new Map<string, number>();
  return (req: { method?: string; url?: string; headers: Record<string, string | undefined> }) => {
    const time = req.headers['x-haus-time'],
      nonce = req.headers['x-haus-nonce'],
      digest = req.headers['x-haus-digest'],
      signature = req.headers['x-haus-signature'];
    const now = clock();
    if (
      !time ||
      !nonce ||
      !digest ||
      !signature ||
      !/^\d{13}$/.test(time) ||
      Math.abs(now - Number(time)) > 60000 ||
      !/^[a-f0-9]{32}$/.test(nonce) ||
      !/^[a-f0-9]{64}$/.test(digest) ||
      !/^[a-f0-9]{64}$/.test(signature)
    )
      return false;
    for (const [id, at] of nonces) if (now - at > 65000) nonces.delete(id);
    if (nonces.has(nonce) || nonces.size >= 10000) return false;
    const expected = sign(key, req.method ?? 'POST', req.url ?? '', digest, Number(time), nonce)[
      'x-haus-signature'
    ];
    try {
      const match = timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
      if (match) nonces.set(nonce, now);
      return match;
    } catch {
      return false;
    }
  };
}

const privateAddress = (ip: string) =>
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
  ip === '::1' ||
  /^(fc|fd)[a-f0-9:]+$/i.test(ip);

export function nodeAddress(value: string, allowHttp = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid_node_address');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.hostname === '169.254.169.254' ||
    (url.protocol === 'http:' && !allowHttp)
  )
    throw new Error('invalid_node_address');
  return url.origin;
}

export async function nodeRequest(
  node: { url: string; key: string; allowHttp?: boolean },
  path: string,
  {
    method = 'GET',
    data,
    file,
    digest = EMPTY_DIGEST,
    length,
    signal,
    headers = {},
    timeout = 60000,
    headerTimeout,
  }: {
    method?: string;
    data?: unknown;
    file?: string;
    digest?: string;
    length?: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    timeout?: number;
    headerTimeout?: number;
  } = {},
) {
  const origin = nodeAddress(node.url, node.allowHttp);
  const url = new URL(origin);
  const target = new URL(path, origin);
  let resolvedHeaders = { ...headers };
  if (url.protocol === 'http:') {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addresses.length || addresses.some((item) => !privateAddress(item.address)))
      throw new Error('invalid_private_node_address');
    target.hostname = addresses[0].address.includes(':')
      ? `[${addresses[0].address}]`
      : addresses[0].address;
    resolvedHeaders = { ...resolvedHeaders, Host: url.host };
  }
  let body: BodyInit | undefined;
  if (data !== undefined) {
    body = JSON.stringify(data);
    digest = createHash('sha256').update(body).digest('hex');
  }
  if (file) body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  signal?.throwIfAborted();
  const headersDeadline = new AbortController();
  const timer = headerTimeout
    ? setTimeout(() => headersDeadline.abort(), headerTimeout)
    : undefined;
  try {
    return await fetch(target, {
      method,
      body,
      // @ts-expect-error Node fetch duplex option
      duplex: body ? 'half' : undefined,
      headers: {
        ...sign(node.key, method, path, digest),
        ...resolvedHeaders,
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(file ? { 'Content-Length': String(length) } : {}),
      },
      signal: AbortSignal.any([
        AbortSignal.timeout(timeout),
        headersDeadline.signal,
        ...(signal ? [signal] : []),
      ]),
      redirect: 'error',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function nodeJson(
  node: { url: string; key: string; allowHttp?: boolean },
  path: string,
  options?: Parameters<typeof nodeRequest>[2],
) {
  const response = await nodeRequest(node, path, options);
  if (!response.ok) {
    throw await nodeApiError(response);
  }
  const text = await response.text();
  if (text.length > 1000000) throw new Error('invalid_node_response');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid_node_response');
  }
}

export async function nodeApiError(response: Response) {
  const error = Object.assign(
    new Error(
      response.status === 401 ? 'invalid_node_key_or_clock' : `Node returned ${response.status}`,
    ),
    { status: response.status, code: undefined as string | undefined },
  );
  const reader = response.body?.getReader();
  if (!reader) return error;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) return error;
      chunks.push(Buffer.from(value));
    }
    const code = JSON.parse(Buffer.concat(chunks).toString('utf8')).error;
    if (cameraFailureCodes.has(code)) error.code = code;
  } catch {
    // Keep generic error if body parsing fails
  } finally {
    await reader.cancel().catch(() => {});
  }
  return error;
}
