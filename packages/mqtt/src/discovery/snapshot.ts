/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import { expandHaDiscoveryPayload } from './abbreviations.js';
import { bundleDiscovery, componentDiscovery, discoveryObject } from './validation.js';

function parse(payload: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(payload);
    if (!discoveryObject(raw)) return;
    const expanded = expandHaDiscoveryPayload(raw);
    if ('components' in expanded ? bundleDiscovery(expanded) : componentDiscovery(expanded))
      return expanded;
  } catch {
    // Invalid packets must not replace the last accepted discovery projection.
  }
  return;
}

/** Bundle announcements are incremental; retain removal markers and omitted siblings. */
export function mergeDiscoverySnapshot(
  previous: string | undefined,
  incoming: string,
): string | undefined {
  if (incoming.length === 0) return '';
  const next = parse(incoming);
  if (!next) return;
  const before = previous ? parse(previous) : undefined;
  if (bundleDiscovery(next) && bundleDiscovery(before)) {
    return JSON.stringify({
      ...before,
      ...next,
      components: { ...before.components, ...next.components },
    });
  }
  return JSON.stringify(next);
}
