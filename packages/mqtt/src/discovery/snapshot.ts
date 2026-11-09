/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { parseDiscoveryPayload } from './payload.js';
import { bundleDiscovery } from './validation.js';
import type { DeviceBundleDiscoveryPayload, HaMqttComponentConfig } from '../types.js';

function parse(
  component: string,
  payload: string,
): DeviceBundleDiscoveryPayload | HaMqttComponentConfig | undefined {
  try {
    return parseDiscoveryPayload(component, payload).payload;
  } catch {
    // Invalid packets must not replace the last accepted discovery projection.
  }
  return;
}

/** Bundle announcements are incremental; retain removal markers and omitted siblings. */
export function mergeDiscoverySnapshot(
  component: string,
  previous: string | undefined,
  incoming: string,
): string | undefined {
  if (incoming.length === 0) return '';
  const next = parse(component, incoming);
  if (!next) return;
  const before = previous ? parse(component, previous) : undefined;
  if (bundleDiscovery(next) && bundleDiscovery(before)) {
    return JSON.stringify({
      ...before,
      ...next,
      components: { ...before.components, ...next.components },
    });
  }
  return JSON.stringify(next);
}
