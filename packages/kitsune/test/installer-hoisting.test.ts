/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as tarCreate } from 'tar';
import { onTestFinished, test } from 'vitest';
import { PluginInstaller } from '../dist/index.js';

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'haus-kitsune-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('installer deduplicates dependencies and resolves nested optionalDependencies, optional peerDependencies, and native .node prebuilds', async () => {
  const directory = await temporary();
  const buildTarball = async (name: string, files: Record<string, string | Buffer>) => {
    const stage = join(directory, 'stage', name.replace('/', '__'));
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(stage, 'package', relPath);
      await mkdir(join(fullPath, '..'), { recursive: true });
      await writeFile(fullPath, content);
    }
    const outFile = join(directory, `${name.replace('/', '__')}.tgz`);
    await tarCreate({ cwd: stage, gzip: true, file: outFile }, ['package']);
    const bytes = await readFile(outFile);
    return {
      bytes,
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    };
  };

  const pkgs = {
    '@fixture/ble-plugin': {
      version: '1.0.0',
      dependencies: { debug: '^4.3.7' },
      optionalDependencies: { '@stoprocent/noble': '^2.8.0' },
      files: {
        'package.json': JSON.stringify({
          name: '@fixture/ble-plugin',
          version: '1.0.0',
          main: 'index.js',
        }),
        'index.js': 'module.exports = {};',
      },
    },
    '@stoprocent/noble': {
      version: '2.8.0',
      dependencies: { debug: '^4.3.7' },
      optionalDependencies: {
        '@stoprocent/bluetooth-hci-socket': '^2.3.0',
        '@missing/opt': '^1.0.0',
      },
      peerDependencies: { 'dbus-next': '^0.10.2', homebridge: '^1.8.0' },
      peerDependenciesMeta: { 'dbus-next': { optional: true } },
      files: {
        'package.json': JSON.stringify({
          name: '@stoprocent/noble',
          version: '2.8.0',
          main: 'index.js',
        }),
        'index.js': 'module.exports = {};',
        'prebuilds/darwin-x64+arm64/node.napi.node': Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
      },
    },
    '@stoprocent/bluetooth-hci-socket': {
      version: '2.3.0',
      files: {
        'package.json': JSON.stringify({
          name: '@stoprocent/bluetooth-hci-socket',
          version: '2.3.0',
          main: 'index.js',
        }),
        'index.js': 'module.exports = {};',
        'prebuilds/linux-x64/@stoprocent+bluetooth-hci-socket.glibc.node': Buffer.from([
          0x7f, 0x45, 0x4c, 0x46,
        ]),
      },
    },
    'dbus-next': {
      version: '0.10.2',
      dependencies: { usocket: '^0.3.0' },
      optionalDependencies: { usocket: '^0.3.0' },
      files: {
        'package.json': JSON.stringify({ name: 'dbus-next', version: '0.10.2', main: 'index.js' }),
        'index.js': 'module.exports = {};',
      },
    },
    debug: {
      version: '4.3.7',
      files: {
        'package.json': JSON.stringify({ name: 'debug', version: '4.3.7', main: 'index.js' }),
        'index.js': 'module.exports = {};',
      },
    },
  } as const;

  const built = new Map<
    string,
    { metadata: Record<string, unknown>; bytes: Buffer; tarballUrl: string }
  >();
  for (const [name, spec] of Object.entries(pkgs)) {
    const { bytes, integrity } = await buildTarball(name, spec.files);
    const tarballUrl = `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${spec.version}.tgz`;
    built.set(name, {
      bytes,
      tarballUrl,
      metadata: {
        name,
        version: spec.version,
        main: 'index.js',
        ...('dependencies' in spec ? { dependencies: spec.dependencies } : {}),
        ...('optionalDependencies' in spec
          ? { optionalDependencies: spec.optionalDependencies }
          : {}),
        ...('peerDependencies' in spec ? { peerDependencies: spec.peerDependencies } : {}),
        ...('peerDependenciesMeta' in spec
          ? { peerDependenciesMeta: spec.peerDependenciesMeta }
          : {}),
        dist: { tarball: tarballUrl, integrity },
      },
    });
  }

  const fetchedTargets: string[] = [];
  const tarballDownloads = new Map<string, number>();
  const fetchRequest: typeof fetch = async (url) => {
    const target = String(url);
    fetchedTargets.push(target);
    for (const [name, entry] of built.entries()) {
      if (target === entry.tarballUrl) {
        tarballDownloads.set(name, (tarballDownloads.get(name) ?? 0) + 1);
        return new Response(new Uint8Array(entry.bytes), { status: 200 });
      }
      if (target === `https://registry.npmjs.org/${encodeURIComponent(name)}`) {
        const meta = entry.metadata as { version: string };
        return new Response(
          JSON.stringify({
            'dist-tags': { latest: meta.version },
            versions: { [meta.version]: entry.metadata },
          }),
          { status: 200 },
        );
      }
    }
    return new Response('not found', { status: 404 });
  };

  const installed = await new PluginInstaller(directory, fetchRequest).install(
    '@fixture/ble-plugin',
  );
  assert.equal(tarballDownloads.get('debug'), 1);
  assert.equal(tarballDownloads.get('@stoprocent/noble'), 1);
  assert.equal(tarballDownloads.get('@stoprocent/bluetooth-hci-socket'), 1);
  assert.equal(tarballDownloads.get('dbus-next'), 1);
  assert.ok(!fetchedTargets.some((url) => url.includes('homebridge')));
  assert.ok(!fetchedTargets.some((url) => url.includes('usocket')));

  const noblePrebuild = await readFile(
    join(
      installed.directory,
      'node_modules',
      '@stoprocent',
      'noble',
      'prebuilds',
      'darwin-x64+arm64',
      'node.napi.node',
    ),
  );
  assert.deepEqual(noblePrebuild, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  const hciPrebuild = await readFile(
    join(
      installed.directory,
      'node_modules',
      '@stoprocent',
      'bluetooth-hci-socket',
      'prebuilds',
      'linux-x64',
      '@stoprocent+bluetooth-hci-socket.glibc.node',
    ),
  );
  assert.deepEqual(hciPrebuild, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const dbusEntry = await readFile(
    join(installed.directory, 'node_modules', 'dbus-next', 'index.js'),
    'utf8',
  );
  assert.equal(dbusEntry, 'module.exports = {};');
});

test('installer deduplicates shared transitive packument fetches and honors custom timeoutMs', async () => {
  const directory = await temporary();
  const packumentCounts = new Map<string, number>();
  const buildPkg = async (name: string, version: string, dependencies?: Record<string, string>) => {
    const stage = join(directory, 'stage2', name.replace('/', '__'));
    await mkdir(join(stage, 'package'), { recursive: true });
    await writeFile(
      join(stage, 'package', 'package.json'),
      JSON.stringify({ name, version, main: 'index.js', dependencies }),
    );
    await writeFile(join(stage, 'package', 'index.js'), `exports.name = ${JSON.stringify(name)};`);
    const outFile = join(directory, `p2-${name.replace('/', '__')}.tgz`);
    await tarCreate({ cwd: stage, gzip: true, file: outFile }, ['package']);
    const bytes = await readFile(outFile);
    const tarball = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
    return {
      bytes,
      tarball,
      metadata: {
        name,
        version,
        main: 'index.js',
        ...(dependencies ? { dependencies } : {}),
        dist: {
          tarball,
          integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
        },
      },
    };
  };

  const pkgs = {
    'root-pkg': await buildPkg('root-pkg', '1.0.0', { alpha: '^1.0.0', beta: '^1.0.0' }),
    alpha: await buildPkg('alpha', '1.0.0', { shared: '^1.0.0' }),
    beta: await buildPkg('beta', '1.0.0', { shared: '^1.0.0' }),
    shared: await buildPkg('shared', '1.0.0'),
  };

  const fetchRequest: typeof fetch = async (url) => {
    const target = String(url);
    for (const [name, pkg] of Object.entries(pkgs)) {
      if (target === pkg.tarball) {
        return new Response(new Uint8Array(pkg.bytes), { status: 200 });
      }
      if (target === `https://registry.npmjs.org/${encodeURIComponent(name)}`) {
        packumentCounts.set(name, (packumentCounts.get(name) ?? 0) + 1);
        return new Response(
          JSON.stringify({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': pkg.metadata } }),
          { status: 200 },
        );
      }
    }
    return new Response('not found', { status: 404 });
  };

  const installed = await new PluginInstaller(directory, fetchRequest).install('root-pkg');
  assert.equal(installed.version, '1.0.0');
  assert.equal(packumentCounts.get('shared'), 1);

  const dirTimeout = await temporary();
  const slowFetch: typeof fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('.tgz')) {
      await new Promise((r) => setTimeout(r, 40));
    }
    return fetchRequest(url);
  };
  await assert.rejects(
    new PluginInstaller(dirTimeout, slowFetch, { timeoutMs: 15 }).install('root-pkg'),
    /kitsune_install_timeout/,
  );
});
