/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { maxSatisfying, valid, validRange } from 'semver';
export interface PackageMetadata {
  name: string;
  version: string;
  main?: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scrypted?: { pluginDependencies?: string[]; name?: string; interfaces?: string[]; type?: string };
  dist: { tarball: string; integrity: string };
}
export const blockedPackages = new Set(['@scrypted/server', '@scrypted/sdk']);
export const packageName = (name: string) =>
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214;
export async function boundedFetch(url: string, maxBytes: number, fetchRequest = fetch) {
  const target = new URL(url);
  if (
    target.protocol !== 'https:' ||
    target.hostname !== 'registry.npmjs.org' ||
    target.username ||
    target.password
  )
    throw Error('kitsune_untrusted_registry');
  const response = await fetchRequest(target, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`kitsune_registry_${response.status}`);
  }
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw Error('kitsune_download_limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('kitsune_empty_download');
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > maxBytes) throw Error('kitsune_download_limit');
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}
export interface Packument {
  'dist-tags': Record<string, string>;
  versions: Record<string, PackageMetadata>;
}

/**
 * Fetches and memoizes full package metadata within a single install pass so
 * shared transitive dependencies do not re-download multi-megabyte packuments.
 */
export function fetchPackument(
  name: string,
  fetchRequest = fetch,
  cache?: Map<string, Promise<Packument>>,
): Promise<Packument> {
  if (!packageName(name) || blockedPackages.has(name)) throw Error('kitsune_forbidden_package');
  const cached = cache?.get(name);
  if (cached) return cached;
  const request = boundedFetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    32 * 1024 ** 2,
    fetchRequest,
  )
    .then((bytes) => JSON.parse(bytes.toString()) as Packument)
    .catch((err) => {
      cache?.delete(name);
      throw err;
    });
  cache?.set(name, request);
  return request;
}

export async function resolvePackage(
  name: string,
  range = 'latest',
  fetchRequest = fetch,
  cache?: Map<string, Promise<Packument>>,
): Promise<PackageMetadata> {
  const packument = await fetchPackument(name, fetchRequest, cache);
  const version =
    valid(range) ??
    packument['dist-tags']?.[range] ??
    (validRange(range) ? maxSatisfying(Object.keys(packument.versions ?? {}), range) : undefined);
  const result = version && packument.versions?.[version];
  if (!result || result.name !== name || result.version !== version || !result.dist?.integrity)
    throw Error('kitsune_package_version_unavailable');
  return result;
}
export function verifyIntegrity(bytes: Buffer, integrity: string) {
  const expected = integrity.split(/\s+/).find((value) => value.startsWith('sha512-'));
  if (!expected) throw Error('kitsune_missing_sha512');
  const hash = createHash('sha512').update(bytes).digest(),
    target = Buffer.from(expected.slice(7), 'base64');
  if (hash.length !== target.length || !timingSafeEqual(hash, target))
    throw Error('kitsune_integrity_mismatch');
}
