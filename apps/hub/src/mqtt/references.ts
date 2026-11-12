/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { IdentityRef } from '@haus/core/identity';

export function deviceReference(homeId: string, rawId: string): IdentityRef {
  return { homeId, kind: 'device', source: { instanceId: 'haus-mqtt', externalId: rawId } };
}

export function endpointReference(
  homeId: string,
  rawDevice: string,
  domain: string,
  uniqueId: string,
): IdentityRef {
  return {
    homeId,
    kind: 'endpoint',
    source: { instanceId: 'haus-mqtt', externalId: JSON.stringify([rawDevice, domain, uniqueId]) },
  };
}
