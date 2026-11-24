/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { expect, it, vi } from 'vitest';
import { openLocalHlsRelay, openLocalMediaRelay } from '../../src/stream/relay.js';

it('serves only the scoped HLS assets and closes the listener when playback stops', async () => {
  const manifest = '#EXTM3U\n#EXTINF:1.0,\nsegment-1.ts\n';
  const segment = new Uint8Array([0x47, 0x68]);
  const controller = new AbortController();
  const readAsset = vi.fn(
    async (name: string) => new Response(name.endsWith('.ts') ? segment : manifest),
  );
  const relay = await openLocalHlsRelay(readAsset, controller.signal);
  try {
    expect((await fetch(new URL('/index.m3u8', relay.url))).status).toBe(404);
    expect((await fetch(new URL('index.m3u8?other=foo', relay.url))).status).toBe(404);
    expect(readAsset).not.toHaveBeenCalled();
    expect(await (await fetch(relay.url)).text()).toBe(manifest);
    const media = await fetch(new URL('segment-1.ts', relay.url));
    expect(media.headers.get('content-type')).toBe('video/mp2t');
    expect(new Uint8Array(await media.arrayBuffer())).toEqual(segment);
    controller.abort();
    await relay.close();
    await expect(fetch(relay.url)).rejects.toThrow();
  } finally {
    await relay.close();
  }
});

it('serves recorded media with Range forwarding and rejects bad paths or ranges', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const readMedia = vi.fn(async (range: string | null) => {
    if (range === 'bytes=2-4') {
      return new Response(bytes.subarray(2, 5), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 2-4/6',
          'content-length': '3',
          'accept-ranges': 'bytes',
        },
      });
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } });
  });
  const relay = await openLocalMediaRelay(readMedia, new AbortController().signal);
  try {
    expect((await fetch(new URL('/clip.mp4', relay.url))).status).toBe(404);
    expect((await fetch(relay.url, { headers: { Range: 'bytes=invalid' } })).status).toBe(400);
    expect(readMedia).not.toHaveBeenCalled();

    const ranged = await fetch(relay.url, { headers: { Range: 'bytes=2-4' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.subarray(2, 5));
    expect(readMedia).toHaveBeenCalledTimes(1);

    await relay.close();
    await expect(fetch(relay.url)).rejects.toThrow();
  } finally {
    await relay.close();
  }
});

it.each([
  '#EXTM3U\nhttps://elsewhere.invalid/segment.ts\n',
  '#EXTM3U\n../other-camera/segment.ts\n',
  '#EXTM3U\n#EXT-X-MAP:URI="//elsewhere.invalid/init.mp4"\nsegment.m4s\n',
  '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="file:///private.key"\nsegment.ts\n',
])('refuses a manifest that would send the decoder away from its relay', async (manifest) => {
  const readAsset = vi.fn(async () => new Response(manifest));
  const relay = await openLocalHlsRelay(readAsset, new AbortController().signal);
  try {
    const response = await fetch(relay.url);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
    expect(readAsset).toHaveBeenCalledOnce();
  } finally {
    await relay.close();
  }
});

it('serves recorded media with Range forwarding and rejects bad paths or ranges', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const readMedia = vi.fn(async (range: string | null) => {
    if (range === 'bytes=2-4') {
      return new Response(bytes.subarray(2, 5), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 2-4/6',
          'content-length': '3',
          'accept-ranges': 'bytes',
        },
      });
    }
    return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } });
  });
  const relay = await openLocalMediaRelay(readMedia, new AbortController().signal);
  try {
    expect((await fetch(new URL('/clip.mp4', relay.url))).status).toBe(404);
    expect((await fetch(relay.url, { headers: { Range: 'bytes=invalid' } })).status).toBe(400);
    expect(readMedia).not.toHaveBeenCalled();

    const ranged = await fetch(relay.url, { headers: { Range: 'bytes=2-4' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 2-4/6');
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(bytes.subarray(2, 5));
    expect(readMedia).toHaveBeenCalledTimes(1);

    await relay.close();
    await expect(fetch(relay.url)).rejects.toThrow();
  } finally {
    await relay.close();
  }
});
