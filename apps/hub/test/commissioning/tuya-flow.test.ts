/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openCatalog, Transactions } from '../../src/storage/index.js';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import { StandaloneHomeService } from '../../src/home/home.service.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import {
  computeTuyaHashKey,
  generateTuyaAesSecret,
  signTuyaRequest,
  tuyaAesGcmDecrypt,
  tuyaAesGcmEncrypt,
} from '../../src/commissioning/tuya/crypto.js';
import { HubTuyaService } from '../../src/commissioning/tuya/service.js';
import { TUYA_CLIENT_ID } from '../../src/commissioning/tuya/types.js';

const mockHomekit = {
  discoverAccessories: async () => [],
} as unknown as HomeKitControllerService;

describe('Tuya live QR auth, encrypted token store, and cloud device sync', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('matches tuya-device-sharing-sdk AES-128-GCM encryption and HMAC signing format', () => {
    const rid = '11111111-2222-3333-4444-555555555555';
    const refreshToken = 'refresh_tok_123';
    const hashKey = computeTuyaHashKey(rid, refreshToken);
    expect(hashKey).toHaveLength(32);

    const secret = generateTuyaAesSecret(rid, '', hashKey);
    expect(secret).toHaveLength(16);

    const encrypted = tuyaAesGcmEncrypt(
      JSON.stringify({ homeId: '998877' }),
      secret,
      'AbCdEfGhJkMn',
    );
    const decoded = tuyaAesGcmDecrypt(encrypted, secret);
    expect(JSON.parse(decoded)).toEqual({ homeId: '998877' });

    const sign = signTuyaRequest(hashKey, encrypted, '', {
      'X-appKey': TUYA_CLIENT_ID,
      'X-requestId': rid,
      'X-sid': '',
      'X-time': '1700000000000',
      'X-token': 'access_tok_abc',
    });
    expect(sign).toMatch(/^[a-f0-9]{64}$/);
  });

  it('executes QR login flow, handles API errors & QR refresh, persists encrypted creds, and syncs cameras + devices', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'haus-tuya-test-'));
    const dbPath = join(tempDir, 'haus.sqlite');
    let qrCounter = 0;
    let confirmed = false;
    let expiredCalls = 0;
    const sentCommands: Array<{ deviceId: string; payload: unknown }> = [];
    let currentAccessToken = 'ACC_TOKEN_1';
    let currentRefreshToken = 'REF_TOKEN_1';
    let tokenExpireSec = 7200;

    const fakeFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (
        init?.method === 'POST' &&
        url.pathname === '/v1.0/m/life/home-assistant/qrcode/tokens'
      ) {
        const userCode = url.searchParams.get('usercode');
        expect(url.searchParams.get('clientid')).toBe(TUYA_CLIENT_ID);
        expect(url.searchParams.get('schema')).toBe('haauthorize');
        if (userCode !== 'GoodCode1') {
          return new Response(
            JSON.stringify({
              success: false,
              code: 'USERCODE_INCORRECT',
              msg: 'User Code Incorrect',
            }),
            { status: 200 },
          );
        }
        qrCounter += 1;
        return new Response(
          JSON.stringify({
            success: true,
            result: { qrcode: `QR_LIVE_${qrCounter}` },
            t: Date.now(),
          }),
          { status: 200 },
        );
      }

      if (
        init?.method === 'GET' &&
        url.pathname.startsWith('/v1.0/m/life/home-assistant/qrcode/tokens/')
      ) {
        if (!confirmed) {
          return new Response(
            JSON.stringify({
              success: false,
              code: '1010',
              msg: 'QR code has not been confirmed yet',
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            t: Date.now() - 10_000,
            result: {
              uid: 'tuya_uid_991',
              username: 'alice@smartlife',
              expire_time: tokenExpireSec,
              access_token: currentAccessToken,
              refresh_token: currentRefreshToken,
              terminal_id: 'TERM_XYZ',
              endpoint: 'https://apigw.iotbing.com',
            },
          }),
          { status: 200 },
        );
      }

      // Signed API calls
      const rid = headers['X-requestId'];
      expect(rid).toBeTruthy();
      const hashKey = computeTuyaHashKey(rid, currentRefreshToken);
      const secret = generateTuyaAesSecret(rid, headers['X-sid'] ?? '', hashKey);

      if (url.pathname.startsWith('/v1.0/m/token/') && init?.method === 'GET') {
        currentAccessToken = 'ACC_TOKEN_2';
        currentRefreshToken = 'REF_TOKEN_2';
        const encResult = tuyaAesGcmEncrypt(
          JSON.stringify({
            uid: 'tuya_uid_991',
            accessToken: currentAccessToken,
            refreshToken: currentRefreshToken,
            expireTime: 7200,
          }),
          secret,
        );
        return new Response(
          JSON.stringify({ success: true, t: Date.now(), result: encResult }),
          { status: 200 },
        );
      }

      if (url.pathname === '/v1.0/m/life/users/homes') {
        const encResult = tuyaAesGcmEncrypt(
          JSON.stringify([{ ownerId: 'home_tuya_1', name: 'Main Apartment' }]),
          secret,
        );
        return new Response(
          JSON.stringify({ success: true, t: Date.now(), result: encResult }),
          { status: 200 },
        );
      }

      if (url.pathname === '/v1.0/m/life/ha/home/devices') {
        const encQuery = url.searchParams.get('encdata');
        expect(encQuery).toBeTruthy();
        const plainQuery = JSON.parse(tuyaAesGcmDecrypt(encQuery!, secret));
        expect(plainQuery).toEqual({ homeId: 'home_tuya_1' });

        const encResult = tuyaAesGcmEncrypt(
          JSON.stringify([
            {
              id: 'cam_dev_1',
              name: 'Front Door Camera',
              category: 'sp',
              product_id: 'pid_cam',
              product_name: 'Smart Wi-Fi Camera',
              online: true,
              local_key: 'MUST_NOT_LEAK_LOCAL_KEY',
              status: [{ code: 'motion_switch', value: true }],
            },
            {
              id: 'light_dev_1',
              name: 'Hallway Lamp',
              category: 'dj',
              product_id: 'pid_light',
              product_name: 'RGBW Bulb',
              online: true,
              local_key: 'MUST_NOT_LEAK_BULB_KEY',
              status: [
                { code: 'switch_led', value: false },
                { code: 'bright_value_v2', value: 650 },
              ],
            },
          ]),
          secret,
        );
        return new Response(
          JSON.stringify({ success: true, t: Date.now(), result: encResult }),
          { status: 200 },
        );
      }

      if (url.pathname === '/v1.1/m/thing/light_dev_1/commands' && init?.method === 'POST') {
        const bodyRaw = JSON.parse(String(init.body)) as { encdata: string };
        const plainBody = JSON.parse(tuyaAesGcmDecrypt(bodyRaw.encdata, secret));
        sentCommands.push({ deviceId: 'light_dev_1', payload: plainBody });
        const encResult = tuyaAesGcmEncrypt(JSON.stringify(true), secret);
        return new Response(
          JSON.stringify({ success: true, t: Date.now(), result: encResult }),
          { status: 200 },
        );
      }

      if (url.pathname === '/v1.0/m/token/terminal/expire' && init?.method === 'POST') {
        expiredCalls += 1;
        const encResult = tuyaAesGcmEncrypt(JSON.stringify(true), secret);
        return new Response(
          JSON.stringify({ success: true, t: Date.now(), result: encResult }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected mock Tuya URL: ${init?.method} ${url.toString()}`);
    };

    // Boot 1
    const ds1 = await openCatalog(dbPath);
    const tx1 = new Transactions(ds1);
    const home1 = new StandaloneHomeService(undefined, tx1);
    await home1.onModuleInit();
    const tuya1 = new HubTuyaService(home1, tx1);
    tuya1.configureForTesting({ clientOptions: { fetchFn: fakeFetch }, cipherSecret: 'test-key-1' });
    const entries1 = new HubIntegrationEntryService(home1, tx1, undefined, tuya1);
    await entries1.onModuleInit();
    const comm1 = new CommissioningService(mockHomekit, undefined, undefined, entries1);

    // Step 1 with wrong code shows API login_error + placeholders
    const flow = await comm1.startFlow({ domain: 'tuya', homeId: 'h1', userId: 'u1' });
    expect(flow.stepId).toBe('user');
    const badStep = await comm1.submitFlowStep({
      flowId: flow.flowId,
      homeId: 'h1',
      userId: 'u1',
      values: { user_code: 'BadCode' },
    });
    expect(badStep.stepId).toBe('user');
    expect(badStep.errors?.base).toBe('login_error');
    expect(badStep.descriptionPlaceholders).toEqual({
      code: 'USERCODE_INCORRECT',
      msg: 'User Code Incorrect',
    });

    // Step 1 with valid code returns real QR token from API
    const scan1 = await comm1.submitFlowStep({
      flowId: flow.flowId,
      homeId: 'h1',
      userId: 'u1',
      values: { user_code: 'GoodCode1' },
    });
    expect(scan1.stepId).toBe('scan');
    expect(scan1.dataSchema?.[0]?.defaultValue).toBe('tuyaSmart--qrLogin?token=QR_LIVE_1');

    // Step 2 before confirmation refreshes QR token and shows error
    const retryScan = await comm1.submitFlowStep({
      flowId: flow.flowId,
      homeId: 'h1',
      userId: 'u1',
      values: {},
    });
    expect(retryScan.stepId).toBe('scan');
    expect(retryScan.errors?.base).toBe('login_error');
    expect(retryScan.descriptionPlaceholders?.code).toBe('1010');
    expect(retryScan.dataSchema?.[0]?.defaultValue).toBe('tuyaSmart--qrLogin?token=QR_LIVE_2');

    // Step 2 after user confirms in Smart Life app
    confirmed = true;
    const created = await comm1.submitFlowStep({
      flowId: flow.flowId,
      homeId: 'h1',
      userId: 'u1',
      values: {},
    });
    expect(created.type).toBe('create_entry');
    expect(created.title).toBe('alice@smartlife');
    const createdDataJson = JSON.stringify(created.result?.data ?? {});
    expect(createdDataJson).not.toContain('ACC_TOKEN_1');
    expect(createdDataJson).not.toContain('REF_TOKEN_1');

    const entryId = created.result!.entryId!;
    const entry = await entries1.getEntry(entryId);
    expect(entry?.domain).toBe('tuya');
    expect(entry?.data.user_code).toBe('GoodCode1');
    expect(entry?.data.access_token).toBeUndefined();
    expect(entry?.data.refresh_token).toBeUndefined();

    // Encrypted credentials stored privately in SQLite
    const privRows = await home1.getPersistence().listByKind<{ encrypted: string }>('tuya_credentials');
    expect(privRows).toHaveLength(1);
    expect(privRows[0].value.encrypted).not.toContain('ACC_TOKEN_1');

    // Devices synced including camera and light, without leaking local_key
    const devices = home1.listDevices();
    const cam = devices.find((d) => d.id === 'tuya:cam_dev_1');
    const light = devices.find((d) => d.id === 'tuya:light_dev_1');
    expect(cam?.category).toBe('cameras');
    expect(cam?.source.instanceId).toBe(entryId);
    expect(cam?.endpoints[0]?.capabilities[0]?.id).toBe('video');
    expect(JSON.stringify(devices)).not.toContain('MUST_NOT_LEAK');
    expect(light?.category).toBe('lighting');
    expect(home1.getEndpointState('ep_tuya_light_dev_1_switch_led')?.brightness).toBe(65);

    const meta = await entries1.listIntegrationMetadata();
    const tuyaMeta = meta.find((m) => m.domain === 'tuya');
    expect(tuyaMeta?.deviceCount).toBe(2);
    expect(tuyaMeta?.entryCount).toBe(1);

    // Command execution invokes Tuya Cloud command endpoint
    await home1.executeDeviceCommand('ep_tuya_light_dev_1_switch_led', 'on_off', 'turn_on');
    expect(sentCommands).toEqual([
      { deviceId: 'light_dev_1', payload: { commands: [{ code: 'switch_led', value: true }] } },
    ]);

    await tuya1.flushSyncs();
    entries1.onModuleDestroy();
    await home1.getPersistence().flush();
    await home1.onModuleDestroy();
    await tx1.drain();
    await ds1.destroy();

    // Boot 2: verify restore + token refresh when expired + delete cleanup
    tokenExpireSec = 1; // Expired relative to t
    const ds2 = await openCatalog(dbPath);
    const tx2 = new Transactions(ds2);
    const home2 = new StandaloneHomeService(undefined, tx2);
    await home2.onModuleInit();
    const tuya2 = new HubTuyaService(home2, tx2);
    tuya2.configureForTesting({ clientOptions: { fetchFn: fakeFetch }, cipherSecret: 'test-key-1' });
    const entries2 = new HubIntegrationEntryService(home2, tx2, undefined, tuya2);
    await entries2.onModuleInit();
    await tuya2.flushSyncs();

    await tuya2.setEntryDisabled(entryId, true);
    expect(home2.listDevices().find((d) => d.id === 'tuya:light_dev_1')?.availability).toBe('offline');
    await expect(
      home2.executeDeviceCommand('ep_tuya_light_dev_1_switch_led', 'on_off', 'turn_off'),
    ).rejects.toThrow();

    await tuya2.setEntryDisabled(entryId, false);
    expect(home2.listDevices().find((d) => d.id === 'tuya:light_dev_1')?.availability).toBe('online');

    await entries2.deleteEntry(entryId);
    expect(expiredCalls).toBeGreaterThanOrEqual(1);
    expect(home2.listDevices().filter((d) => d.source.instanceId === entryId)).toHaveLength(0);
    expect(await home2.getPersistence().listByKind('tuya_credentials')).toHaveLength(0);

    await tuya2.flushSyncs();
    entries2.onModuleDestroy();
    await home2.getPersistence().flush();
    await home2.onModuleDestroy();
    await tx2.drain();
    await ds2.destroy();
  });
});
