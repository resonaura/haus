/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HacsUpdateManager,
  type HacsUpdateOperation,
} from '../src/index.js';

function createZipBuffer(files: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const entries = Object.entries(files);

  for (const [rawName, content] of entries) {
    const nameBuf = Buffer.from(rawName, 'utf8');
    const dataBuf = Buffer.from(content, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(0, 4);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function buildComponentZip(params: {
  readonly domain: string;
  readonly version: string;
  readonly requirements?: readonly string[];
  readonly minHaVersion?: string;
  readonly extraFiles?: Record<string, string>;
}): Buffer {
  const manifest = {
    domain: params.domain,
    name: `Test ${params.domain}`,
    version: params.version,
    config_flow: true,
    requirements: params.requirements ?? [],
  };
  const files: Record<string, string> = {
    [`custom_components/${params.domain}/manifest.json`]: JSON.stringify(manifest, null, 2),
    [`custom_components/${params.domain}/__init__.py`]: `# version ${params.version}\n`,
    ...params.extraFiles,
  };
  if (params.minHaVersion) {
    files['hacs.json'] = JSON.stringify({
      name: `Test ${params.domain}`,
      homeassistant: params.minHaVersion,
    });
  }
  return createZipBuffer(files);
}

describe('HacsUpdateManager durable lifecycle', () => {
  let tempDir: string;
  let storageDir: string;
  let customComponentsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-hacs-test-'));
    storageDir = join(tempDir, 'storage');
    customComponentsDir = join(tempDir, 'custom_components');
    await mkdir(customComponentsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function seedInstalledComponent(
    domain: string,
    version: string,
    requirements: readonly string[] = [],
  ): Promise<void> {
    const dir = join(customComponentsDir, domain);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({ domain, name: domain, version, requirements }, null, 2),
    );
    await writeFile(join(dir, '__init__.py'), `# initial ${version}\n`);
  }

  it('completes review -> download -> prepare -> activate -> verify with byte progress', async () => {
    await seedInstalledComponent('xiaomi_miot', '1.0.0');
    const zip = buildComponentZip({
      domain: 'xiaomi_miot',
      version: '1.2.0',
      minHaVersion: '2025.1.0',
    });
    const phases: string[] = [];
    const bytesSeen: Array<{ received: number; total?: number }> = [];

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      hooks: {
        getRuntimeHaVersion: () => '2026.4.0',
        getAffectedEntries: async () => ['entry-xiaomi-1'],
        onProgress: (op) => {
          phases.push(op.phase);
          if (op.phase === 'download') {
            bytesSeen.push({ received: op.bytesReceived, total: op.totalBytes });
          }
        },
      },
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({
              tag_name: 'v1.2.0',
              html_url: 'https://github.com/al-one/hass-xiaomi-miot/releases/tag/v1.2.0',
              body: 'Bug fixes',
              assets: [
                {
                  name: 'xiaomi_miot.zip',
                  browser_download_url: 'https://example.test/xiaomi_miot.zip',
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (u === 'https://example.test/xiaomi_miot.zip') {
          return new Response(zip, {
            status: 200,
            headers: { 'content-length': String(zip.byteLength) },
          });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch,
    });

    const op = await manager.installUpdate('hacs:xiaomi_miot');
    expect(op.phase).toBe('installed');
    expect(op.installedVersion).toBe('1.0.0');
    expect(op.targetVersion).toBe('1.2.0');
    expect(op.runningVersion).toBe('1.2.0');
    expect(op.compatibility).toBe('verified');
    expect(op.bytesReceived).toBe(zip.byteLength);
    expect(op.totalBytes).toBe(zip.byteLength);
    expect(phases).toContain('review');
    expect(phases).toContain('download');
    expect(phases).toContain('prepare');
    expect(phases).toContain('activate');
    expect(phases).toContain('verify');
    expect(bytesSeen.some((b) => b.received === zip.byteLength && b.total === zip.byteLength)).toBe(
      true,
    );

    const activeInit = await readFile(join(customComponentsDir, 'xiaomi_miot', '__init__.py'), 'utf8');
    expect(activeInit).toContain('# version 1.2.0');
  });

  it('reports indeterminate totalBytes when Content-Length header is absent and deduplicates concurrent installs', async () => {
    await seedInstalledComponent('meross_lan', '5.0.0');
    const zip = buildComponentZip({ domain: 'meross_lan', version: '5.1.0' });
    let downloadCalls = 0;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({
              tag_name: 'v5.1.0',
              zipball_url: 'https://example.test/meross.zip',
            }),
            { status: 200 },
          );
        }
        if (u === 'https://example.test/meross.zip') {
          downloadCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return new Response(zip, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch,
    });

    const [op1, op2] = await Promise.all([
      manager.installUpdate('hacs:meross_lan'),
      manager.installUpdate('meross_lan'),
    ]);

    expect(op1.operationId).toBe(op2.operationId);
    expect(downloadCalls).toBe(1);
    expect(op1.totalBytes).toBeUndefined();
    expect(op1.bytesReceived).toBe(zip.byteLength);
  });

  it('rejects tampered digest, unsafe archive traversal, and unexpected component domain without mutating active code', async () => {
    await seedInstalledComponent('sensibo', '1.0.0');
    const validZip = buildComponentZip({ domain: 'sensibo', version: '1.1.0' });
    const wrongDomainZip = buildComponentZip({ domain: 'other_domain', version: '1.1.0' });
    const traversalZip = createZipBuffer({
      '../escaped.py': 'print("pwn")\n',
      'custom_components/sensibo/manifest.json': JSON.stringify({
        domain: 'sensibo',
        name: 'Sensibo',
        version: '1.1.0',
      }),
    });

    let activeZip = validZip;
    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({ tag_name: 'v1.1.0', zipball_url: 'https://example.test/pkg.zip' }),
            { status: 200 },
          );
        }
        return new Response(activeZip, { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      manager.installUpdate('hacs:sensibo', {
        expectedDigest: createHash('sha256').update('wrong').digest('hex'),
      }),
    ).rejects.toThrow(/artifact_integrity_failed/);

    activeZip = wrongDomainZip;
    await expect(manager.installUpdate('hacs:sensibo')).rejects.toThrow(
      /unexpected_component_domain/,
    );

    activeZip = traversalZip;
    await expect(manager.installUpdate('hacs:sensibo')).rejects.toThrow(
      /kitsune_unsafe_archive_path/,
    );

    const activeInit = await readFile(join(customComponentsDir, 'sensibo', '__init__.py'), 'utf8');
    expect(activeInit).toBe('# initial 1.0.0\n');
  });

  it('rejects incompatible HA version and shared Python dependency conflicts prior to activation', async () => {
    await seedInstalledComponent('other_comp', '1.0.0', ['pycryptodome==3.19.0']);
    await seedInstalledComponent('localtuya', '5.0.0', ['pycryptodome==3.19.0']);

    let minHa = '2099.1.0';
    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      hooks: {
        getRuntimeHaVersion: () => '2026.4.0',
      },
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({ tag_name: 'v5.2.2', zipball_url: 'https://example.test/lt.zip' }),
            { status: 200 },
          );
        }
        return new Response(
          buildComponentZip({
            domain: 'localtuya',
            version: '5.2.2',
            minHaVersion: minHa,
            requirements: ['pycryptodome==3.20.0'],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    await expect(manager.installUpdate('hacs:localtuya')).rejects.toThrow(
      /incompatible_ha_version/,
    );

    minHa = '2025.1.0';
    await expect(manager.installUpdate('hacs:localtuya')).rejects.toThrow(/dependency_conflict/);
  });

  it('supports default-branch commit fallback when repo has no releases, activate:false, and rate-limit errors', async () => {
    await seedInstalledComponent('sonoff', '3.5.0');
    const zip = buildComponentZip({ domain: 'sonoff', version: '3.6.0' });
    let rateLimited = false;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (rateLimited) {
          return new Response('rate limit', {
            status: 403,
            headers: { 'x-ratelimit-remaining': '0' },
          });
        }
        if (u.endsWith('/releases/latest') || u.includes('/releases?')) {
          return new Response('[]', { status: 200 });
        }
        if (u.includes('/commits/master') || u.includes('/commits/main')) {
          return new Response(
            JSON.stringify({
              sha: 'abcdef1234567890',
              html_url: 'https://github.com/AlexxIT/SonoffLAN/commit/abcdef1',
              commit: { message: 'Main branch commit\nDetails' },
            }),
            { status: 200 },
          );
        }
        if (u.includes('/zipball/abcdef1234567890')) {
          return new Response(zip, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }) as typeof fetch,
    });

    const stagedOnly = await manager.installUpdate('hacs:sonoff', { activate: false });
    expect(stagedOnly.phase).toBe('downloaded_not_activated');
    expect(stagedOnly.runningVersion).toBe('3.5.0');
    expect(stagedOnly.targetVersion).toBe('3.6.0');

    const reposAfterStage = await manager.listRepositories([], false);
    const sonoffRepo = reposAfterStage.find((r) => r.domain === 'sonoff');
    expect(sonoffRepo?.pending_restart).toBe(true);

    rateLimited = true;
    await expect(manager.installUpdate('hacs:sonoff', { version: '3.7.0' })).rejects.toThrow(
      /github_rate_limited/,
    );
  });

  it('rolls back automatically when post-activation verification fails and blocks after unresolved migration', async () => {
    await seedInstalledComponent('tapo', '2.0.0');
    const zip = buildComponentZip({ domain: 'tapo', version: '3.0.0' });
    let failMode: 'recoverable' | 'irreversible' = 'recoverable';
    let restoredVersion: string | undefined;

    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      hooks: {
        getAffectedEntries: async () => ['entry-tapo-1'],
        captureEntryCheckpoint: async () => [
          { entryId: 'entry-tapo-1', domain: 'tapo', version: '2.0.0' },
        ],
        restoreEntryCheckpoint: async (_domain, cp) => {
          restoredVersion = cp[0]?.version;
        },
        verifyActivation: async () =>
          failMode === 'recoverable'
            ? { ok: false, reason: 'setup_error:ImportError' }
            : {
                ok: false,
                reason: 'migration_schema_mismatch',
                irreversibleMigration: true,
              },
      },
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({ tag_name: 'v3.0.0', zipball_url: 'https://example.test/tapo.zip' }),
            { status: 200 },
          );
        }
        return new Response(zip, { status: 200 });
      }) as typeof fetch,
    });

    await expect(manager.installUpdate('hacs:tapo')).rejects.toThrow(/setup_error:ImportError/);
    const ops1 = manager.listOperations();
    const last1 = ops1[ops1.length - 1] as HacsUpdateOperation;
    expect(last1.phase).toBe('rolled_back');
    expect(last1.failedPhase).toBe('verify');
    expect(last1.rollbackOutcome).toBe('restored');
    expect(last1.runningVersion).toBe('2.0.0');
    expect(restoredVersion).toBe('2.0.0');

    const restoredInit = await readFile(join(customComponentsDir, 'tapo', '__init__.py'), 'utf8');
    expect(restoredInit).toBe('# initial 2.0.0\n');

    failMode = 'irreversible';
    await expect(manager.installUpdate('hacs:tapo')).rejects.toThrow(/migration_schema_mismatch/);
    const ops2 = manager.listOperations();
    const last2 = ops2[ops2.length - 1] as HacsUpdateOperation;
    expect(last2.phase).toBe('failed');
    expect(last2.rollbackOutcome).toBe('unresolved_migration');

    await expect(manager.installUpdate('hacs:tapo')).rejects.toThrow(
      /unresolved_previous_operation/,
    );
  });

  it('recovers interrupted operations on restart and isolates failures in batch updates', async () => {
    await seedInstalledComponent('govee_lan', '1.0.0');
    await seedInstalledComponent('ble_monitor', '12.0.0');

    const backupDir = join(storageDir, 'hacs-backup', 'govee_lan-op-interrupted');
    await mkdir(backupDir, { recursive: true });
    await writeFile(
      join(backupDir, 'manifest.json'),
      JSON.stringify({ domain: 'govee_lan', name: 'Govee LAN', version: '1.0.0' }),
    );
    await writeFile(join(backupDir, '__init__.py'), '# backup 1.0.0\n');
    await writeFile(join(customComponentsDir, 'govee_lan', '__init__.py'), '# partial 2.0.0\n');

    await mkdir(storageDir, { recursive: true });
    await writeFile(
      join(storageDir, 'hacs-operations.json'),
      JSON.stringify([
        {
          operationId: 'op-interrupted',
          targetId: 'hacs:govee_lan',
          repositoryId: '100000010',
          repository: 'wez/govee-lan-hass',
          domain: 'govee_lan',
          title: 'Govee LAN',
          installedVersion: '1.0.0',
          targetVersion: '2.0.0',
          phase: 'activate',
          revision: 3,
          bytesReceived: 100,
          compatibility: 'verified',
          affectedEntries: [],
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );

    const zipBle = buildComponentZip({ domain: 'ble_monitor', version: '12.1.0' });
    const manager = new HacsUpdateManager({
      storageDir,
      customComponentsDir,
      fetchFn: (async (url: string | URL) => {
        const u = String(url);
        if (u.includes('ble_monitor') && u.endsWith('/releases/latest')) {
          return new Response(
            JSON.stringify({ tag_name: 'v12.1.0', zipball_url: 'https://example.test/ble.zip' }),
            { status: 200 },
          );
        }
        if (u === 'https://example.test/ble.zip') {
          return new Response(zipBle, { status: 200 });
        }
        return new Response('error', { status: 500 });
      }) as typeof fetch,
    });

    const recovered = await manager.recoverInterruptedOperations();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.phase).toBe('rolled_back');
    expect(recovered[0]?.rollbackOutcome).toBe('restored');
    const goveeInit = await readFile(join(customComponentsDir, 'govee_lan', '__init__.py'), 'utf8');
    expect(goveeInit).toBe('# backup 1.0.0\n');

    const batch = await manager.installBatch(['hacs:ble_monitor', 'hacs:govee_lan']);
    expect(batch.completedCount).toBe(1);
    expect(batch.totalCount).toBe(2);
    expect(batch.succeeded).toHaveLength(1);
    expect(batch.succeeded[0]?.domain).toBe('ble_monitor');
    expect(batch.failed).toHaveLength(1);
    expect(batch.failed[0]?.domain).toBe('govee_lan');
  });
});
