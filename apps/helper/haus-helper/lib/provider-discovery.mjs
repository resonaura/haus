import { bridgeAddon, isBridgeProvider } from '@haus/kitsune/native';
/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isIP } from 'node:net';
import { discoverCameraBridges } from '@haus/bridge/discovery';
import { cameraBridgeEndpoint, bridgeJson } from '@haus/bridge/client';

/** Supervisor hints plus LAN advertisements; neither pairing nor MQTT ownership is granted here. */
export async function discoverProviderBridges(
  config,
  {
    scan = discoverCameraBridges,
    fetchRequest = fetch,
    endpoint = cameraBridgeEndpoint,
    request = bridgeJson,
    duration = 3500,
  } = {},
) {
  const hints = new Map();
  const add = (value) => {
    if (hints.size < 16 && typeof value.url === 'string') hints.set(value.url, value);
  };
  const mdns = new Promise((resolve) => {
    let stop = () => {};
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stop();
      resolve();
    };
    const timer = setTimeout(finish, duration);
    try {
      stop = scan({
        onFound: add,
        onError: () => {
          clearTimeout(timer);
          finish();
        },
        timeoutMs: Math.max(1000, duration),
      });
      if (finished) stop();
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
  const supervisor = (async () => {
    if (config.standalone || !config.token) return;
    const get = async (path) => {
      const response = await fetchRequest('http://supervisor' + path, {
        headers: { Authorization: `Bearer ${config.token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw Error('provider_discovery_unavailable');
      return (await response.json()).data;
    };
    try {
      const info = await get('/supervisor/info');
      await Promise.all(
        (info.addons ?? [])
          .filter(
            (addon) =>
              addon.state === 'started' &&
              bridgeAddon(addon.slug),
          )
          .slice(0, 8)
          .map(async (addon) => {
            try {
              const info = await get(`/addons/${addon.slug}/info`),
                address = info.ip_address;
              if (!isIP(address)) return;
              const { provider, port } = bridgeAddon(addon.slug, info.options) ?? {};
              if (!Number.isInteger(port) || port < 1 || port > 65535) return;
              add({
                url: `http://${address.includes(':') ? '[' + address + ']' : address}:${port}`,
                provider,
                source: 'supervisor',
                addonSlug: addon.slug,
                managed: info.host_network === true,
              });
            } catch {
              /* Unavailable add-ons do not prevent other LAN discovery. */
            }
          }),
      );
    } catch {
      /* Manual URL and multicast remain usable without Supervisor. */
    }
  })();
  await Promise.all([mdns, supervisor]);
  const found = [];
  const candidates = [...hints.values()];
  for (let offset = 0; offset < candidates.length; offset += 4)
    await Promise.all(
      candidates.slice(offset, offset + 4).map(async (hint) => {
        try {
          const target = await endpoint(hint.url, true),
            info = await request(target, '/api/haus/v2/info', { timeout: 2500 });
          if (
            info?.version !== 2 ||
            !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(info.bridgeId) ||
            !isBridgeProvider(info.provider) ||
            (hint.bridgeId && hint.bridgeId !== info.bridgeId) ||
            (hint.provider && hint.provider !== info.provider)
          )
            return;
          const name =
            typeof info.name === 'string'
              ? [...info.name]
                  .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
                  .join('')
                  .slice(0, 128)
              : 'Camera bridge';
          found.push({
            bridgeId: info.bridgeId,
            provider: info.provider,
            name,
            url: target.url,
            source: hint.source ?? 'mdns',
            ...(hint.source === 'supervisor'
              ? { addonSlug: hint.addonSlug, managed: hint.managed === true }
              : {}),
            paired: false,
          });
        } catch {
          /* Older providers without native enrollment remain on their existing path. */
        }
      }),
    );
  // Keep Supervisor's proof when the same bridge also advertises over multicast.
  return [
    ...new Map(
      found
        .sort((a, b) => Number(a.source === 'supervisor') - Number(b.source === 'supervisor'))
        .map((item) => [item.bridgeId, item]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
