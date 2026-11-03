/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { request } from 'node:http';
import { discoverProviderBridges } from './provider-discovery.mjs';

/** Local pairing codes never pass through the renderer or an unverified multicast endpoint. */
export function loopbackProviderJson(port, path, post = false) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: post ? 'POST' : 'GET',
        headers: { 'X-Haus-Client': '1', ...(post ? { 'Content-Type': 'application/json' } : {}) },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.destroy();
          reject(Error('managed_provider_unavailable'));
          return;
        }
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
          if (Buffer.byteLength(text) > 4096)
            req.destroy(Error('invalid_managed_provider_response'));
        });
        res.on('error', () => reject(Error('managed_provider_unavailable')));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(Error('invalid_managed_provider_response'));
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(Error('managed_provider_unavailable')), 3000);
    req.on('error', () => reject(Error('managed_provider_unavailable')));
    req.on('close', () => clearTimeout(timer));
    req.end(post ? '{}' : undefined);
  });
}
export async function connectManagedProvider(
  config,
  providers,
  bridgeId,
  { discover = discoverProviderBridges, local = loopbackProviderJson } = {},
) {
  if (config.standalone || !config.token) throw Error('managed_provider_unavailable');
  const hint = (await discover(config)).find(
    (item) => item.bridgeId === bridgeId && item.source === 'supervisor' && item.managed,
  );
  if (!hint) throw Error('managed_provider_unavailable');
  const port = Number(new URL(hint.url).port);
  const info = await local(port, '/api/haus/v2/info');
  if (info.version !== 2 || info.bridgeId !== hint.bridgeId || info.provider !== hint.provider)
    throw Error('invalid_managed_provider_identity');
  const { code } = await local(port, '/api/haus/v2/pairing', true);
  if (!/^[a-f0-9]{48}$/.test(code)) throw Error('invalid_managed_provider_response');
  return providers.add({ url: hint.url, code, allowHttp: true });
}
