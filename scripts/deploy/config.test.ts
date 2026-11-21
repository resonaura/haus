/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  collectDeployFiles,
  matchesIncludePaths,
  parseCliArgs,
  parseDeployConfig,
  shouldPreservePath,
} from './config.ts';
import { shellQuote } from './remote.ts';

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('deploy-hubs config & manifest safety', () => {
  it('parses the committed deploy-hubs.example.json template cleanly', async () => {
    const raw = JSON.parse(
      await readFile(resolve('scripts/deploy-hubs.example.json'), 'utf8'),
    ) as unknown;
    const config = parseDeployConfig(raw);
    assert.equal(config.targets.length, 2);
    assert.equal(config.targets[0]?.role, 'standby');
    assert.equal(config.targets[1]?.role, 'primary');
    assert.ok(config.targets[0]?.preservePaths.includes('dist/auth/'));
    assert.ok(config.targets[0]?.preservePaths.includes('dist/nest.js'));
    assert.equal(config.targets[0]?.patchNestBodyParser, true);
  });

  it('rejects unsafe container names, path traversal, invalid healthUrl, and duplicate targets', () => {
    const baseTarget = {
      name: 'pi',
      role: 'primary',
      ssh: 'user@192.168.1.10',
      container: 'haus-hub',
      containerAppDir: '/app',
      healthUrl: 'http://127.0.0.1:8790/health',
      backupDir: '/home/user/backups',
      preservePaths: ['dist/auth/'],
    };
    const wrap = (targets: unknown[]) => ({
      schemaVersion: 1,
      buildCommands: [],
      mappings: [{ localDir: 'apps/hub/dist', containerDir: 'dist' }],
      targets,
    });

    assert.throws(
      () => parseDeployConfig(wrap([{ ...baseTarget, container: 'haus;rm -rf /' }])),
      /Unsafe container name/,
    );
    assert.throws(
      () => parseDeployConfig(wrap([{ ...baseTarget, ssh: 'user@host;id' }])),
      /Unsafe ssh target/,
    );
    assert.throws(
      () => parseDeployConfig(wrap([{ ...baseTarget, containerAppDir: '/app/../etc' }])),
      /Invalid containerAppDir/,
    );
    assert.throws(
      () => parseDeployConfig(wrap([{ ...baseTarget, healthUrl: 'file:///etc/passwd' }])),
      /http or https/,
    );
    assert.throws(
      () => parseDeployConfig(wrap([{ ...baseTarget, preservePaths: ['../secret'] }])),
      /Invalid relative deploy path/,
    );
    assert.throws(() => parseDeployConfig(wrap([baseTarget, baseTarget])), /Duplicate target name/);
  });

  it('evaluates preservePaths and include filters accurately', () => {
    assert.equal(shouldPreservePath('dist/auth/service.js', ['dist/auth/']), true);
    assert.equal(shouldPreservePath('dist/nest.js', ['dist/nest.js']), true);
    assert.equal(
      shouldPreservePath('dist/home/scene-dispatch.js', ['dist/auth/', 'dist/nest.js']),
      false,
    );
    assert.equal(matchesIncludePaths('dist/home/scene-dispatch.js', ['dist/home/']), true);
    assert.equal(matchesIncludePaths('dist/events/bus.js', ['dist/home/']), false);
    assert.equal(matchesIncludePaths('dist/events/bus.js', undefined), true);
  });

  it('collects only allowed runtime files, excludes macOS junk & preserved paths, and hashes SHA-256', async () => {
    const root = await mkdtemp(join(tmpdir(), 'haus-deploy-test-'));
    tempDirs.push(root);
    await mkdir(join(root, 'hub/dist/home'), { recursive: true });
    await mkdir(join(root, 'hub/dist/auth'), { recursive: true });
    await mkdir(join(root, 'kitsune/dist/ha-flow'), { recursive: true });

    await writeFile(join(root, 'hub/dist/home/scene-dispatch.js'), 'export const ok = 1;\n');
    await writeFile(join(root, 'hub/dist/home/scene-dispatch.d.ts'), 'export const ok: number;\n');
    await writeFile(join(root, 'hub/dist/home/scene-dispatch.js.map'), '{}');
    await writeFile(join(root, 'hub/dist/home/._scene-dispatch.js'), 'mac-junk');
    await writeFile(join(root, 'hub/dist/home/.DS_Store'), 'mac-junk');
    await writeFile(join(root, 'hub/dist/auth/service.js'), 'secret-auth');
    await writeFile(join(root, 'kitsune/dist/ha-flow/entities.py'), 'def ok():\n    return True\n');

    const config = parseDeployConfig({
      schemaVersion: 1,
      buildCommands: [],
      mappings: [
        { localDir: 'hub/dist', containerDir: 'dist' },
        { localDir: 'kitsune/dist', containerDir: 'node_modules/@haus/kitsune/dist' },
      ],
      targets: [
        {
          name: 'pi',
          role: 'primary',
          ssh: 'user@192.168.1.10',
          container: 'haus-hub',
          containerAppDir: '/app',
          healthUrl: 'http://127.0.0.1:8790/health',
          backupDir: '/home/user/backups',
          include: ['dist/home/', 'node_modules/@haus/kitsune/dist/ha-flow/'],
          preservePaths: ['dist/auth/'],
        },
      ],
    });

    const target = config.targets[0];
    assert.ok(target);

    const files = await collectDeployFiles(root, config.mappings, target);
    assert.deepEqual(
      files.map((f) => f.relPath),
      ['dist/home/scene-dispatch.js', 'node_modules/@haus/kitsune/dist/ha-flow/entities.py'],
    );
    assert.match(files[0]?.sha256 ?? '', /^[0-9a-f]{64}$/);

    const filtered = await collectDeployFiles(root, config.mappings, target, ['dist/home/']);
    assert.deepEqual(
      filtered.map((f) => f.relPath),
      ['dist/home/scene-dispatch.js'],
    );
  });

  it('parses CLI flags and safely quotes shell arguments', () => {
    assert.deepEqual(
      parseCliArgs([
        '--',
        '--dry-run',
        '--skip-build',
        '--target',
        'miku,pi',
        '--paths',
        'dist/home/',
      ]),
      {
        configPath: '.local/deploy-hubs.json',
        targetNames: ['miku', 'pi'],
        pathFilters: ['dist/home/'],
        dryRun: true,
        skipBuild: true,
        rollback: false,
        backupId: undefined,
        status: false,
        help: false,
      },
    );

    const rb = parseCliArgs(['--rollback', 'pi', '--backup', '20261120-010000']);
    assert.equal(rb.rollback, true);
    assert.deepEqual(rb.targetNames, ['pi']);
    assert.equal(rb.backupId, '20261120-010000');

    assert.throws(() => parseCliArgs(['--unknown-flag']), /Unknown CLI argument/);
    assert.equal(shellQuote("a'b;rm -rf /"), "'a'\\''b;rm -rf /'");
  });
});
