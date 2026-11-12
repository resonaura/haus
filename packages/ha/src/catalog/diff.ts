/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import type { HaCatalogDiff, HaCatalogDomainChange, HaCatalogManifest } from './types.js';

export function diffCatalogs(
  fromCatalog: {
    readonly version: string;
    readonly integrations: Readonly<Record<string, HaCatalogManifest>>;
  },
  toCatalog: {
    readonly version: string;
    readonly integrations: Readonly<Record<string, HaCatalogManifest>>;
  },
): HaCatalogDiff {
  const fromKeys = new Set(Object.keys(fromCatalog.integrations));
  const toKeys = new Set(Object.keys(toCatalog.integrations));

  const addedDomains: string[] = [];
  const removedDomains: string[] = [];
  const modifiedDomains: HaCatalogDomainChange[] = [];

  for (const domain of toKeys) {
    if (!fromKeys.has(domain)) {
      addedDomains.push(domain);
    } else {
      const fromManifest = fromCatalog.integrations[domain];
      const toManifest = toCatalog.integrations[domain];
      if (fromManifest && toManifest) {
        const changes: string[] = [];
        if (fromManifest.name !== toManifest.name) {
          changes.push(`name: "${fromManifest.name}" -> "${toManifest.name}"`);
        }
        if (fromManifest.iot_class !== toManifest.iot_class) {
          changes.push(`iot_class: "${fromManifest.iot_class}" -> "${toManifest.iot_class}"`);
        }
        if (fromManifest.config_flow !== toManifest.config_flow) {
          changes.push(`config_flow: ${fromManifest.config_flow} -> ${toManifest.config_flow}`);
        }

        const reqDiff = compareStringArrays(fromManifest.requirements, toManifest.requirements);
        if (reqDiff) changes.push(`requirements: ${reqDiff}`);

        const depDiff = compareStringArrays(fromManifest.dependencies, toManifest.dependencies);
        if (depDiff) changes.push(`dependencies: ${depDiff}`);

        if (changes.length > 0) {
          modifiedDomains.push({ domain, changes });
        }
      }
    }
  }

  for (const domain of fromKeys) {
    if (!toKeys.has(domain)) {
      removedDomains.push(domain);
    }
  }

  addedDomains.sort();
  removedDomains.sort();
  modifiedDomains.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    fromVersion: fromCatalog.version,
    toVersion: toCatalog.version,
    addedDomains,
    removedDomains,
    modifiedDomains,
  };
}

function compareStringArrays(
  prev: readonly string[] = [],
  next: readonly string[] = [],
): string | null {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((item) => !prevSet.has(item));
  const removed = prev.filter((item) => !nextSet.has(item));

  if (added.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`+(${added.join(', ')})`);
  if (removed.length > 0) parts.push(`-(${removed.join(', ')})`);
  return parts.join(' ');
}
