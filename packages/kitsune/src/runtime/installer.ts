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
} from './registry.js';

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
export class PluginInstaller {
  private pending = new Map<string, Promise<InstalledPlugin>>();
  constructor(
    readonly dataDirectory: string,
    private readonly fetchRequest = fetch,
  ) {}
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
    const metadata = await resolvePackage(name, range, this.fetchRequest);
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
    const deadline = performance.now() + 120000;
    const install = async (
      meta: PackageMetadata,
      target: string,
      ancestry: string[],
      depth = 0,
    ): Promise<string> => {
      if (++packages > 256 || depth > 24) throw Error('kitsune_dependency_limit');
      if (performance.now() > deadline) throw Error('kitsune_install_timeout');
      const bytes = await boundedFetch(meta.dist.tarball, 64 * 1024 ** 2, this.fetchRequest);
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
      for (const [dependency, version] of Object.entries(dependencies)) {
        if (dependency === '@scrypted/sdk') continue;
        if (blockedPackages.has(dependency)) throw Error('kitsune_forbidden_package');
        if (version.startsWith('file:') && zip) continue;
        if (lineage.includes(dependency)) continue; // Node resolves the already installed ancestor.
        const child = await resolvePackage(dependency, version, this.fetchRequest);
        await install(
          child,
          join(runtime, 'node_modules', ...dependency.split('/')),
          lineage,
          depth + 1,
        );
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
