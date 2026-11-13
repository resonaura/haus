/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archivePath, tarFiles, writeArchive, zipFiles } from './archives.js';
import {
  blockedPackages,
  boundedFetch,
  resolvePackage,
  verifyIntegrity,
  type PackageMetadata,
  type Packument,
} from './registry.js';

export interface PluginInstallerOptions {
  timeoutMs?: number;
}

export interface InstalledPlugin {
  name: string;
  version: string;
  directory: string;
  entry: string;
  integrity: string;
  license: string | null;
  pluginDependencies: string[];
  rootDevice?: { name: string; interfaces: string[]; type?: string };
}
const DEFAULT_INSTALL_TIMEOUT_MS = 300_000;
const PREFETCH_CONCURRENCY = 6;

async function mapBounded<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const runWorker = async (): Promise<void> => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item !== undefined) await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
}

function shouldSkipChild(
  dependency: string,
  version: string,
  optional: boolean,
  zip: unknown,
  lineage: readonly string[],
): boolean {
  if (dependency === '@scrypted/sdk') return true;
  if (blockedPackages.has(dependency) && optional) return true;
  if (version.startsWith('file:') && (Boolean(zip) || optional)) return true;
  return lineage.includes(dependency);
}

function collectOptionalTargets(
  meta: PackageMetadata,
  optionalDeps: Record<string, string>,
  zip: unknown,
  depth: number,
): Record<string, string> {
  if (zip || depth > 1) return {};
  const optionalTargets: Record<string, string> = { ...optionalDeps };
  if (meta.peerDependencies && meta.peerDependenciesMeta) {
    for (const [dependency, version] of Object.entries(meta.peerDependencies)) {
      if (meta.peerDependenciesMeta[dependency]?.optional && !optionalTargets[dependency]) {
        optionalTargets[dependency] = version;
      }
    }
  }
  return optionalTargets;
}

export class PluginInstaller {
  private pending = new Map<string, Promise<InstalledPlugin>>();
  private readonly timeoutMs: number;
  constructor(
    readonly dataDirectory: string,
    private readonly fetchRequest = fetch,
    options: PluginInstallerOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  }
  install(name: string, version = 'latest') {
    const key = `${name}@${version}`;
    if (!this.pending.has(key))
      this.pending.set(
        key,
        this.perform(name, version).finally(() => this.pending.delete(key)),
      );
    return this.pending.get(key)!;
  }
  private async perform(name: string, range: string) {
    const root = join(this.dataDirectory, 'kitsune', 'plugins');
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Explicitly pinned restarts must work without npm/network access. "latest"
    // always resolves metadata and is used only for the initial opt-in install.
    if (/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(range)) {
      for (const entry of (await readdir(root)).slice(0, 1024)) {
        if (!/^[a-f0-9]{64}$/.test(entry)) continue;
        try {
          const directory = join(root, entry),
            receipt = JSON.parse(
              await readFile(join(directory, 'kitsune-receipt.json'), 'utf8'),
            ) as InstalledPlugin;
          if (receipt.name !== name || receipt.version !== range || blockedPackages.has(name))
            continue;
          archivePath(receipt.entry);
          if ((await stat(join(directory, receipt.entry))).isFile())
            return { ...receipt, directory };
        } catch {
          /* Incomplete receipts do not authorize execution. */
        }
      }
    }
    const packuments = new Map<string, Promise<Packument>>();
    const tarballs = new Map<string, Promise<Buffer>>();
    const fetchTarball = (url: string): Promise<Buffer> => {
      const cached = tarballs.get(url);
      if (cached) return cached;
      const request = boundedFetch(url, 64 * 1024 ** 2, this.fetchRequest).catch((err) => {
        tarballs.delete(url);
        throw err;
      });
      tarballs.set(url, request);
      return request;
    };
    const metadata = await resolvePackage(name, range, this.fetchRequest, packuments);
    const identity = createHash('sha256')
      .update(`${name}@${metadata.version}:${metadata.dist.integrity}`)
      .digest('hex');
    const directory = join(root, identity),
      temporary = join(root, `.install-${randomUUID()}`);
    try {
      const receipt = JSON.parse(
        await readFile(join(directory, 'kitsune-receipt.json'), 'utf8'),
      ) as InstalledPlugin;
      archivePath(receipt.entry);
      if (
        receipt.name === name &&
        receipt.version === metadata.version &&
        receipt.integrity === metadata.dist.integrity &&
        (await stat(join(directory, receipt.entry))).isFile()
      )
        return { ...receipt, directory };
    } catch {
      /* A failed/stale install is never treated as executable. */
    }
    await mkdir(temporary, { mode: 0o700 });
    let packages = 0,
      downloaded = 0;
    const deadline = performance.now() + this.timeoutMs;
    const hoistedByRoot = new Map<string, Map<string, string>>();
    const hoistedMap = (rootDir: string) => {
      let map = hoistedByRoot.get(rootDir);
      if (!map) {
        map = new Map();
        hoistedByRoot.set(rootDir, map);
      }
      return map;
    };
    const install = async (
      meta: PackageMetadata,
      target: string,
      ancestry: string[],
      depth = 0,
      closerOverrides: ReadonlySet<string> = new Set(),
      hoistRoot?: string,
    ): Promise<string> => {
      if (++packages > 384 || depth > 24) throw Error('kitsune_dependency_limit');
      if (performance.now() > deadline) throw Error('kitsune_install_timeout');
      const bytes = await fetchTarball(meta.dist.tarball);
      if (performance.now() > deadline) throw Error('kitsune_install_timeout');
      if ((downloaded += bytes.length) > 256 * 1024 ** 2) throw Error('kitsune_download_limit');
      verifyIntegrity(bytes, meta.dist.integrity);
      const files = await tarFiles(bytes);
      await writeArchive(target, files, 'package/');
      const zip = files.get('package/dist/plugin.zip') ?? files.get('package/plugin.zip');
      let runtime = target,
        entry = meta.main ?? 'index.js';
      if (zip) {
        runtime = join(target, 'zip');
        const unpacked = zipFiles(zip);
        await writeArchive(runtime, unpacked);
        entry = unpacked.has('main.nodejs.js')
          ? 'main.nodejs.js'
          : unpacked.has('main.js')
            ? 'main.js'
            : 'index.js';
      }
      const effectiveRoot = depth === 0 || zip ? runtime : (hoistRoot ?? runtime);
      // Published plugin artifacts bundle common/dev file: dependencies. Only real registry
      // runtime dependencies are installed; SDK is supplied by our process-local interceptor.
      let dependencies = meta.dependencies ?? {};
      if (zip) {
        try {
          dependencies =
            (JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8')) as PackageMetadata)
              .dependencies ?? dependencies;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const lineage = [...ancestry, meta.name];
      const optionalDeps = meta.optionalDependencies ?? {};
      const hoisted = hoistedMap(effectiveRoot);
      const installChild = async (dependency: string, version: string, optional: boolean) => {
        if (shouldSkipChild(dependency, version, optional, zip, lineage)) return;
        if (blockedPackages.has(dependency)) throw Error('kitsune_forbidden_package');
        let childDir: string | undefined;
        try {
          const child = await resolvePackage(dependency, version, this.fetchRequest, packuments);
          const existingVersion = hoisted.get(child.name);
          if (existingVersion === child.version && !closerOverrides.has(child.name)) return;
          const canHoist = existingVersion === undefined && !closerOverrides.has(child.name);
          childDir = canHoist
            ? join(effectiveRoot, 'node_modules', ...child.name.split('/'))
            : join(target, 'node_modules', ...child.name.split('/'));
          const nextOverrides = canHoist
            ? closerOverrides
            : new Set([...closerOverrides, child.name]);
          await install(child, childDir, lineage, depth + 1, nextOverrides, effectiveRoot);
          if (canHoist) hoisted.set(child.name, child.version);
        } catch (error) {
          if (!optional) throw error;
          if (childDir) await rm(childDir, { recursive: true, force: true }).catch(() => undefined);
        }
      };
      const requiredEntries = Object.entries(dependencies).filter(
        ([dependency]) => !Object.hasOwn(optionalDeps, dependency),
      );
      const optionalTargets = collectOptionalTargets(meta, optionalDeps, zip, depth);
      const optionalEntries = Object.entries(optionalTargets);
      const prefetchTargets = [
        ...requiredEntries.filter(
          ([dependency, version]) =>
            !blockedPackages.has(dependency) &&
            !shouldSkipChild(dependency, version, false, zip, lineage),
        ),
        ...optionalEntries.filter(
          ([dependency, version]) =>
            !blockedPackages.has(dependency) &&
            !shouldSkipChild(dependency, version, true, zip, lineage),
        ),
      ];
      await mapBounded(prefetchTargets, PREFETCH_CONCURRENCY, async ([dependency, version]) => {
        try {
          const child = await resolvePackage(dependency, version, this.fetchRequest, packuments);
          if (hoisted.get(child.name) !== child.version || closerOverrides.has(child.name)) {
            await fetchTarball(child.dist.tarball);
          }
        } catch {
          // Sequential installChild below enforces required vs optional error handling.
        }
      });
      for (const [dependency, version] of requiredEntries) {
        await installChild(dependency, version, false);
      }
      for (const [dependency, version] of optionalEntries) {
        await installChild(dependency, version, true);
      }
      return zip ? `zip/${entry}` : entry;
    };
    try {
      const entry = await install(metadata, temporary, []);
      archivePath(entry);
      if (!(await stat(join(temporary, entry))).isFile())
        throw Error('kitsune_plugin_entry_missing');
      const receipt: InstalledPlugin = {
        name,
        version: metadata.version,
        directory,
        entry,
        integrity: metadata.dist.integrity,
        license: metadata.license ?? null,
        pluginDependencies: metadata.scrypted?.pluginDependencies ?? [],
        rootDevice: {
          name: metadata.scrypted?.name ?? name,
          interfaces: metadata.scrypted?.interfaces ?? [],
          type: metadata.scrypted?.type,
        },
      };
      await writeFile(join(temporary, 'kitsune-receipt.json'), JSON.stringify(receipt), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, directory);
      return receipt;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}
