/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { Bonjour, type Service } from 'bonjour-service';
import { isIP } from 'node:net';
import { CAMERA_BRIDGE_SERVICE, uuid, type Provider } from './protocol.js';

/** Discovery advertises no cameras, credentials, pairing codes or media URLs. */
export function advertiseCameraBridge(
  info: { bridgeId: string; provider: Provider; name: string },
  port: number,
  onError: () => void = () => {},
) {
  if (
    !uuid(info.bridgeId) ||
    !['aqara', 'tuya'].includes(info.provider) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error('invalid_bridge_advertisement');
  const bonjour = new Bonjour({}, onError);
  const service = bonjour.publish({
    name: `Haus ${info.provider} ${info.bridgeId.slice(0, 8)}`,
    type: CAMERA_BRIDGE_SERVICE,
    protocol: 'tcp',
    port,
    txt: { profile: '2', bridge_id: info.bridgeId, provider: `rsnra.${info.provider}` },
  });
  service.on('error', onError);
  return () => {
    service.stop();
    bonjour.destroy();
  };
}

export function discoveredCameraBridge(
  service: Pick<Service, 'type' | 'protocol' | 'port' | 'txt' | 'addresses'>,
) {
  const txt = service.txt;
  if (
    service.type !== CAMERA_BRIDGE_SERVICE ||
    service.protocol !== 'tcp' ||
    txt?.profile !== '2' ||
    !uuid(txt.bridge_id) ||
    !['rsnra.aqara', 'rsnra.tuya'].includes(txt.provider) ||
    !Number.isInteger(service.port) ||
    service.port < 1 ||
    service.port > 65535
  )
    return;
  const address = service.addresses?.find(
    (address) =>
      (isIP(address) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) ||
      (isIP(address) === 6 && /^(fc|fd)[a-f0-9]{2}:/i.test(address)),
  );
  if (!address) return;
  return {
    bridgeId: txt.bridge_id,
    provider: txt.provider.slice(6) as Provider,
    url: `http://${isIP(address) === 6 ? '[' + address + ']' : address}:${service.port}`,
    verified: false as const,
  };
}

export function discoverCameraBridges(options: {
  onFound: (bridge: NonNullable<ReturnType<typeof discoveredCameraBridge>>) => void;
  onError?: () => void;
  timeoutMs?: number;
}) {
  const onError = options.onError ?? (() => {}),
    timeout = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000)
    throw Error('invalid_discovery_timeout');
  const bonjour = new Bonjour({}, onError),
    seen = new Set<string>();
  let closed = false;
  const browser = bonjour.find({ type: CAMERA_BRIDGE_SERVICE, protocol: 'tcp' }, (service) => {
    if (closed) return;
    const bridge = discoveredCameraBridge(service);
    if (!bridge) return;
    const key = bridge.bridgeId + ':' + bridge.url;
    if (seen.has(key)) return;
    seen.add(key);
    options.onFound(bridge);
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    browser.stop();
    bonjour.destroy();
  };
  const timer = setTimeout(stop, timeout);
  timer.unref();
  return stop;
}
