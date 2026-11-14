/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

export interface HaCatalogManifest {
  readonly domain: string;
  readonly name: string;
  readonly integration_type?: string;
  readonly supported_by?: string;
  readonly iot_class?: string;
  readonly config_flow: boolean;
  readonly documentation?: string;
  readonly requirements: readonly string[];
  readonly dependencies: readonly string[];
  readonly after_dependencies?: readonly string[];
  readonly codeowners: readonly string[];
  readonly zeroconf?: readonly (string | Record<string, unknown>)[];
  readonly ssdp?: readonly Record<string, unknown>[];
  readonly dhcp?: readonly Record<string, unknown>[];
  readonly bluetooth?: readonly Record<string, unknown>[];
  readonly mqtt?: readonly string[];
  readonly usb?: readonly Record<string, unknown>[];
  readonly homekit?: Record<string, unknown>;
  readonly single_config_entry?: boolean;
}

export interface HaCatalogIndex {
  readonly version: string;
  readonly releaseTag: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly totalIntegrations: number;
  readonly sha256: string;
  readonly generatedAt: string;
  readonly integrations: Readonly<Record<string, HaCatalogManifest>>;
}

export type HaRuntimeCategory =
  'native_haus' | 'kitsune_hacs' | 'homebridge' | 'scrypted' | 'catalog_only';

export type HaRuntimeSupportStatus = 'executable' | 'planned' | 'unsupported';

export interface HaRuntimeCoverage {
  readonly domain: string;
  readonly name: string;
  readonly category: HaRuntimeCategory;
  readonly runtimeStatus: HaRuntimeSupportStatus;
  readonly adapter: string;
  readonly supportedEntities: readonly string[];
  readonly supportedServices: readonly string[];
  readonly missingCapabilities: readonly string[];
  readonly notes?: string;
}

export interface HaCatalogQueryFilter {
  readonly domain?: string;
  readonly search?: string;
  readonly iotClass?: string;
  readonly configFlow?: boolean;
  readonly hasDiscoveryMatcher?: 'zeroconf' | 'ssdp' | 'dhcp' | 'bluetooth' | 'mqtt' | 'usb';
  readonly category?: HaRuntimeCategory;
}

export interface HaCatalogDomainChange {
  readonly domain: string;
  readonly changes: readonly string[];
}

export interface HaCatalogDiff {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly addedDomains: readonly string[];
  readonly removedDomains: readonly string[];
  readonly modifiedDomains: readonly HaCatalogDomainChange[];
}

export interface HaCatalogCoverageSummary {
  readonly totalCatalogIntegrations: number;
  readonly nativeHausCount: number;
  readonly kitsuneHacsCount: number;
  readonly homebridgeCount: number;
  readonly scryptedCount: number;
  readonly catalogOnlyCount: number;
  readonly executableCoveragePercent: number;
}
