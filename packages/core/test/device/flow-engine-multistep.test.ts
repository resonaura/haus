/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { IntegrationFlowEngine } from '../../src/commissioning/flow-engine.js';

describe('IntegrationFlowEngine multi-step, menu, options, and reconfigure flows', () => {
  it('walks xiaomi_miot menu -> cloud account -> filter options -> create_entry', async () => {
    const engine = new IntegrationFlowEngine();

    const step1 = await engine.startFlow({
      domain: 'xiaomi_miot',
      homeId: 'home-1',
      userId: 'user-1',
    });
    expect(step1.type).toBe('menu');
    expect(step1.title).toBe('Select Action');
    expect(step1.menuOptions).toEqual({
      cloud: 'Add devices using Mi Account (账号集成)',
      local: 'Add device using host/token (局域网集成)',
    });

    const step2 = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      nextStepId: 'cloud',
      values: { next_step_id: 'cloud' },
    });
    expect(step2.type).toBe('form');
    expect(step2.stepId).toBe('cloud');
    expect(step2.lastStep).toBe(false);

    const step3 = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      stepId: 'cloud',
      values: {
        username: '8210526797',
        password: 'secret-password',
        server_country: 'cn',
        conn_mode: 'auto',
      },
    });
    expect(step3.type).toBe('form');
    expect(step3.stepId).toBe('cloud_filter');
    expect(step3.lastStep).toBe(true);

    const done = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      stepId: 'cloud_filter',
      values: { filter_mode: 'exclude', poll_interval: 30 },
    });
    expect(done.type).toBe('create_entry');
    expect(done.result?.title).toBe('Xiaomi: 8210526797');
    expect(done.result?.data).toMatchObject({
      username: '8210526797',
      server_country: 'cn',
      poll_interval: 30,
    });
  });

  it('validates 32-hex Xiaomi local token before completing local step', async () => {
    const engine = new IntegrationFlowEngine();
    const menu = await engine.startFlow({
      domain: 'xiaomi_miot',
      homeId: 'home-1',
      userId: 'user-1',
    });

    const localForm = await engine.submitStep({
      flowId: menu.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      values: { next_step_id: 'local' },
    });
    expect(localForm.stepId).toBe('local');

    const bad = await engine.submitStep({
      flowId: menu.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      values: { host: '192.168.1.50', token: 'too-short' },
    });
    expect(bad.type).toBe('form');
    expect(bad.errors).toEqual({ token: 'invalid_token' });

    const ok = await engine.submitStep({
      flowId: menu.flowId,
      homeId: 'home-1',
      userId: 'user-1',
      values: {
        host: '192.168.1.50',
        token: '0123456789abcdef0123456789abcdef',
        name: 'Kitchen Kettle',
      },
    });
    expect(ok.type).toBe('create_entry');
    expect(ok.result?.title).toBe('Kitchen Kettle');
  });

  it('walks HA-style tuya user_code -> scan QR flow with validation and distinct multi-account entries', async () => {
    const engine = new IntegrationFlowEngine();

    const s1 = await engine.startFlow({ domain: 'tuya', homeId: 'h', userId: 'u' });
    expect(s1.type).toBe('form');
    expect(s1.stepId).toBe('user');
    expect(s1.lastStep).toBe(false);
    expect(s1.dataSchema?.map((f) => f.name)).toEqual(['user_code']);

    const blankErr = await engine.submitStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: { user_code: '   ' },
    });
    expect(blankErr.type).toBe('form');
    expect(blankErr.errors).toEqual({ user_code: 'required' });

    const shortErr = await engine.submitStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: { user_code: 'ab' },
    });
    expect(shortErr.type).toBe('form');
    expect(shortErr.errors).toEqual({ user_code: 'invalid_user_code' });

    const scanStep = await engine.submitStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: { user_code: 'AbCd1234' },
    });
    expect(scanStep.type).toBe('form');
    expect(scanStep.stepId).toBe('scan');
    expect(scanStep.lastStep).toBe(true);
    const qrField = scanStep.dataSchema?.find((f) => f.name === 'QR');
    expect(qrField?.type).toBe('qr_code');
    expect(String((qrField?.selector?.qr_code as { data?: string })?.data)).toMatch(
      /^tuyaSmart--qrLogin\?token=/,
    );

    const entry1 = await engine.submitStep({
      flowId: s1.flowId,
      homeId: 'h',
      userId: 'u',
      values: {},
    });
    expect(entry1.type).toBe('create_entry');
    expect(entry1.result?.title).toBe('Tuya (AbCd1234)');

    const s2 = await engine.startFlow({ domain: 'tuya', homeId: 'h', userId: 'u' });
    await engine.submitStep({
      flowId: s2.flowId,
      homeId: 'h',
      userId: 'u',
      values: { user_code: 'Xyz98765' },
    });
    const entry2 = await engine.submitStep({
      flowId: s2.flowId,
      homeId: 'h',
      userId: 'u',
      values: {},
    });
    expect(entry2.result?.entryId).toBeTruthy();
    expect(entry2.result?.entryId).not.toBe(entry1.result?.entryId);
  });

  it('supports options and reconfigure flows preserving entryId and redacting prefilled secrets', async () => {
    const engine = new IntegrationFlowEngine();

    const optStep = await engine.startFlow({
      domain: 'yeelight',
      source: 'options',
      entryId: 'yeelight_entry_1',
      homeId: 'h',
      userId: 'u',
      initialData: { transition: 500, use_music_mode: true },
    });
    expect(optStep.type).toBe('form');
    expect(optStep.stepId).toBe('init');
    expect(optStep.dataSchema?.find((f) => f.name === 'transition')?.defaultValue).toBe(500);

    const optDone = await engine.submitStep({
      flowId: optStep.flowId,
      homeId: 'h',
      userId: 'u',
      values: { transition: 250, use_music_mode: false },
    });
    expect(optDone.type).toBe('create_entry');
    expect(optDone.result?.entryId).toBe('yeelight_entry_1');
    expect(optDone.result?.options).toMatchObject({ transition: 250, use_music_mode: false });

    const reconf = await engine.startFlow({
      domain: 'xiaomi_miot',
      source: 'reconfigure',
      entryId: 'xiaomi_entry_9',
      homeId: 'h',
      userId: 'u',
      initialData: { username: '8210526797', password: 'should-not-prefill' },
    });
    expect(reconf.type).toBe('menu');
    const cloudForm = await engine.submitStep({
      flowId: reconf.flowId,
      homeId: 'h',
      userId: 'u',
      values: { next_step_id: 'cloud' },
    });
    expect(cloudForm.dataSchema?.find((f) => f.name === 'username')?.defaultValue).toBe(
      '8210526797',
    );
    expect(cloudForm.dataSchema?.find((f) => f.name === 'password')?.defaultValue).toBeUndefined();
  });
});
