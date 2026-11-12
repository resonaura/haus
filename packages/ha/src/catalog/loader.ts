/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { evaluateRuntimeCoverage, summarizeRuntimeCoverage } from './coverage.js';
import type { DiscoveryMatcherRule } from '@haus/core';
import type {
  HaCatalogCoverageSummary,
  HaCatalogIndex,
  HaCatalogManifest,
  HaCatalogQueryFilter,
  HaRuntimeCoverage,
} from './types.js';

export class HaIntegrationCatalog {
  private static instance: HaIntegrationCatalog | null = null;
  private readonly index: HaCatalogIndex;

  constructor(index: HaCatalogIndex) {
    this.index = index;
  }

  static fromBuffer(buffer: Buffer, verifyChecksum = true): HaIntegrationCatalog {
    let rawText: string;
    // Check for gzip magic header (0x1f, 0x8b)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      rawText = gunzipSync(buffer).toString('utf-8');
    } else {
      rawText = buffer.toString('utf-8');
    }

    const parsed = JSON.parse(rawText) as HaCatalogIndex;
    if (!parsed.version || !parsed.integrations || typeof parsed.totalIntegrations !== 'number') {
      throw new Error('invalid_catalog_schema');
    }

    if (verifyChecksum && parsed.sha256) {
      const computed = computeCatalogChecksum(parsed.integrations);
      if (computed !== parsed.sha256) {
        throw new Error(
          `catalog_integrity_check_failed: expected ${parsed.sha256}, calculated ${computed}`,
        );
      }
    }

    return new HaIntegrationCatalog(parsed);
  }

  static fromFile(filePath: string, verifyChecksum = true): HaIntegrationCatalog {
    if (!existsSync(filePath)) {
      throw new Error(`catalog_file_not_found: ${filePath}`);
    }
    const buffer = readFileSync(filePath);
    return HaIntegrationCatalog.fromBuffer(buffer, verifyChecksum);
  }

  getVersion(): string {
    return this.index.version;
  }

  getReleaseTag(): string {
    return this.index.releaseTag;
  }

  getLicense(): string {
    return this.index.license;
  }

  getSha256(): string {
    return this.index.sha256;
  }

  getGeneratedAt(): string {
    return this.index.generatedAt;
  }

  getTotalCount(): number {
    return this.index.totalIntegrations;
  }

  getManifest(domain: string): HaCatalogManifest | undefined {
    return this.index.integrations[domain];
  }

  getAllDomains(): readonly string[] {
    return Object.keys(this.index.integrations);
  }

  getAllManifests(): readonly HaCatalogManifest[] {
    return Object.values(this.index.integrations);
  }

  getRuntimeCoverage(domain: string): HaRuntimeCoverage | undefined {
    const manifest = this.getManifest(domain);
    return manifest ? evaluateRuntimeCoverage(manifest) : undefined;
  }

  getCoverageSummary(): HaCatalogCoverageSummary {
    return summarizeRuntimeCoverage(this.index.integrations);
  }

  getDiscoveryMatcherRules(): DiscoveryMatcherRule[] {
    const rules: DiscoveryMatcherRule[] = [];
    for (const m of Object.values(this.index.integrations)) {
      if (
        (m.zeroconf && m.zeroconf.length > 0) ||
        (m.ssdp && m.ssdp.length > 0) ||
        (m.dhcp && m.dhcp.length > 0) ||
        (m.bluetooth && m.bluetooth.length > 0) ||
        (m.usb && m.usb.length > 0) ||
        (m.mqtt && m.mqtt.length > 0)
      ) {
        rules.push({
          domain: m.domain,
          zeroconf: m.zeroconf as DiscoveryMatcherRule['zeroconf'],
          ssdp: m.ssdp as DiscoveryMatcherRule['ssdp'],
          dhcp: m.dhcp as DiscoveryMatcherRule['dhcp'],
          bluetooth: m.bluetooth as DiscoveryMatcherRule['bluetooth'],
          usb: m.usb as DiscoveryMatcherRule['usb'],
          mqtt: m.mqtt,
        });
      }
    }
    return rules;
  }

  query(filter: HaCatalogQueryFilter = {}): readonly HaCatalogManifest[] {
    let results = Object.values(this.index.integrations);

    if (filter.domain) {
      const target = filter.domain.toLowerCase();
      results = results.filter((m) => m.domain.toLowerCase().includes(target));
    }

    if (filter.search) {
      const target = filter.search.toLowerCase();
      results = results.filter(
        (m) => m.name.toLowerCase().includes(target) || m.domain.toLowerCase().includes(target),
      );
    }

    if (filter.iotClass) {
      results = results.filter((m) => m.iot_class === filter.iotClass);
    }

    if (filter.configFlow !== undefined) {
      results = results.filter((m) => m.config_flow === filter.configFlow);
    }

    if (filter.hasDiscoveryMatcher) {
      results = results.filter((m) => {
        const matcher = filter.hasDiscoveryMatcher!;
        switch (matcher) {
          case 'zeroconf':
            return Array.isArray(m.zeroconf) && m.zeroconf.length > 0;
          case 'ssdp':
            return Array.isArray(m.ssdp) && m.ssdp.length > 0;
          case 'dhcp':
            return Array.isArray(m.dhcp) && m.dhcp.length > 0;
          case 'bluetooth':
            return Array.isArray(m.bluetooth) && m.bluetooth.length > 0;
          case 'mqtt':
            return Array.isArray(m.mqtt) && m.mqtt.length > 0;
          case 'usb':
            return Array.isArray(m.usb) && m.usb.length > 0;
          default:
            return false;
        }
      });
    }

    if (filter.category) {
      results = results.filter((m) => evaluateRuntimeCoverage(m).category === filter.category);
    }

    return results;
  }
}

export function computeCatalogChecksum(
  integrations: Readonly<Record<string, HaCatalogManifest>>,
): string {
  const sortedKeys = Object.keys(integrations).sort();
  const sortedObj: Record<string, HaCatalogManifest> = {};
  for (const key of sortedKeys) {
    const entry = integrations[key];
    if (entry) sortedObj[key] = entry;
  }
  const payload = JSON.stringify(sortedObj);
  return createHash('sha256').update(payload).digest('hex');
}
