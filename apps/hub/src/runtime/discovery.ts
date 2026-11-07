/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';

interface ServiceOptions {
  name: string;
  type: string;
  port: number;
  txt: Record<string, string>;
  restrictedAddresses: string[];
  disabledIpv6: boolean;
}
interface Responder {
  createService(options: ServiceOptions): { advertise(): Promise<void> };
  shutdown(): Promise<void>;
}
export interface DiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  port?: number;
  signal?: AbortSignal;
  ciao?: { getResponder(): Responder };
  getLocalAddresses?: () => Set<string>;
}
function privateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
export function nvrMdnsConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): { addresses: string[] } | undefined {
  if (!/^(1|true)$/i.test(env.HAUS_MDNS_ADVERTISE || '')) return undefined;
  const addresses = (env.HAUS_MDNS_ADDRESS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!addresses.length || addresses.some((value) => !privateIpv4(value)))
    throw Error('Set HAUS_MDNS_ADDRESS to one or more private IPv4 addresses on the host network.');
  return { addresses: [...new Set(addresses)] };
}

/** Discovery is an explicit non-secret hint, never proof of Hub identity. */
export async function startNvrMdnsAdvertisement(
  options: DiscoveryOptions = {},
): Promise<(() => Promise<void>) | undefined> {
  const env = options.env ?? process.env,
    configuration = nvrMdnsConfiguration(env);
  if (!configuration) return undefined;
  options.signal?.throwIfAborted();
  const port = options.port ?? Number(env.PORT || 8098);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw Error('The Haus NVR discovery port is invalid.');
  const local =
    options.getLocalAddresses?.() ??
    new Set(
      Object.values(networkInterfaces())
        .flatMap((values) => values ?? [])
        .map((value) => value.address),
    );
  if (configuration.addresses.some((value) => !local.has(value)))
    throw Error(
      'HAUS_MDNS_ADDRESS must match a private IPv4 address assigned to this host network.',
    );
  const library = options.ciao ?? (await import('@homebridge/ciao'));
  options.signal?.throwIfAborted();
  const responder = library.getResponder();
  let stopped: Promise<void> | undefined;
  const stop = () => {
    stopped ??= Promise.resolve().then(() => responder.shutdown());
    return stopped;
  };
  let abort: (() => void) | undefined;
  try {
    const service = responder.createService({
      name: 'Haus NVR',
      type: 'haus-nvr',
      port,
      txt: { protocol: '1' },
      restrictedAddresses: configuration.addresses,
      disabledIpv6: true,
    });
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        void stop().then(
          () => reject(options.signal?.reason ?? Error('discovery_cancelled')),
          (error) => reject(error),
        );
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
    await Promise.race([service.advertise(), interrupted]);
    options.signal?.throwIfAborted();
    return stop;
  } catch (error) {
    try {
      await stop();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'discovery_start_failed');
    }
    throw error;
  } finally {
    if (abort) options.signal?.removeEventListener('abort', abort);
  }
}
