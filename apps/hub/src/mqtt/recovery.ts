/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { inferDeviceCategory, type MqttDiscoveryClaim } from '@haus/mqtt';
import type { StandaloneHomeService } from '../home/home.service.js';
import type { MqttIdentities } from './identity.js';
import { withoutMqttSource } from './sources.js';

/** Reconcile only explicitly owned records after an authoritative retained replay. */
export class MqttRecovery {
  constructor(
    private readonly home: StandaloneHomeService,
    private readonly identities: MqttIdentities,
    private readonly synthetic: Set<string>,
  ) {}

  async run(claims: readonly MqttDiscoveryClaim[]): Promise<void> {
    const devices = this.home.listDevices();
    const managed = await this.identities.managedDevices();
    const owned = await this.identities.ownedEndpoints(
      new Set([
        ...Object.keys(this.home.listEndpointStates()),
        ...devices.flatMap((device) => device.endpoints.map((endpoint) => endpoint.id)),
      ]),
    );
    const canonical = await this.identities.canonicalDeviceIds([
      ...claims.map((claim) => claim.device),
      ...[...owned.values()].map((owner) => owner.device),
    ]);
    const deviceId = (rawId: string) => canonical.get(rawId) ?? rawId;
    const activeDevices = new Set(claims.map((claim) => deviceId(claim.device)));
    const activeEntities = new Set(
      claims
        .filter((claim) => claim.kind === 'endpoint')
        .map((claim) => JSON.stringify([deviceId(claim.device), claim.component, claim.uniqueId])),
    );
    for (const [id, ownership] of owned) if (ownership.kind === 'synthetic') this.synthetic.add(id);
    const removed = new Set<string>();
    for (const device of devices) {
      if (!managed.has(device.id)) continue;
      const endpoints = device.endpoints.flatMap((endpoint) => {
        const owner = owned.get(endpoint.id);
        if (!owner) return [endpoint];
        const claimed =
          owner.kind === 'synthetic'
            ? activeDevices.has(deviceId(owner.device))
            : activeEntities.has(
                JSON.stringify([deviceId(owner.device), owner.component, owner.uniqueId]),
              );
        return claimed ? [endpoint] : (withoutMqttSource(endpoint) ?? []);
      });
      if (
        endpoints.every((endpoint, index) => endpoint === device.endpoints[index]) &&
        endpoints.length === device.endpoints.length
      )
        continue;
      for (const endpoint of device.endpoints)
        if (!endpoints.some((candidate) => candidate.id === endpoint.id)) removed.add(endpoint.id);
      if (!endpoints.length) this.home.removeDevice(device.id);
      else
        this.home.registerDevice({
          ...device,
          endpoints,
          services: [],
          category: inferDeviceCategory({
            id: device.source.externalId,
            name: device.name,
            model: device.model,
            endpoints,
          }),
        });
    }
    const retained = new Set(
      this.home.listDevices().flatMap((device) => device.endpoints.map((endpoint) => endpoint.id)),
    );
    for (const [id, owner] of owned) {
      const stillClaimed =
        owner.kind === 'synthetic'
          ? activeDevices.has(owner.device)
          : activeEntities.has(
              JSON.stringify([deviceId(owner.device), owner.component, owner.uniqueId]),
            );
      if (!retained.has(id) && !stillClaimed) removed.add(id);
    }
    for (const id of removed) {
      this.home.removeEndpointState(id);
      this.synthetic.delete(id);
    }
  }
}
