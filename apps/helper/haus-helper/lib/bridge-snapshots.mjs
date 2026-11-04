import { bridgeAddon, isBridgeProvider } from '@haus/kitsune/native';
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { privateIp } from '@haus/media/source';
import { directRecordingInput } from './recording-input.mjs';

/** Exact stream port/path and the Supervisor-verified host, never room/name heuristics. */
export function matchBridgeSnapshot(
  manifest,
  origin,
  source,
  sourceAddresses,
  providerAddresses = [],
) {
  if (
    manifest?.version !== 1 ||
    !isBridgeProvider(manifest.provider) ||
    !Array.isArray(manifest.cameras) ||
    manifest.cameras.length > 128
  )
    return;
  const base = new URL(origin),
    stream = new URL(source);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['rtsp:', 'rtsps:'].includes(stream.protocol) ||
    !sourceAddresses.some(
      (address) => address === base.hostname || providerAddresses.includes(address),
    ) ||
    !privateIp(base.hostname)
  )
    return;
  const paths = new Set();
  for (const camera of manifest.cameras) {
    if (
      camera.stream?.protocol !== stream.protocol ||
      camera.stream?.port !== Number(stream.port || (stream.protocol === 'rtsp:' ? 554 : 322)) ||
      camera.stream?.path !== stream.pathname
    )
      continue;
    if (
      typeof camera.snapshotPath !== 'string' ||
      !/^\/api\/cameras\/[a-zA-Z0-9_-]{1,128}\/snapshot\/last-live$/.test(camera.snapshotPath)
    )
      continue;
    paths.add(camera.snapshotPath);
  }
  if (paths.size === 1)
    return { version: 1, provider: manifest.provider, url: new URL([...paths][0], base).href };
}

/** Discover installed providers without giving them HA credentials or asking them to push images. */
export function bridgeSnapshotDiscovery(
  config,
  registry,
  { fetchRequest = fetch, resolve = lookup, now = Date.now } = {},
) {
  let pending,
    until = 0,
    providers = [];
  async function discover() {
    if (config.standalone || !config.token) return [];
    if (until > now()) return providers;
    if (pending) return pending;
    pending = (async () => {
      const get = async (path) => {
        const response = await fetchRequest(`http://supervisor${path}`, {
          headers: { Authorization: `Bearer ${config.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) throw Error('bridge_discovery_unavailable');
        return (await response.json()).data;
      };
      const found = [];
      let hostAddresses = [];
      try {
        const info = await get('/supervisor/info');
        try {
          const network = await get('/network/info');
          hostAddresses = (network?.interfaces ?? [])
            .flatMap((item) => item.ipv4?.address ?? [])
            .map((address) => String(address).split('/')[0])
            .filter((address) => isIP(address) && privateIp(address));
        } catch {}
        const apps = (info?.addons ?? [])
          .filter(
            (app) =>
              app.state === 'started' &&
              bridgeAddon(app.slug),
          )
          .slice(0, 8);
        await Promise.all(
          apps.map(async (app) => {
            try {
              const item = await get(`/addons/${app.slug}/info`);
              const host = item?.ip_address;
              const addon = bridgeAddon(app.slug, item.options), port = addon?.port;
              if (
                !isIP(host) ||
                !privateIp(host) ||
                !Number.isInteger(port) ||
                port < 1 ||
                port > 65535
              )
                return;
              // This origin is supplied by Supervisor, not by a camera or its URL.
              const origin = `http://${host.includes(':') ? '[' + host + ']' : host}:${port}`;
              const response = await fetchRequest(origin + '/api/haus/cameras', {
                redirect: 'error',
                signal: AbortSignal.timeout(2000),
              });
              if (!response.ok) {
                await response.body?.cancel();
                return;
              }
              const reader = response.body.getReader();
              let size = 0;
              const chunks = [];
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  size += value.length;
                  if (size > 65536) throw Error('bridge_manifest_too_large');
                  chunks.push(Buffer.from(value));
                }
              } finally {
                await reader.cancel().catch(() => {});
              }
              const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (manifest.provider !== addon?.provider)
                return;
              found.push({ origin, manifest, addresses: item.host_network ? hostAddresses : [] });
            } catch {
              /* Old providers simply lack this optional contract. */
            }
          }),
        );
      } catch {
        /* Standalone/HA outage keeps ordinary source fallback available. */
      }
      providers = found;
      until = now() + 60000;
      return providers;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return async (camera) => {
    const state = registry();
    const source = directRecordingInput(camera, state.states ?? [], state.entities ?? []);
    if (!source) return;
    const available = await discover();
    if (!available.length) return;
    const host = new URL(source).hostname;
    let timer;
    try {
      const addresses = isIP(host)
        ? [host]
        : (
            await Promise.race([
              resolve(host, { all: true }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('bridge_dns_timeout')), 1500);
              }),
            ])
          ).map((item) => item.address);
      const matches = available
        .map(({ manifest, origin, addresses: providerAddresses }) =>
          matchBridgeSnapshot(manifest, origin, source, addresses, providerAddresses),
        )
        .filter(Boolean);
      const unique = new Map(matches.map((item) => [JSON.stringify(item), item]));
      return unique.size === 1 ? [...unique.values()][0] : undefined;
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
  };
}
