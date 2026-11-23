/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppCatalog, AppCatalogEntry, AppManifest } from '@haus/apps';
import {
  EcosystemPluginCatalog,
  PluginInstaller,
  toAppCatalogEntry,
  type InstalledPlugin,
} from '@haus/kitsune';
import { isSecretConfigKey, type NativeConfigFieldMeta } from '../home/apps/config.js';

export function attachEcosystemCatalogProvider(
  appCatalog: AppCatalog,
  ecosystemCatalog: EcosystemPluginCatalog,
): void {
  ecosystemCatalog.syncIntoAppCatalog(appCatalog);
  appCatalog.setDynamicProvider({
    sync: async (opts) => {
      if (opts?.refresh) {
        await ecosystemCatalog.refresh(true);
      } else if (ecosystemCatalog.getIndexingStatus().lastRefreshedAt === 0) {
        void ecosystemCatalog
          .refresh(false)
          .then(() => ecosystemCatalog.syncIntoAppCatalog(appCatalog))
          .catch(() => {});
      }
      const rt =
        opts?.runtimeType === 'homebridge' || opts?.runtimeType === 'scrypted'
          ? opts.runtimeType
          : undefined;
      if (opts?.search && (!opts.runtimeType || rt)) {
        await ecosystemCatalog.searchLive(opts.search, rt);
      }
      ecosystemCatalog.syncIntoAppCatalog(appCatalog);
    },
    resolve: async (appId) => {
      const rec = await ecosystemCatalog.resolveByIdOrPackage(appId);
      if (!rec) return undefined;
      const entry = toAppCatalogEntry(rec);
      appCatalog.register(entry);
      return entry;
    },
  });
}

interface ScryptedPluginSetting {
  readonly key?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly type?: unknown;
  readonly choices?: unknown;
  readonly value?: unknown;
}

export function resolveScryptedPackageName(
  appId: string,
  manifest: Pick<AppManifest, 'id' | 'env'>,
  config: Readonly<Record<string, unknown>>,
  catalogEntry?: Pick<AppCatalogEntry, 'packageName'>,
): string {
  if (typeof config.packageName === 'string' && config.packageName.trim().length > 0) {
    return config.packageName.trim();
  }
  const rawEnvPkg =
    manifest.env && typeof manifest.env === 'object' && 'HAUS_NPM_PACKAGE' in manifest.env
      ? manifest.env.HAUS_NPM_PACKAGE
      : undefined;
  if (typeof rawEnvPkg === 'string' && rawEnvPkg.trim().length > 0) {
    return rawEnvPkg.trim();
  }
  if (catalogEntry?.packageName) {
    return catalogEntry.packageName;
  }
  if (appId.startsWith('scrypted-') && appId !== 'scrypted-kasa') {
    return `@scrypted/${appId.slice('scrypted-'.length)}`;
  }
  return appId;
}

export function parseScryptedSettingsSchema(
  raw: unknown,
): Record<string, NativeConfigFieldMeta> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, NativeConfigFieldMeta> = {};
  for (const item of raw as ScryptedPluginSetting[]) {
    if (!item || typeof item !== 'object') continue;
    const key =
      typeof item.key === 'string' && item.key.trim()
        ? item.key.trim()
        : typeof item.title === 'string' && item.title.trim()
          ? item.title.trim()
          : undefined;
    if (!key) continue;
    const rawType = typeof item.type === 'string' ? item.type.toLowerCase() : 'string';
    const choices = Array.isArray(item.choices)
      ? item.choices.filter(
          (c): c is string | number => typeof c === 'string' || typeof c === 'number',
        )
      : undefined;
    const mappedType: NativeConfigFieldMeta['type'] =
      choices && choices.length > 0
        ? 'select'
        : rawType === 'boolean'
          ? 'boolean'
          : rawType === 'number' || rawType === 'integer'
            ? 'number'
            : 'string';
    const secret = rawType === 'password' || isSecretConfigKey(key);
    out[key] = {
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      type: mappedType,
      ...(secret ? { secret: true } : {}),
      ...(choices && choices.length > 0 ? { choices } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function resolveInstalledScryptedPlugin(params: {
  readonly appId: string;
  readonly manifest: AppManifest;
  readonly config: Readonly<Record<string, unknown>>;
  readonly dataDirectory: string;
  readonly catalogEntry?: Pick<AppCatalogEntry, 'packageName'>;
  readonly forceInstall?: boolean;
}): Promise<InstalledPlugin> {
  const { appId, manifest, config, dataDirectory, catalogEntry, forceInstall = false } = params;
  const pkgName = resolveScryptedPackageName(appId, manifest, config, catalogEntry);

  if (typeof config.pluginPath === 'string' && config.pluginPath.trim().length > 0) {
    const directory = resolve(config.pluginPath.trim());
    let entry = 'index.js';
    try {
      const pkgJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
        main?: unknown;
        version?: unknown;
        scrypted?: { name?: string; interfaces?: string[]; type?: string };
      };
      if (typeof pkgJson.main === 'string' && pkgJson.main.trim()) {
        entry = pkgJson.main.trim();
      }
      return {
        name: pkgName,
        version: typeof pkgJson.version === 'string' ? pkgJson.version : manifest.version,
        directory,
        entry,
        integrity: 'local',
        license: null,
        pluginDependencies: [],
        rootDevice: {
          name: pkgJson.scrypted?.name ?? manifest.name,
          interfaces: pkgJson.scrypted?.interfaces ?? ['DeviceProvider', 'Settings'],
          type: pkgJson.scrypted?.type,
        },
      };
    } catch {
      const hasMain = await stat(join(directory, entry))
        .then((s) => s.isFile())
        .catch(() => false);
      if (!hasMain) throw new Error('kitsune_plugin_entry_missing');
      return {
        name: pkgName,
        version: manifest.version,
        directory,
        entry,
        integrity: 'local',
        license: null,
        pluginDependencies: [],
        rootDevice: { name: manifest.name, interfaces: ['DeviceProvider', 'Settings'] },
      };
    }
  }

  const installer = new PluginInstaller(dataDirectory);
  const targetVersion = !forceInstall && manifest.version ? manifest.version : 'latest';
  try {
    return await installer.install(pkgName, targetVersion);
  } catch {
    return await installer.install(pkgName, 'latest');
  }
}
