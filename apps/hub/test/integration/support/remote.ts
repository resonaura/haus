/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isAbsolute } from 'node:path';

export interface RemoteTarget {
  keyFile: string;
  url(path: string): URL;
}

const protocolPath = /^\/(?:v1|media)\//;

/** Remote writes require an explicitly provisioned disposable target, never just a discovered URL. */
export function remoteTarget(env: NodeJS.ProcessEnv): RemoteTarget | undefined {
  if (env.HAUS_NVR_TEST_DISPOSABLE !== '1') return undefined;
  const address = env.HAUS_NVR_TEST_URL,
    keyFile = env.HAUS_NVR_TEST_KEY_FILE;
  if (!address || !keyFile || !isAbsolute(keyFile))
    throw Error('disposable_fixture_origin_and_absolute_key_required');
  const base = new URL(address);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw Error('invalid_disposable_fixture_origin');
  return {
    keyFile,
    url(path: string): URL {
      if (!protocolPath.test(path) || path.includes('\\') || path.length > 8192)
        throw Error('invalid_fixture_path');
      const url = new URL(path, base);
      if (
        url.origin !== base.origin ||
        url.username ||
        url.password ||
        url.hash ||
        !protocolPath.test(url.pathname)
      )
        throw Error('invalid_fixture_path');
      return url;
    },
  };
}
