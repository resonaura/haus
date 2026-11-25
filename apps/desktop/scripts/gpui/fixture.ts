/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { HausHelper } from '../../src/main/helper.js';

export const camera = 'camera.video_fixture';
const route = `/api/cameras/${camera}`;

function freezePlaylist(manifest: string): string {
  const lines = manifest.split(/\r?\n/);
  const fifthSegment = lines.flatMap((line, i) => (line.startsWith('#EXTINF:') ? [i] : []))[4];
  assert(fifthSegment !== undefined, 'The recovery fixture requires at least five HLS segments.');
  return `${lines
    .slice(0, fifthSegment)
    .filter((line) => !line.startsWith('#EXT-X-PLAYLIST-TYPE:'))
    .join('\n')}\n`;
}

export async function openCameraFixture(
  directory: string,
  { stallFirst = false, holdFirstRelease = false } = {},
) {
  const token = randomUUID();
  const stalledManifest = stallFirst
    ? freezePlaylist(await readFile(join(directory, 'index.m3u8'), 'utf8'))
    : undefined;
  const owners = new Set<string>();
  let owner: string | undefined;
  let servedSegments = 0;
  let activationRequests = 0;
  let activations = 0;
  let releases = 0;
  let overlappingOwners = false;
  const firstRelease = Promise.withResolvers<void>();
  const allowRelease = Promise.withResolvers<void>();
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === `${route}/warm` && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 2048) throw new Error('Invalid fixture lease.');
      }
      const data: unknown = JSON.parse(body);
      assert(data && typeof data === 'object' && 'owner' in data && typeof data.owner === 'string');
      const active = 'active' in data && data.active === true;
      if (active) {
        activationRequests++;
        if (owner && owner !== data.owner) overlappingOwners = true;
        assert(!owner || owner === data.owner, 'Two warm owners overlapped.');
        if (!owner) activations++;
        owner = data.owner;
        owners.add(owner);
      } else if (data.owner === owner) {
        if (holdFirstRelease && releases === 0) {
          firstRelease.resolve();
          await allowRelease.promise;
        }
        owner = undefined;
        releases++;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          warm: active,
          streamPath: `${route}/live/index.m3u8`,
        }),
      );
      return;
    }
    const prefix = `${route}/live/`;
    const asset = request.url?.startsWith(prefix) ? request.url.slice(prefix.length) : '';
    if (request.method === 'GET' && owner && /^(index\.m3u8|[A-Za-z0-9_-]+\.ts)$/.test(asset)) {
      const content =
        asset === 'index.m3u8' && activations === 1 && stalledManifest
          ? stalledManifest
          : await readFile(join(directory, asset));
      if (asset.endsWith('.ts')) ++servedSegments;
      response
        .writeHead(200, {
          'Content-Type': asset.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl',
        })
        .end(content);
      return;
    }
    response.writeHead(404).end();
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    firstRelease: firstRelease.promise,
    allowRelease: allowRelease.resolve,
    activationRequests: () => activationRequests,
    activeLeasesTaken: () => activations,
    viewer: () =>
      new HausHelper({
        connected: true,
        isHub: true,
        serverUrl: url,
        credentialScope: url,
        async addonSurface() {
          return { url: `${url}/`, token, title: 'Camera fixture' };
        },
        async request() {
          throw new Error('Unexpected fixture command.');
        },
      }),
    verified: () =>
      servedSegments > 0 &&
      !overlappingOwners &&
      owners.size === (holdFirstRelease ? 2 : 1) &&
      activations === (stallFirst || holdFirstRelease ? 2 : 1) &&
      releases === activations,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
