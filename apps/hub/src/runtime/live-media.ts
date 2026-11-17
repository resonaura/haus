/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { networkInterfaces } from 'node:os';
import { privateIp, type LocalCameraNode } from '../camera/sessions/types.js';
import type { NvrOptions } from '../nvr/transport/types.js';
import { hubMdnsAddresses } from './discovery.js';

/** The HTTP hop uses the local listener; ICE advertises a reachable host address. */
export function localCameraNode(
  nvr: NvrOptions | undefined,
  port: number | undefined,
  bind: string,
  env: NodeJS.ProcessEnv,
  interfaces = networkInterfaces(),
): LocalCameraNode | undefined {
  const cameras = nvr?.cameras;
  if (!nvr || !cameras || !port || !nvr.roles?.includes('stream')) return undefined;
  const assigned = new Set(
    Object.values(interfaces)
      .flatMap((addresses) => addresses ?? [])
      .map(({ address }) => address)
      .filter(privateIp),
  );
  const isWildcard = bind === '0.0.0.0' || bind === '::';
  let advertised: string | undefined;
  try {
    advertised = isWildcard
      ? hubMdnsAddresses(env, assigned, interfaces)[0]
      : assigned.has(bind)
        ? bind
        : undefined;
  } catch {
    // An invalid discovery address must not disable Hub HTTP or recording.
    return undefined;
  }
  if (!advertised) return undefined;
  const host = bind === '::' ? '[::1]' : isWildcard ? '127.0.0.1' : bind;
  return {
    node: {
      id: 'local-camera-runtime',
      url: `http://${host}:${port}`,
      key: nvr.key,
      enabled: true,
      allowHttp: true,
      roles: ['stream'],
    },
    advertiseAddress: advertised,
    status: () => cameras.status(),
  };
}
