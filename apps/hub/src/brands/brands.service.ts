/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppCatalog } from '@haus/apps';
import {
  BrandIconCache,
  resolveBrandIcon,
  type BrandIconHint,
  type BrandIconKind,
} from '@haus/ha/native/brand-icons';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CommissioningService } from '../commissioning/service.js';

export interface ResolveHubBrandIconInput {
  readonly kind: BrandIconKind | string;
  readonly id: string;
  readonly dark?: boolean;
  readonly hint?: BrandIconHint;
}

@Injectable()
export class BrandsService {
  private readonly cache = new BrandIconCache(600);
  private readonly appCatalog = new AppCatalog();
  private fetchImpl?: typeof fetch;
  private localDirsOverride?: readonly string[];

  constructor(
    @Optional()
    @Inject(CommissioningService)
    private readonly commissioning?: Pick<CommissioningService, 'catalog'>,
  ) {}

  setFetchForTesting(fetchFn: typeof fetch): void {
    this.fetchImpl = fetchFn;
  }

  setLocalDirsForTesting(dirs: readonly string[]): void {
    this.localDirsOverride = dirs;
  }

  private getLocalIntegrationDirs(): readonly string[] {
    if (this.localDirsOverride) return this.localDirsOverride;
    const candidates: string[] = [];
    const overlay = this.commissioning?.catalog.getComponentsOverlayDir();
    if (overlay) candidates.push(overlay);

    const dataDir = process.env.HAUS_DATA_DIR || resolve('data');
    const haCustom = join(dataDir, 'ha-flow', 'config', 'custom_components');
    if (existsSync(haCustom)) candidates.push(haCustom);

    const repoCustom = resolve('custom_components');
    if (existsSync(repoCustom)) candidates.push(repoCustom);
    return candidates;
  }

  private getLocalPluginDirs(): readonly string[] {
    const candidates: string[] = [];
    const dataDir = process.env.HAUS_DATA_DIR || resolve('data');
    const hbRoot = join(dataDir, 'kitsune', 'homebridge');
    if (existsSync(hbRoot)) candidates.push(hbRoot);
    return candidates;
  }

  private enrichHint(id: string, hint?: BrandIconHint): BrandIconHint | undefined {
    const cleanId = id.trim();
    const manifest = this.commissioning?.catalog.getCatalog().getManifest(cleanId.toLowerCase());
    const appEntry = this.appCatalog.get(cleanId) ?? this.appCatalog.get(cleanId.toLowerCase());

    const supportedBy = hint?.supportedBy ?? manifest?.supported_by;
    const repositoryUrl = hint?.repositoryUrl ?? appEntry?.repositoryUrl;
    const name = hint?.name ?? manifest?.name ?? appEntry?.manifest.name;
    const category = hint?.category ?? appEntry?.category;
    const addonSlug = hint?.addonSlug;

    if (!supportedBy && !repositoryUrl && !name && !category && !addonSlug) {
      return undefined;
    }
    return {
      ...(name ? { name } : {}),
      ...(supportedBy ? { supportedBy } : {}),
      ...(repositoryUrl ? { repositoryUrl } : {}),
      ...(category ? { category } : {}),
      ...(addonSlug ? { addonSlug } : {}),
    };
  }

  async resolve(input: ResolveHubBrandIconInput): Promise<string | null> {
    const enrichedHint = this.enrichHint(input.id, input.hint);
    return resolveBrandIcon({
      kind: input.kind,
      id: input.id,
      dark: input.dark === true,
      hint: enrichedHint,
      localIntegrationDirs: this.getLocalIntegrationDirs(),
      localPluginDirs: this.getLocalPluginDirs(),
      fetchFn: this.fetchImpl,
      cache: this.cache,
    });
  }
}
