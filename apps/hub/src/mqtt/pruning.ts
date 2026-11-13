/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { HausDevice } from '@haus/core';

interface HomePruneHost {
  listDevices(): readonly HausDevice[];
  registerDevice(device: HausDevice): HausDevice;
}

/** Remove unplayable placeholder `_camera` endpoints left by legacy MQTT name heuristics. */
export function pruneSyntheticVideoEndpoints(
  homeService: HomePruneHost,
  hasBinding: (endpointId: string) => boolean,
  syntheticVideoEndpoints: Set<string>,
): void {
  for (const device of homeService.listDevices()) {
    if (device.source.instanceId !== 'haus-mqtt') continue;
    const kept = device.endpoints.filter(
      (ep) =>
        !(
          ep.id.endsWith('_camera') &&
          !ep.mediaId &&
          !ep.sourceOwner &&
          !ep.sourceRefs?.length &&
          ep.capabilities.length === 1 &&
          ep.capabilities[0]?.id === 'video' &&
          ep.capabilities[0].operations.length === 0 &&
          !hasBinding(ep.id)
        ),
    );
    if (kept.length === device.endpoints.length) continue;
    const removedIds = new Set(
      device.endpoints.filter((ep) => !kept.includes(ep)).map((ep) => ep.id),
    );
    for (const id of removedIds) syntheticVideoEndpoints.delete(id);
    const services = device.services?.filter(
      (svc) => !removedIds.has(svc.id.replace(/^service_/, '')),
    );
    homeService.registerDevice({
      ...device,
      endpoints: kept,
      ...(services ? { services } : {}),
    });
  }
}
