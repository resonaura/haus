/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOMEBRIDGE_GOVEE_PACKAGE = '@homebridge-plugins/homebridge-govee';

export const HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK = {
  switchSingle: ['H5001', 'H5080', 'H5081', 'H5083', 'H5085', 'H5086', 'H5901', 'H7014'],
  switchDouble: ['H5082', 'H5089'],
  switchTriple: ['H5160', 'H5161'],
} as const;

export interface GoveeOutletCatalog {
  readonly source: 'installed-plugin' | 'fallback-snapshot';
  readonly pluginVersion?: string;
  readonly pluginDirectory?: string;
  readonly switchSingle: readonly string[];
  readonly switchDouble: readonly string[];
  readonly switchTriple: readonly string[];
  readonly allModels: ReadonlySet<string>;
}

export interface GoveeCatalogResolveOptions {
  readonly pluginDirectory?: string;
  readonly dataDirectory?: string;
  readonly searchRoots?: readonly string[];
}

function createCatalog(params: Omit<GoveeOutletCatalog, 'allModels'>): GoveeOutletCatalog {
  const switchSingle = normalizeList(params.switchSingle);
  const switchDouble = normalizeList(params.switchDouble);
  const switchTriple = normalizeList(params.switchTriple);
  return {
    ...params,
    switchSingle,
    switchDouble,
    switchTriple,
    allModels: new Set([...switchSingle, ...switchDouble, ...switchTriple]),
  };
}

function normalizeList(items: readonly string[]): readonly string[] {
  const unique = new Set<string>();
  for (const item of items) {
    const normalized = normalizeGoveeModel(item);
    if (normalized) unique.add(normalized);
  }
  return [...unique];
}

export function normalizeGoveeModel(rawModel?: string): string | undefined {
  if (typeof rawModel !== 'string') return undefined;
  const trimmed = rawModel.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (/^[HRB][0-9A-Z]{3,5}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/\b([HRB][0-9A-Z]{3,5})\b/);
  return match?.[1] ?? trimmed;
}

const DEFAULT_CATALOG = createCatalog({
  source: 'fallback-snapshot',
  switchSingle: HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK.switchSingle,
  switchDouble: HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK.switchDouble,
  switchTriple: HOMEBRIDGE_GOVEE_OUTLET_CATALOG_FALLBACK.switchTriple,
});

let activeCatalog: GoveeOutletCatalog = DEFAULT_CATALOG;

export function getActiveGoveeOutletCatalog(): GoveeOutletCatalog {
  return activeCatalog;
}

export function setActiveGoveeOutletCatalog(catalog: GoveeOutletCatalog): void {
  activeCatalog = catalog;
}

export function resetActiveGoveeOutletCatalog(): void {
  activeCatalog = DEFAULT_CATALOG;
}

export function isHomebridgeGoveeOutletModel(
  model?: string,
  catalog: GoveeOutletCatalog = activeCatalog,
): boolean {
  const normalized = normalizeGoveeModel(model);
  if (!normalized) return false;
  return catalog.allModels.has(normalized);
}

export function getGoveeOutletChannelCount(
  model?: string,
  catalog: GoveeOutletCatalog = activeCatalog,
): 0 | 1 | 2 | 3 {
  const normalized = normalizeGoveeModel(model);
  if (!normalized) return 0;
  if (catalog.switchTriple.includes(normalized)) return 3;
  if (catalog.switchDouble.includes(normalized)) return 2;
  if (catalog.switchSingle.includes(normalized)) return 1;
  return 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

async function isGoveePluginDir(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, 'lib', 'utils', 'constants.js'))) return false;
  try {
    const pkgRaw = await readFile(join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { name?: unknown };
    return pkg.name === HOMEBRIDGE_GOVEE_PACKAGE || pkg.name === 'homebridge-govee';
  } catch {
    return false;
  }
}

export async function resolveHomebridgeGoveePluginDirectory(
  options: GoveeCatalogResolveOptions = {},
): Promise<string | undefined> {
  const candidates: string[] = [];
  if (options.pluginDirectory) candidates.push(options.pluginDirectory);

  for (const root of options.searchRoots ?? []) {
    candidates.push(
      root,
      join(root, HOMEBRIDGE_GOVEE_PACKAGE),
      join(root, 'node_modules', HOMEBRIDGE_GOVEE_PACKAGE),
      join(root, 'homebridge-govee'),
      join(root, 'node_modules', 'homebridge-govee'),
    );
  }

  if (options.dataDirectory) {
    const homebridgeDir = join(options.dataDirectory, 'kitsune', 'homebridge');
    const pluginsDir = join(options.dataDirectory, 'kitsune', 'plugins');
    candidates.push(
      join(homebridgeDir, 'homebridge-govee'),
      join(homebridgeDir, HOMEBRIDGE_GOVEE_PACKAGE),
      join(homebridgeDir, 'node_modules', HOMEBRIDGE_GOVEE_PACKAGE),
      join(options.dataDirectory, 'plugins', HOMEBRIDGE_GOVEE_PACKAGE),
      join(options.dataDirectory, 'plugins', 'node_modules', HOMEBRIDGE_GOVEE_PACKAGE),
    );
    try {
      for (const entry of await readdir(pluginsDir)) {
        const sub = join(pluginsDir, entry);
        candidates.push(sub, join(sub, 'node_modules', HOMEBRIDGE_GOVEE_PACKAGE));
      }
    } catch {
      // Directory may not exist yet before plugin installation
    }
  }

  try {
    const require = createRequire(import.meta.url);
    candidates.push(dirname(require.resolve(`${HOMEBRIDGE_GOVEE_PACKAGE}/package.json`)));
  } catch {
    // Package may be installed dynamically into runtime data storage rather than workspace
  }

  for (const candidate of candidates) {
    if (await isGoveePluginDir(candidate)) return candidate;
  }
  return undefined;
}

export async function loadHomebridgeGoveeOutletCatalog(
  options: GoveeCatalogResolveOptions = {},
): Promise<GoveeOutletCatalog> {
  const pluginDir = await resolveHomebridgeGoveePluginDirectory(options);
  if (!pluginDir) {
    return DEFAULT_CATALOG;
  }

  try {
    const pkg = JSON.parse(await readFile(join(pluginDir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    const constantsFile = join(pluginDir, 'lib', 'utils', 'constants.js');
    const info = await stat(constantsFile);
    const mod = (await import(`${pathToFileURL(constantsFile).href}?v=${info.mtimeMs}`)) as {
      default?: {
        models?: {
          switchSingle?: unknown;
          switchDouble?: unknown;
          switchTriple?: unknown;
        };
      };
    };

    const models = mod.default?.models;
    if (
      !models ||
      !isStringArray(models.switchSingle) ||
      !isStringArray(models.switchDouble) ||
      !isStringArray(models.switchTriple)
    ) {
      return DEFAULT_CATALOG;
    }

    const loaded = createCatalog({
      source: 'installed-plugin',
      pluginVersion: typeof pkg.version === 'string' ? pkg.version : undefined,
      pluginDirectory: pluginDir,
      switchSingle: models.switchSingle,
      switchDouble: models.switchDouble,
      switchTriple: models.switchTriple,
    });
    activeCatalog = loaded;
    return loaded;
  } catch {
    return DEFAULT_CATALOG;
  }
}
