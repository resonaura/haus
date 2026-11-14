/*
 * Haus — A thoughtful home
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export interface HaHomeKitModelMetadata {
  readonly domain: string;
  readonly alwaysDiscover: boolean;
}

export interface HaTranslationsIndex {
  readonly version: string;
  readonly sha256: string;
  readonly generatedAt: string;
  readonly translations: Readonly<Record<string, Record<string, unknown>>>;
  readonly supportedBy: Readonly<Record<string, string>>;
  readonly homekitModels: Readonly<Record<string, HaHomeKitModelMetadata>>;
  readonly flowHandlers: readonly string[];
  readonly applicationCredentials: readonly string[];
}

export function computeTranslationsChecksum(
  payload: Omit<HaTranslationsIndex, 'sha256' | 'generatedAt'>,
): string {
  const canonical = JSON.stringify({
    version: payload.version,
    supportedBy: Object.fromEntries(
      Object.entries(payload.supportedBy).sort(([a], [b]) => a.localeCompare(b)),
    ),
    flowHandlers: [...payload.flowHandlers].sort(),
    homekitModels: Object.fromEntries(
      Object.entries(payload.homekitModels).sort(([a], [b]) => a.localeCompare(b)),
    ),
    translations: Object.fromEntries(
      Object.entries(payload.translations).sort(([a], [b]) => a.localeCompare(b)),
    ),
    applicationCredentials: [...payload.applicationCredentials].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function globMatchCaseInsensitive(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function flattenObject(
  node: Record<string, unknown>,
  prefix: string,
  out: Record<string, string>,
): void {
  for (const [key, val] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'string') {
      out[fullKey] = val;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      flattenObject(val as Record<string, unknown>, fullKey, out);
    }
  }
}

export class HaCatalogTranslations {
  private readonly index: HaTranslationsIndex;
  private readonly flowHandlerSet: Set<string>;
  private readonly homekitEntries: readonly [string, HaHomeKitModelMetadata][];

  constructor(index: HaTranslationsIndex) {
    this.index = index;
    this.flowHandlerSet = new Set(index.flowHandlers);
    this.homekitEntries = Object.entries(index.homekitModels);
  }

  static empty(version = '0.0.0'): HaCatalogTranslations {
    return new HaCatalogTranslations({
      version,
      sha256: '',
      generatedAt: new Date(0).toISOString(),
      translations: {},
      supportedBy: {},
      homekitModels: {},
      flowHandlers: [],
      applicationCredentials: [],
    });
  }

  static fromFile(filePath: string): HaCatalogTranslations {
    const gz = readFileSync(filePath);
    const jsonText = gunzipSync(gz).toString('utf-8');
    const parsed = JSON.parse(jsonText) as HaTranslationsIndex;
    return new HaCatalogTranslations(parsed);
  }

  getIndex(): HaTranslationsIndex {
    return this.index;
  }

  getVersion(): string {
    return this.index.version;
  }

  resolveSupportedBy(domain: string): string | undefined {
    return this.index.supportedBy[domain];
  }

  getAllSupportedBy(): Readonly<Record<string, string>> {
    return this.index.supportedBy;
  }

  getFlowHandlers(): readonly string[] {
    return this.index.flowHandlers;
  }

  hasFlowHandler(domain: string): boolean {
    if (this.flowHandlerSet.has(domain)) return true;
    const parent = this.index.supportedBy[domain];
    return parent ? this.flowHandlerSet.has(parent) : false;
  }

  getApplicationCredentialDomains(): readonly string[] {
    return this.index.applicationCredentials;
  }

  getHomeKitModelInfo(model: string): HaHomeKitModelMetadata | undefined {
    if (!model) return undefined;
    const trimmed = model.trim();
    const direct = this.index.homekitModels[trimmed];
    if (direct) return direct;
    for (const [pattern, meta] of this.homekitEntries) {
      if (globMatchCaseInsensitive(pattern, trimmed)) {
        return meta;
      }
    }
    return undefined;
  }

  getAllHomeKitModels(): Readonly<Record<string, HaHomeKitModelMetadata>> {
    return this.index.homekitModels;
  }

  getDomainTree(domain: string): Readonly<Record<string, unknown>> | undefined {
    const direct = this.index.translations[domain];
    if (direct) return direct;
    const parent = this.index.supportedBy[domain];
    return parent ? this.index.translations[parent] : undefined;
  }

  getIntegrationTitle(domain: string): string | undefined {
    const direct = this.index.translations[domain];
    if (typeof direct?.title === 'string' && direct.title.length > 0) {
      return direct.title;
    }
    const parent = this.index.supportedBy[domain];
    const parentTree = parent ? this.index.translations[parent] : undefined;
    if (typeof parentTree?.title === 'string' && parentTree.title.length > 0) {
      return parentTree.title;
    }
    return undefined;
  }

  /**
   * Build HA frontend/get_translations style flat resources for a category
   * (`title`, `config`, `options`, `selector`, `config_subentries`, `exceptions`).
   */
  getFlattenedCategory(category: string, integrations?: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    const targetDomains =
      integrations && integrations.length > 0 ? integrations : Object.keys(this.index.translations);

    for (const domain of targetDomains) {
      const tree = this.getDomainTree(domain);
      if (!tree) continue;
      if (category === 'title') {
        const title = this.getIntegrationTitle(domain);
        if (title) out[`component.${domain}.title`] = title;
        continue;
      }
      const section = tree[category];
      if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
        flattenObject(section as Record<string, unknown>, `component.${domain}.${category}`, out);
      }
    }
    return out;
  }
}
