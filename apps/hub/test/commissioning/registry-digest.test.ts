/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { describe, expect, it } from 'vitest';
import {
  checkRemoteImageUpdate,
  parseOciImageReference,
} from '../../src/commissioning/registry-digest.js';

const DIGEST_OLD = 'sha256:' + 'a'.repeat(64);
const DIGEST_NEW = 'sha256:' + 'b'.repeat(64);
const DIGEST_CHILD = 'sha256:' + 'c'.repeat(64);

describe('OCI Registry Mutable :latest Digest Checks', () => {
  it('parses ghcr.io and docker library references accurately', () => {
    expect(parseOciImageReference('ghcr.io/resonaura/tuya-rtsp-bridge:latest')).toEqual({
      registry: 'ghcr.io',
      repository: 'resonaura/tuya-rtsp-bridge',
      reference: 'latest',
    });
    expect(parseOciImageReference('nginx:latest')).toEqual({
      registry: 'registry-1.docker.io',
      repository: 'library/nginx',
      reference: 'latest',
    });
  });

  it('handles GHCR bearer auth challenge and detects newer :latest digest', async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://ghcr.io/v2/resonaura/tuya-rtsp-bridge/manifests/latest') {
        const auth = new Headers(init?.headers).get('authorization');
        if (!auth) {
          return new Response('', {
            status: 401,
            headers: {
              'www-authenticate':
                'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:resonaura/tuya-rtsp-bridge:pull"',
            },
          });
        }
        if (init?.method === 'HEAD') {
          return new Response('', {
            status: 200,
            headers: { 'docker-content-digest': DIGEST_NEW },
          });
        }
        return new Response(JSON.stringify({ manifests: [{ digest: DIGEST_CHILD }] }), {
          status: 200,
        });
      }
      if (url.startsWith('https://ghcr.io/token?')) {
        return new Response(JSON.stringify({ token: 'anon-pull-tok' }), { status: 200 });
      }
      return new Response('', { status: 404 });
    };

    const updated = await checkRemoteImageUpdate(
      'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
      `ghcr.io/resonaura/tuya-rtsp-bridge@${DIGEST_OLD}`,
      fetchMock as unknown as typeof fetch,
    );
    expect(updated).toEqual({ updateAvailable: true, remoteDigest: DIGEST_NEW });

    const upToDate = await checkRemoteImageUpdate(
      'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
      `ghcr.io/resonaura/tuya-rtsp-bridge@${DIGEST_NEW}`,
      fetchMock as unknown as typeof fetch,
    );
    expect(upToDate).toEqual({ updateAvailable: false, remoteDigest: DIGEST_NEW });

    const childMatch = await checkRemoteImageUpdate(
      'ghcr.io/resonaura/tuya-rtsp-bridge:latest',
      `ghcr.io/resonaura/tuya-rtsp-bridge@${DIGEST_CHILD}`,
      fetchMock as unknown as typeof fetch,
    );
    expect(childMatch).toEqual({ updateAvailable: false, remoteDigest: DIGEST_NEW });
  });
});
