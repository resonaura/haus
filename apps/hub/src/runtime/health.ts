/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { runtimeConfig } from './config.js';

/** Use the same listener contract as startup, including NVR and explicit appliance ports. */
export async function checkHealth(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const config = await runtimeConfig(env);
  if (!config.port) throw Error('health_probe_requires_fixed_port');
  const address =
    config.address === '0.0.0.0' ? '127.0.0.1' : config.address === '::' ? '::1' : config.address;
  const host = address.includes(':') ? '[' + address + ']' : address;
  const response = await fetch(`http://${host}:${config.port}/health`, {
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
  });
  await response.body?.cancel();
  return response.ok;
}
