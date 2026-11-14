/* SPDX-License-Identifier: GPL-3.0-only. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { HaFlowRuntime, HaFlowWorkerError } from '../dist/index.js';

const hasVenvPython =
  existsSync(join(process.cwd(), '..', '..', '.venv', 'bin', 'python')) ||
  existsSync(join(process.cwd(), '.venv', 'bin', 'python'));

test(
  'HaFlowRuntime runs real HA config, menu, helper, virtual supported_by, and file upload flows',
  {
    timeout: 90_000,
    skip: !hasVenvPython,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-test-'));
    const runtime = new HaFlowRuntime({
      configDir: join(root, 'config'),
      depsDir: join(root, 'deps'),
      autoInstallReqs: true,
      setupOnCreate: false,
    });

    try {
      const health = await runtime.health();
      assert.equal(health.ok, true);
      assert.ok(health.haVersion.length > 0);

      // Menu step -> form step -> create_entry on HA core helper `random`
      const randInit = await runtime.initFlow({ domain: 'random' });
      assert.equal(randInit.flowResult?.type, 'menu');
      assert.ok(randInit.localized?.menuOptions.sensor);

      const randForm = await runtime.configureFlow({
        flowId: String(randInit.flowResult?.flow_id),
        userInput: { next_step_id: 'sensor' },
      });
      assert.equal(randForm.flowResult?.type, 'form');
      assert.ok((randForm.flowResult?.data_schema?.length ?? 0) > 0);

      const randDone = await runtime.configureFlow({
        flowId: String(randForm.flowResult?.flow_id),
        userInput: { name: 'Test Random', minimum: 0, maximum: 10 },
      });
      assert.equal(randDone.flowResult?.type, 'create_entry');
      assert.equal(randDone.entry?.domain, 'random');
      assert.equal(randDone.entry?.title, 'Test Random');

      // Options flow on the created config entry (derivative / random / template / generic)
      const handlers = await runtime.listFlowHandlers();
      assert.ok(handlers.handlers.includes('ipp'));
      assert.ok(handlers.handlers.includes('template'));
      assert.ok(handlers.handlers.length >= 600);

      // Virtual supported_by brand (`3_day_blinds` -> `motion_blinds`)
      const virt = await runtime.initFlow({ domain: '3_day_blinds' });
      assert.equal(virt.flowResult?.type, 'form');
      assert.equal(virt.flowResult?.handler, 'motion_blinds');
      assert.equal(virt.localized?.supportedBy, '3_day_blinds');
      assert.equal(virt.localized?.integrationTitle, '3 Day Blinds');
      await runtime.abortFlow(String(virt.flowResult?.flow_id));

      // On-demand PyPI dependency installation via uv (`ipp` -> `pyipp`)
      const ipp = await runtime.initFlow({ domain: 'ipp' });
      assert.equal(ipp.flowResult?.type, 'form');
      const ippFields = (ipp.flowResult?.data_schema ?? []).map((f) => f.name);
      assert.deepEqual(ippFields, ['host', 'port', 'base_path', 'ssl', 'verify_ssl']);
      await runtime.abortFlow(String(ipp.flowResult?.flow_id));

      // File upload + translations RPC + application credentials
      const uploaded = await runtime.uploadFile(
        'cert.pem',
        Buffer.from('test-pem').toString('base64'),
      );
      assert.ok(uploaded.fileId.length > 0);
      assert.equal(uploaded.filename, 'cert.pem');

      await runtime.addApplicationCredential({
        domain: 'spotify',
        clientId: 'cid-123',
        clientSecret: 'csec-456',
        name: 'My Spotify',
      });
      const creds = await runtime.listApplicationCredentials();
      assert.equal(creds.items.length, 1);

      const spotifyFlow = await runtime.initFlow({ domain: 'spotify' });
      assert.equal(spotifyFlow.flowResult?.type, 'external');
      assert.ok(spotifyFlow.flowResult?.url?.includes('accounts.spotify.com'));
      await runtime.abortFlow(String(spotifyFlow.flowResult?.flow_id));

      const tr = await runtime.getTranslations({
        categories: ['config', 'title'],
        integrations: ['template'],
      });
      assert.equal(tr.translations['component.template.title'], 'Template');

      // Sync state and run options flow / duplicate checks cleanly
      const synced = await runtime.syncState({
        entries: [
          {
            entryId: 'ent-generic-1',
            domain: 'generic',
            title: 'Porch Camera',
            data: {},
            options: { stream_source: 'rtsp://127.0.0.1/live' },
          },
        ],
      });
      assert.equal(synced.entriesCount, 1);

      const optFlow = await runtime.initFlow({
        domain: 'generic',
        flowKind: 'options',
        entryId: 'ent-generic-1',
      });
      assert.equal(optFlow.flowResult?.type, 'form');
      assert.ok((optFlow.flowResult?.data_schema?.length ?? 0) > 0);
      await runtime.abortFlow(String(optFlow.flowResult?.flow_id), 'options');

      // Discovery ServiceInfo construction (`mqtt` -> `tasmota`)
      const disc = await runtime.triggerDiscovery({
        domain: 'tasmota',
        protocol: 'mqtt',
        discoveryKey: 'mqtt:tasmota:test-1',
        info: {
          topic: 'tasmota/discovery/AABBCCDDEEFF/config',
          subscribedTopic: 'tasmota/discovery/#',
          payload: JSON.stringify({
            ip: '192.168.1.99',
            dn: 'Living Plug',
            fn: ['Plug'],
            hn: 'tasmota-plug',
            mac: 'AABBCCDDEEFF',
            md: 'Sonoff S31',
            t: 'tasmota_plug',
            ft: '%prefix%/%topic%/',
            rl: [1],
            swc: [-1],
            sw: ['13.1.0'],
            tp: ['cmnd', 'stat', 'tele'],
          }),
        },
      });
      assert.equal(disc.outcome, 'form');
      assert.ok(disc.localized?.description?.includes('Tasmota'));
      assert.equal(disc.localized?.integrationTitle, 'Tasmota');
      const progress = await runtime.listProgressFlows();
      assert.ok(progress.flows.some((f) => f.handler === 'tasmota'));
      await runtime.abortFlow(String(disc.flowResult?.flow_id));
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'HaFlowRuntime reports missing requirements honestly when autoInstallReqs is disabled',
  {
    timeout: 45_000,
    skip: !hasVenvPython,
  },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'haus-haflow-noreq-'));
    const runtime = new HaFlowRuntime({
      configDir: join(root, 'config'),
      depsDir: join(root, 'deps'),
      autoInstallReqs: false,
    });

    try {
      await assert.rejects(
        () => runtime.initFlow({ domain: 'brother' }),
        (err: unknown) => {
          assert.ok(err instanceof HaFlowWorkerError);
          assert.equal(err.code, 'missing_requirements');
          assert.ok((err.missingRequirements?.length ?? 0) > 0);
          return true;
        },
      );
    } finally {
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
