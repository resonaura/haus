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

interface Advertisement {
  name: string;
  type: string;
  txt: Record<string, string>;
  addresses: string[];
  port: number;
}

/** Discovery is an explicit non-secret hint, never proof of Hub identity. */
async function advertise(
  advertisements: readonly Advertisement[],
  options: DiscoveryOptions,
): Promise<() => Promise<void>> {
  options.signal?.throwIfAborted();
  if (advertisements.some(({ port }) => !Number.isSafeInteger(port) || port < 1 || port > 65535))
    throw Error('The Haus discovery port is invalid.');
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
    const services = advertisements.map((advertisement) =>
      responder.createService({
        name: advertisement.name,
        type: advertisement.type,
        port: advertisement.port,
        txt: advertisement.txt,
        restrictedAddresses: advertisement.addresses,
        disabledIpv6: true,
      }),
    );
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
    await Promise.race([Promise.all(services.map((service) => service.advertise())), interrupted]);
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

function localAddresses(options: DiscoveryOptions): Set<string> {
  return (
    options.getLocalAddresses?.() ??
    new Set(
      Object.values(networkInterfaces())
        .flatMap((values) => values ?? [])
        .map((value) => value.address),
    )
  );
}

/** Advertises the NVR role on its explicitly configured host addresses. */
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
  if (configuration.addresses.some((value) => !localAddresses(options).has(value)))
    throw Error(
      'HAUS_MDNS_ADDRESS must match a private IPv4 address assigned to this host network.',
    );
  return advertise(
    [
      {
        name: 'Haus NVR',
        type: 'haus-nvr',
        port,
        txt: { protocol: '1' },
        addresses: configuration.addresses,
      },
    ],
    options,
  );
}

/**
 * Hub addresses come from HAUS_MDNS_ADDRESS when set, otherwise every private
 * IPv4 on the host network. `HAUS_MDNS_ADVERTISE=0` disables advertising.
 */
export function hubMdnsAddresses(
  env: NodeJS.ProcessEnv,
  local: Set<string>,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  const configured = (env.HAUS_MDNS_ADDRESS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length) {
    if (configured.some((value) => !privateIpv4(value) || !local.has(value)))
      throw Error('HAUS_MDNS_ADDRESS must match a private IPv4 address assigned to this host.');
    return [...new Set(configured)];
  }
  return [
    ...new Set(
      Object.values(interfaces)
        .flatMap((values) => values ?? [])
        .filter((value) => value.family === 'IPv4' && !value.internal)
        .map((value) => value.address)
        .filter(privateIpv4),
    ),
  ];
}

/** Advertises `_haus-hub._tcp` so clients find the Hub; pairing still authenticates it. */
export async function startHubMdnsAdvertisement(
  options: DiscoveryOptions = {},
): Promise<(() => Promise<void>) | undefined> {
  const advertisement = hubAdvertisement(options);
  return advertisement ? advertise([advertisement], options) : undefined;
}

/** Advertises both public roles when the Hub process also owns NVR services. */
export async function startHubNvrMdnsAdvertisement(
  options: DiscoveryOptions = {},
): Promise<(() => Promise<void>) | undefined> {
  const hub = hubAdvertisement(options);
  if (!hub) return undefined;
  return advertise(
    [
      hub,
      {
        name: 'Haus NVR',
        type: 'haus-nvr',
        port: hub.port,
        txt: { protocol: '1' },
        addresses: hub.addresses,
      },
    ],
    options,
  );
}

function hubAdvertisement(options: DiscoveryOptions): Advertisement | undefined {
  const env = options.env ?? process.env;
  if (/^(0|false)$/i.test(env.HAUS_MDNS_ADVERTISE || '')) return undefined;
  const port = options.port ?? Number(env.PORT || 8790);
  const addresses = hubMdnsAddresses(env, localAddresses(options));
  if (!addresses.length) throw Error('No private IPv4 address is available for Hub discovery.');
  const txt: Record<string, string> = {
    protocol: '1',
    hubId: env.HAUS_HUB_ID || 'hub-standalone-01',
    homeId: env.HAUS_HOME_ID || 'home-default',
  };
  return { name: env.HAUS_HUB_NAME || 'Haus Hub', type: 'haus-hub', port, txt, addresses };
}
