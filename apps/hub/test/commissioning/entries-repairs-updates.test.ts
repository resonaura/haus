/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { HubRepairsService } from '../../src/commissioning/repairs.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HubUpdatesService } from '../../src/commissioning/updates.js';

const mockHomekit = {
  discoverAccessories: async () => [],
} as unknown as HomeKitControllerService;

describe('Hub Integration Entries, Repairs, and Updates persistence', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    delete process.env.HAUS_DATA_DIR;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('persists multi-account integration entries across restarts and redacts secrets', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-entries-test-'));
    const dbPath = join(tempDir, 'haus.sqlite');

    // Boot 1
    const ds1 = await openCatalog(dbPath);
    const tx1 = new Transactions(ds1);
    const entries1 = new HubIntegrationEntryService(undefined, tx1, undefined);
    await entries1.onModuleInit();
    const comm1 = new CommissioningService(mockHomekit, undefined, undefined, entries1);

    // Account 1 via Xiaomi Miot multi-step menu
    const s1 = await comm1.startFlow({ domain: 'xiaomi_miot', homeId: 'home-1', userId: 'u1' });
    await comm1.submitFlowStep({ flowId: s1.flowId, homeId: 'home-1', userId: 'u1', values: { next_step_id: 'cloud' } });
    await comm1.submitFlowStep({
      flowId: s1.flowId,
      homeId: 'home-1',
      userId: 'u1',
      values: { username: '8210526797', password: 'super-secret-password', server_country: 'cn', conn_mode: 'auto' },
    });
    const done1 = await comm1.submitFlowStep({
      flowId: s1.flowId,
      homeId: 'home-1',
      userId: 'u1',
      values: { filter_mode: 'exclude', poll_interval: 30 },
    });
    expect(done1.type).toBe('create_entry');

    // Account 2 via HA-style Tuya user_code -> scan flow
    const t1 = await comm1.startFlow({ domain: 'tuya', homeId: 'home-1', userId: 'u1' });
    expect(t1.stepId).toBe('user');
    const tScan = await comm1.submitFlowStep({
      flowId: t1.flowId,
      homeId: 'home-1',
      userId: 'u1',
      values: { user_code: 'SmartCode1' },
    });
    expect(tScan.stepId).toBe('scan');
    const done2 = await comm1.submitFlowStep({
      flowId: t1.flowId,
      homeId: 'home-1',
      userId: 'u1',
      values: {},
    });
    expect(done2.type).toBe('create_entry');

    // Update options on entry 1
    const optStart = await comm1.startFlow({
      domain: 'xiaomi_miot',
      source: 'options',
      entryId: done1.result?.entryId,
      homeId: 'home-1',
      userId: 'u1',
    });
    expect(optStart.stepId).toBe('init');
    await comm1.submitFlowStep({
      flowId: optStart.flowId,
      homeId: 'home-1',
      userId: 'u1',
      values: { conn_mode: 'local', poll_interval: 15 },
    });

    entries1.onModuleDestroy();
    await ds1.destroy();

    // Boot 2: reload from SQLite
    const ds2 = await openCatalog(dbPath);
    const tx2 = new Transactions(ds2);
    const entries2 = new HubIntegrationEntryService(undefined, tx2, undefined);
    await entries2.onModuleInit();

    const loaded = await entries2.listEntries();
    expect(loaded).toHaveLength(2);
    const xiaomi = loaded.find((e) => e.domain === 'xiaomi_miot');
    const tuya = loaded.find((e) => e.domain === 'tuya');
    expect(xiaomi?.title).toBe('Xiaomi: 8210526797');
    expect(xiaomi?.data.username).toBe('8210526797');
    expect(xiaomi?.data.password).toBeUndefined();
    expect(xiaomi?.options).toMatchObject({ conn_mode: 'local', poll_interval: 15 });
    expect(tuya?.title).toBe('Tuya (SmartCode1)');
    expect(tuya?.data.user_code).toBe('SmartCode1');

    // Delete & reload checks
    await entries2.setDisabled(tuya!.entry_id, true);
    expect((await entries2.getEntry(tuya!.entry_id))?.disabled_by).toBe('user');
    await entries2.setDisabled(tuya!.entry_id, false);
    expect((await entries2.getEntry(tuya!.entry_id))?.state).toBe('loaded');
    await entries2.deleteEntry(tuya!.entry_id);
    expect(await entries2.listEntries()).toHaveLength(1);

    entries2.onModuleDestroy();
    await ds2.destroy();
  });

  it('tracks broken entries as repair issues, supports ignore, and fixes via interactive flow', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-repairs-test-'));
    const ds = await openCatalog(join(tempDir, 'haus.sqlite'));
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();
    const comm = new CommissioningService(mockHomekit, undefined, undefined, entries);
    const repairs = new HubRepairsService(comm, entries, undefined, tx, undefined);
    await repairs.onModuleInit();

    const s1 = await comm.startFlow({ domain: 'xiaomi_miot', homeId: 'h', userId: 'u' });
    await comm.submitFlowStep({ flowId: s1.flowId, homeId: 'h', userId: 'u', values: { next_step_id: 'local' } });
    const created = await comm.submitFlowStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: { host: '192.168.1.77', token: '0123456789abcdef0123456789abcdef', name: 'Kettle' },
    });
    const entryId = created.result!.entryId!;

    await entries.setEntryState(entryId, 'setup_error', 'Xiaomi authentication failed');
    const issues = await repairs.listIssues();
    expect(issues.some((i) => i.domain === 'xiaomi_miot' && i.entryId === entryId)).toBe(true);
    const issue = issues.find((i) => i.entryId === entryId)!;

    await repairs.ignoreIssue(issue.domain, issue.issue_id, true);
    expect((await repairs.listIssues()).find((i) => i.issue_id === issue.issue_id)?.ignored).toBe(true);
    await repairs.ignoreIssue(issue.domain, issue.issue_id, false);

    const fixStart = await repairs.startFixFlow({
      handler: issue.domain,
      issueId: issue.issue_id,
      homeId: 'h',
      userId: 'u',
    });
    expect(fixStart.type).toBe('menu');

    await repairs.submitFixStep({
      flowId: fixStart.flowId,
      homeId: 'h',
      userId: 'u',
      nextStepId: 'local',
      values: { next_step_id: 'local' },
    });
    const fixDone = await repairs.submitFixStep({
      flowId: fixStart.flowId,
      homeId: 'h',
      userId: 'u',
      values: { host: '192.168.1.77', token: 'fedcba9876543210fedcba9876543210' },
    });
    expect(fixDone.type).toBe('create_entry');
    expect((await entries.getEntry(entryId))?.state).toBe('loaded');
    expect((await repairs.listIssues()).some((i) => i.entryId === entryId)).toBe(false);

    repairs.onModuleDestroy();
    entries.onModuleDestroy();
    await ds.destroy();
  });

  it('aggregates unified updates for npm plugins, HACS repos, and HA catalog', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-updates-test-'));
    process.env.HAUS_DATA_DIR = tempDir;
    const pluginDir = join(tempDir, 'kitsune', 'plugins', 'a'.repeat(64));
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, 'kitsune-receipt.json'),
      JSON.stringify({ name: 'homebridge-govee', version: '10.0.0', entry: 'index.js', integrity: 'sha512-x' }),
    );

    const ds = await openCatalog(join(tempDir, 'haus.sqlite'));
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();
    const comm = new CommissioningService(mockHomekit, undefined, undefined, entries);

    // Seed configured HACS domain (xiaomi_miot)
    const s1 = await comm.startFlow({ domain: 'xiaomi_miot', homeId: 'h', userId: 'u' });
    await comm.submitFlowStep({ flowId: s1.flowId, homeId: 'h', userId: 'u', values: { next_step_id: 'local' } });
    await comm.submitFlowStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: { host: '192.168.1.78', token: '0123456789abcdef0123456789abcdef' },
    });

    const updates = new HubUpdatesService(comm, entries, undefined);
    updates.setFetchForTesting(async (url) => {
      const target = String(url);
      if (target.includes('registry.npmjs.org/homebridge-govee/latest')) {
        return new Response(JSON.stringify({ version: '10.2.1' }), { status: 200 });
      }
      if (target.includes('api.github.com/repos/al-one/hass-xiaomi-miot/releases/latest')) {
        return new Response(
          JSON.stringify({ tag_name: 'v1.1.5', html_url: 'https://github.com/al-one/hass-xiaomi-miot/releases/v1.1.5' }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const result = await updates.listUpdates(true);
    const hb = result.items.find((i) => i.domain === 'homebridge-govee');
    const hacs = result.items.find((i) => i.domain === 'xiaomi_miot');
    expect(hb?.category).toBe('homebridge');
    expect(hb?.updateAvailable).toBe(true);
    expect(hb?.latestVersion).toBe('10.2.1');
    expect(hacs?.category).toBe('hacs');
    expect(hacs?.latestVersion).toBe('1.1.5');
    expect(hacs?.updateAvailable).toBe(true);

    entries.onModuleDestroy();
    await ds.destroy();
  });
});
