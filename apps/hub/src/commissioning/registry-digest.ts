/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { isIP } from 'node:net';

export interface ParsedOciReference {
  readonly registry: string;
  readonly repository: string;
  readonly reference: string;
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const NETWORK_TIMEOUT_MS = 2_500;
const DIGEST_RE = /sha256:[a-f0-9]{64}/i;

/** Parse an OCI image reference (`ghcr.io/owner/repo:latest`, etc.) into registry/repo/tag. */
export function parseOciImageReference(imageRef: string): ParsedOciReference | undefined {
  const raw = imageRef.trim().split('@')[0]?.trim();
  if (!raw) return undefined;

  const firstSlash = raw.indexOf('/');
  let registry = 'registry-1.docker.io';
  let remainder = raw;
  if (firstSlash > 0) {
    const first = raw.slice(0, firstSlash);
    if (first.includes('.') || first.includes(':') || first === 'localhost') {
      registry = first === 'docker.io' ? 'registry-1.docker.io' : first;
      remainder = raw.slice(firstSlash + 1);
    }
  }
  if (!remainder.includes('/') && registry === 'registry-1.docker.io') {
    remainder = `library/${remainder}`;
  }

  const lastColon = remainder.lastIndexOf(':');
  const lastSlash = remainder.lastIndexOf('/');
  const hasTag = lastColon > lastSlash;
  const repository = hasTag ? remainder.slice(0, lastColon) : remainder;
  const reference = hasTag ? remainder.slice(lastColon + 1) : 'latest';
  if (!repository || !reference) return undefined;
  return { registry, repository, reference };
}

/** Extract lowercase `sha256:<hex>` digest from a Docker repoDigest or digest header. */
export function normalizeDigest(value?: string): string | undefined {
  if (!value) return undefined;
  const match = DIGEST_RE.exec(value);
  return match ? match[0].toLowerCase() : undefined;
}

function isSafeRegistryHost(registry: string): boolean {
  const host = registry.split(':')[0]?.toLowerCase() ?? '';
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  return isIP(host) === 0;
}

function parseBearerChallenge(
  header: string | null,
): { realm: string; service?: string; scope?: string } | undefined {
  if (!header || !/^bearer\s+/i.test(header)) return undefined;
  const params: Record<string, string> = {};
  for (const match of header.matchAll(/([a-zA-Z]+)="([^"]*)"/g)) {
    const [, key, value] = match;
    if (key && value !== undefined) params[key.toLowerCase()] = value;
  }
  if (!params.realm) return undefined;
  try {
    const realmUrl = new URL(params.realm);
    if (realmUrl.protocol !== 'https:' || !isSafeRegistryHost(realmUrl.hostname)) {
      return undefined;
    }
    return { realm: realmUrl.toString(), service: params.service, scope: params.scope };
  } catch {
    return undefined;
  }
}

async function fetchRegistryManifest(
  parsed: ParsedOciReference,
  method: 'HEAD' | 'GET',
  fetchImpl: typeof fetch,
  token?: string,
): Promise<Response> {
  const url = `https://${parsed.registry}/v2/${parsed.repository}/manifests/${encodeURIComponent(parsed.reference)}`;
  const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetchImpl(url, {
    method,
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
}

async function resolveBearerToken(
  challenge: { realm: string; service?: string; scope?: string },
  parsed: ParsedOciReference,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const tokenUrl = new URL(challenge.realm);
  if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
  tokenUrl.searchParams.set('scope', challenge.scope || `repository:${parsed.repository}:pull`);
  const res = await fetchImpl(tokenUrl.toString(), {
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { token?: unknown; access_token?: unknown };
  if (typeof json.token === 'string' && json.token) return json.token;
  if (typeof json.access_token === 'string' && json.access_token) return json.access_token;
  return undefined;
}

/** Check an upstream OCI registry for a newer `:latest` manifest digest than `installedDigest`. */
export async function checkRemoteImageUpdate(
  imageRef: string,
  installedDigestOrId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ updateAvailable: boolean; remoteDigest?: string }> {
  const installedDigest = normalizeDigest(installedDigestOrId);
  if (!installedDigest) return { updateAvailable: false };

  const parsed = parseOciImageReference(imageRef);
  if (!parsed || !isSafeRegistryHost(parsed.registry)) return { updateAvailable: false };

  let bearerToken: string | undefined;
  let headRes = await fetchRegistryManifest(parsed, 'HEAD', fetchImpl);
  if (headRes.status === 401) {
    const challenge = parseBearerChallenge(headRes.headers.get('www-authenticate'));
    if (!challenge) return { updateAvailable: false };
    bearerToken = await resolveBearerToken(challenge, parsed, fetchImpl);
    if (!bearerToken) return { updateAvailable: false };
    headRes = await fetchRegistryManifest(parsed, 'HEAD', fetchImpl, bearerToken);
  }
  if (!headRes.ok) return { updateAvailable: false };

  const remoteDigest = normalizeDigest(headRes.headers.get('docker-content-digest') ?? undefined);
  if (!remoteDigest) return { updateAvailable: false };
  if (remoteDigest === installedDigest) {
    return { updateAvailable: false, remoteDigest };
  }

  // If installed Digest is a platform child digest rather than the multi-arch index digest,
  // inspect child manifest digests to avoid false update notifications.
  try {
    const indexRes = await fetchRegistryManifest(parsed, 'GET', fetchImpl, bearerToken);
    if (indexRes.ok) {
      const text = await indexRes.text();
      if (text.length <= 131_072) {
        const body = JSON.parse(text) as { manifests?: Array<{ digest?: unknown }> };
        if (
          Array.isArray(body.manifests) &&
          body.manifests.some(
            (m) =>
              normalizeDigest(typeof m?.digest === 'string' ? m.digest : undefined) ===
              installedDigest,
          )
        ) {
          return { updateAvailable: false, remoteDigest };
        }
      }
    }
  } catch {
    // Keep HEAD digest comparison when index body check fails.
  }

  return { updateAvailable: true, remoteDigest };
}
