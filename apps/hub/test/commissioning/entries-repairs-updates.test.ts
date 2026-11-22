/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalFlowRuntime, FlowInitOptions, IntegrationFlowStep } from '@haus/core';
import { HaFlowWorkerError } from '@haus/kitsune';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import {
  readInstalledCustomManifests,
  resolveHaTranslations,
} from '../../src/commissioning/ha-flow/runtime-operations.js';
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
    expect(hacs?.canInstall).toBe(true);

    const hacsList = (await updates.handleHacsCommand({
      type: 'hacs/repositories/list',
    })) as Array<{ id: string; domain?: string; pending_upgrade: boolean }>;
    const xiaomiRepo = hacsList.find((r) => r.domain === 'xiaomi_miot');
    expect(xiaomiRepo?.pending_upgrade).toBe(true);

    entries.onModuleDestroy();
    await ds.destroy();
  });

  it('falls back from UnknownStep on repair to reauth and resolves on reauth_successful (e.g. Apple TV)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-repairs-appletv-'));
    const ds = await openCatalog(join(tempDir, 'haus.sqlite'));
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();
    const comm = new CommissioningService(mockHomekit, undefined, undefined, entries);
    const repairs = new HubRepairsService(comm, entries, undefined, tx, undefined);
    await repairs.onModuleInit();

    const attemptedSources: string[] = [];
    const fakeExternal: ExternalFlowRuntime = {
      supportsDomain: (domain) => domain === 'apple_tv',
      startFlow: async (options: FlowInitOptions): Promise<IntegrationFlowStep> => {
        attemptedSources.push(options.source ?? 'user');
        if (options.source === 'repair') {
          throw new HaFlowWorkerError(
            "Handler AppleTVConfigFlow doesn't support step repair",
            { code: 'UnknownStep' },
          );
        }
        return {
          type: 'form',
          flowId: 'ha_reauth_apple_tv_1',
          handler: 'apple_tv',
          stepId: 'restore_device',
          title: 'Device reconfiguration',
          description: 'Reconfigure this device to restore its functionality.',
          dataSchema: [],
        };
      },
      submitStep: async () => ({
        type: 'abort',
        flowId: 'ha_reauth_apple_tv_1',
        handler: 'apple_tv',
        stepId: 'abort',
        title: 'Apple TV',
        abortReason: 'reauth_successful',
      }),
    };
    comm.flows.setExternalRuntime(fakeExternal);

    await entries.recordFlowResult(
      {
        type: 'create_entry',
        flowId: 'seed_apple_tv',
        handler: 'apple_tv',
        stepId: 'done',
        title: 'Apple TV',
        result: {
          entryId: 'entry_apple_tv_1',
          title: 'Bedroom Apple TV',
          data: { name: 'Bedroom Apple TV', address: '192.168.4.224' },
        },
      },
      'user',
    );
    await entries.setEntryState('entry_apple_tv_1', 'setup_retry', 'ha_runtime_unavailable');

    const issues = await repairs.listIssues();
    const issue = issues.find((i) => i.entryId === 'entry_apple_tv_1')!;
    expect(issue).toBeDefined();

    const step = await repairs.startFixFlow({
      handler: 'apple_tv',
      issueId: issue.issue_id,
      homeId: 'h',
      userId: 'u',
    });
    expect(attemptedSources).toEqual(['repair', 'reauth']);
    expect(step.type).toBe('form');
    expect(step.stepId).toBe('restore_device');

    const done = await repairs.submitFixStep({
      flowId: step.flowId,
      homeId: 'h',
      userId: 'u',
      values: {},
    });
    expect(done.type).toBe('abort');
    expect(done.abortReason).toBe('reauth_successful');
    expect((await entries.getEntry('entry_apple_tv_1'))?.state).toBe('loaded');
    expect((await repairs.listIssues()).some((i) => i.entryId === 'entry_apple_tv_1')).toBe(false);

    repairs.onModuleDestroy();
    entries.onModuleDestroy();
    await ds.destroy();
  });

  it('falls back to reload confirm form with canonical manifest name when repair, reauth, and reconfigure are unsupported', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-repairs-fallback-'));
    const ds = await openCatalog(join(tempDir, 'haus.sqlite'));
    const tx = new Transactions(ds);
    const entries = new HubIntegrationEntryService(undefined, tx, undefined);
    await entries.onModuleInit();
    const onEntryReloaded = vi.fn(async () => undefined);
    entries.setHaFlowHooks({ onEntryReloaded });
    const comm = new CommissioningService(mockHomekit, undefined, undefined, entries);
    const repairs = new HubRepairsService(comm, entries, undefined, tx, undefined);
    await repairs.onModuleInit();

    const fakeExternal: ExternalFlowRuntime = {
      supportsDomain: (domain) => domain === 'apple_tv',
      startFlow: async (options: FlowInitOptions) => {
        throw new HaFlowWorkerError(
          `Handler AppleTVConfigFlow doesn't support step ${options.source ?? 'user'}`,
          { code: 'UnknownStep' },
        );
      },
      submitStep: async () => {
        throw new Error('unexpected');
      },
    };
    comm.flows.setExternalRuntime(fakeExternal);

    await entries.recordFlowResult(
      {
        type: 'create_entry',
        flowId: 'seed_apple_tv_2',
        handler: 'apple_tv',
        stepId: 'done',
        title: 'Apple TV',
        result: { entryId: 'entry_apple_tv_2', title: 'Living Room Apple TV', data: {} },
      },
      'user',
    );
    await entries.setEntryState('entry_apple_tv_2', 'setup_error', 'connection_failed');

    const step = await repairs.startFixFlow({
      handler: 'apple_tv',
      issueId: 'entry_entry_apple_tv_2',
      homeId: 'h',
      userId: 'u',
    });
    expect(step.type).toBe('form');
    expect(step.stepId).toBe('confirm');
    expect(await repairs.getFixFlow(step.flowId, { homeId: 'h' })).toEqual(step);

    const finished = await repairs.submitFixStep({
      flowId: step.flowId,
      homeId: 'h',
      userId: 'u',
      values: { reload_entry: true },
    });
    expect(finished.type).toBe('create_entry');
    const canonicalName = comm.catalog.getCatalog().getManifest('apple_tv')?.name;
    if (canonicalName) {
      expect(finished.title).toBe(`Repaired ${canonicalName}`);
      expect(finished.title).not.toContain('Apple Tv');
    }
    expect(onEntryReloaded).toHaveBeenCalledTimes(1);

    const titles = await resolveHaTranslations({
      category: 'title',
      integrations: ['apple_tv'],
      catalog: {
        getTranslations: () => ({ getFlattenedCategory: () => ({}) }),
        getCatalog: () => ({
          getManifest: (domain) => (domain === 'apple_tv' ? { domain, name: 'Apple TV' } : undefined),
          getAllManifests: () => [{ domain: 'apple_tv', name: 'Apple TV' }],
        }),
      },
      ensureStarted: async () => undefined,
    });
    expect(titles['component.apple_tv.title']).toBe('Apple TV');

    const customDir = join(tempDir, 'custom_components', 'xiaomi_miot');
    await mkdir(customDir, { recursive: true });
    await writeFile(
      join(customDir, 'manifest.json'),
      JSON.stringify({ domain: 'xiaomi_miot', name: 'Xiaomi Miot', config_flow: true }),
    );
    const customManifests = readInstalledCustomManifests(join(tempDir, 'custom_components'));
    expect(customManifests).toEqual([
      { domain: 'xiaomi_miot', name: 'Xiaomi Miot', config_flow: true },
    ]);

    repairs.onModuleDestroy();
    entries.onModuleDestroy();
    await ds.destroy();
  });
});
