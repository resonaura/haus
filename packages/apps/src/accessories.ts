/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { AppManifest } from './manifest.js';

export interface AppAccessoryEndpoint {
  readonly protocol: 'haus-camera-v2';
  readonly port: number;
}

export interface AppAccessorySupport {
  readonly mqtt: boolean;
  readonly camera: boolean;
}

/** A declared, published App endpoint; never a client-supplied host or discovered authority. */
export function appAccessoryPort(manifest: AppManifest): number | undefined {
  const endpoint = manifest.accessories;
  if (!endpoint) return;
  if (manifest.network?.mode === 'host') return endpoint.port;
  if (manifest.network?.mode === 'internal' || manifest.network?.mode === 'none')
    throw Error('app_accessories_network_unavailable');
  const mapping = manifest.ports?.find(
    (port) => port.containerPort === endpoint.port && (port.protocol ?? 'tcp') === 'tcp',
  );
  if (!mapping?.hostPort) throw Error('app_accessories_port_unpublished');
  return mapping.hostPort;
}

export function appAccessorySupport(manifest: AppManifest): AppAccessorySupport {
  return {
    mqtt:
      manifest.services?.some((value) => /^mqtt(?::(?:need|want|required))?$/.test(value)) ?? false,
    camera: manifest.accessories?.protocol === 'haus-camera-v2',
  };
}
