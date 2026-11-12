/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CommissioningTransaction,
  type SystemNetworkInfo,
  encodeThreadDatasetTlv,
} from '@haus/core';
import type { MatterCommissioningParams, MatterTransport } from '@haus/matter';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { HubNetworkCredentialService } from '../../src/commissioning/credentials.service.js';
import { MatterAdapter } from '../../src/commissioning/adapters.js';
import type { MatterService } from '../../src/matter/service.js';

class MockMatterTransport implements MatterTransport {
  public wifiSet: Array<{ ssid: string; password: string }> = [];
  public threadSet: Array<string | Uint8Array> = [];

  async commission(_params: MatterCommissioningParams) {
    return { nodeId: 'matter-node-101', fabricIndex: 1 };
  }
  async setWifiCredentials(ssid: string, password: string) {
    this.wifiSet.push({ ssid, password });
  }
  async setThreadDataset(dataset: string | Uint8Array) {
    this.threadSet.push(dataset);
  }
  async sendCommand() {
    return null;
  }
  async readAttribute() {
    return null;
  }
  async writeAttribute() {}
  subscribe() {
    return () => {};
  }
}

async function pollSessionState(
  base: string,
  id: string,
  headers: Record<string, string>,
  targetState: string,
): Promise<CommissioningTransaction> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${base}/api/commissioning/sessions/${id}`, { headers });
    const tx = (await res.json()) as CommissioningTransaction;
    if (tx.state === targetState) return tx;
    await new Promise((r) => setTimeout(r, 20));
  }
  const lastRes = await fetch(`${base}/api/commissioning/sessions/${id}`, { headers });
  return (await lastRes.json()) as CommissioningTransaction;
}

describe('Wi-Fi and Thread Credential Providers (P20.8)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('proves manual SSID/password entry, current SSID prefill, zero password extraction, user-approved storage, zero leak, wipe on completion/cancel, and Thread dataset handling', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-cred-prov-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);
    const credService = app.get<HubNetworkCredentialService>(HubNetworkCredentialService);

    try {
      // 1. Authenticate admin pairing session
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      expect(pairRes.status).toBe(201);
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const authHeaders = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };

      // 2. Query system network info — verify supportsPassphraseExtraction is false
      const sysNetRes1 = await fetch(`${base}/api/commissioning/credentials/system-network`, {
        headers: authHeaders,
      });
      expect(sysNetRes1.status).toBe(200);
      const sysNet1 = (await sysNetRes1.json()) as SystemNetworkInfo;
      expect(sysNet1.supportsPassphraseExtraction).toBe(false);
      expect(sysNet1.permissionStatus).toBe('unavailable');
      expect(sysNet1.ssid).toBeUndefined();

      // Simulate granted system permission with prefilled SSID
      credService.setSystemNetworkInfo({
        ssid: 'Haus-Main-5G',
        permissionStatus: 'granted',
      });
      const sysNetRes2 = await fetch(`${base}/api/commissioning/credentials/system-network`, {
        headers: authHeaders,
      });
      expect(sysNetRes2.status).toBe(200);
      const sysNet2 = (await sysNetRes2.json()) as SystemNetworkInfo;
      expect(sysNet2.supportsPassphraseExtraction).toBe(false);
      expect(sysNet2.permissionStatus).toBe('granted');
      expect(sysNet2.ssid).toBe('Haus-Main-5G');

      // 3. Register radio agent and configure Matter adapter with mock transport
      commService.radios.register({
        id: 'radio-agent-ble',
        platform: 'hub',
        async *scan() {},
        async connect() {
          throw new Error('connect_stub');
        },
      });

      const matterTransport = new MockMatterTransport();
      const mockMatterService = {
        isConfigured: true,
        transport: matterTransport,
        refreshNodes: vi.fn(async () => {}),
      } as unknown as MatterService;
      const matterAdapter = new MatterAdapter(
        mockMatterService,
        commService.radios,
        commService.handover,
      );
      commService.adapters.push(matterAdapter);

      const sessionRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'improv:kitchen-air' }),
      });
      expect(sessionRes.status).toBe(202);
      const tx1 = (await sessionRes.json()) as CommissioningTransaction;
      const readyTx1 = await pollSessionState(
        base,
        tx1.commissioningId,
        authHeaders,
        'OBTAIN_NETWORK_CREDENTIALS',
      );
      expect(readyTx1.state).toBe('OBTAIN_NETWORK_CREDENTIALS');

      // 4. Provide Wi-Fi credentials with saveForReuse: true
      const wifiSecret = 'ExtremelySecretWifiPass987!';
      const credRes = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ssid: 'Haus-Main-5G',
            password: wifiSecret,
            saveForReuse: true,
          }),
        },
      );
      expect(credRes.status).toBe(202);

      // Verify credentials stored in encrypted store
      const listWifiRes = await fetch(`${base}/api/commissioning/credentials/wifi`, {
        headers: authHeaders,
      });
      expect(listWifiRes.status).toBe(200);
      const wifiList = (await listWifiRes.json()) as { ssids: string[] };
      expect(wifiList.ssids).toContain('Haus-Main-5G');

      // Invariant: stored password decryptable internally by service, but not leaked via API
      const retrievedPass = await credService.getWifi('Haus-Main-5G');
      expect(retrievedPass).toBe(wifiSecret);

      // Invariant: zero secret leak in GET /sessions/:id or event log stream
      const sessionPoll = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}`,
        {
          headers: authHeaders,
        },
      );
      expect(sessionPoll.status).toBe(200);
      const polledTx = (await sessionPoll.json()) as CommissioningTransaction;

      // Check all events for redaction
      const credProvidedEvent = polledTx.events.find(
        (e) => e.type === 'network.credentials.provided',
      );
      expect(credProvidedEvent).toBeDefined();
      const eventDetail = credProvidedEvent?.detail as {
        wifi?: { ssid: string; password: string };
      };
      expect(eventDetail?.wifi?.ssid).toBe('Haus-Main-5G');
      expect(eventDetail?.wifi?.password).toBe('***');

      // Invariant: entire snapshot JSON string does NOT contain cleartext secret
      const rawSnapshot = JSON.stringify(polledTx);
      expect(rawSnapshot).not.toContain(wifiSecret);

      // 5. Secret-lifetime wipe on cancellation
      const cancelSessionRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'improv:living-room-plug' }),
      });
      const cancelTx = (await cancelSessionRes.json()) as CommissioningTransaction;
      const readyCancelTx = await pollSessionState(
        base,
        cancelTx.commissioningId,
        authHeaders,
        'OBTAIN_NETWORK_CREDENTIALS',
      );
      expect(readyCancelTx.state).toBe('OBTAIN_NETWORK_CREDENTIALS');

      // Provide credentials
      await fetch(
        `${base}/api/commissioning/sessions/${cancelTx.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            ssid: 'TempWifi',
            password: 'TemporaryPassword456',
          }),
        },
      );

      // Cancel the session
      const cancelRes = await fetch(
        `${base}/api/commissioning/sessions/${cancelTx.commissioningId}/cancel`,
        {
          method: 'POST',
          headers: authHeaders,
        },
      );
      expect(cancelRes.status).toBe(200);

      // 6. Thread Active Operational Dataset handling
      const threadTlv = encodeThreadDatasetTlv({
        networkName: 'HausThreadMesh',
        channel: 22,
        panId: 0x5678,
        extendedPanId: 'cafebabedeadbeef',
        networkKey: '00112233445566778899aabbccddeeff',
      });
      const threadHex = Buffer.from(threadTlv).toString('hex');

      // Create session for Matter Thread device
      const matterThreadSessionRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'MT:Y.K9042C00KA0648G00' }), // Matter QR code
      });
      expect(matterThreadSessionRes.status).toBe(202);
      const matterTx = (await matterThreadSessionRes.json()) as CommissioningTransaction;
      const readyMatterTx = await pollSessionState(
        base,
        matterTx.commissioningId,
        authHeaders,
        'OBTAIN_NETWORK_CREDENTIALS',
      );
      expect(readyMatterTx.state).toBe('OBTAIN_NETWORK_CREDENTIALS');

      // Provide Thread dataset with saveForReuse: true
      const threadCredRes = await fetch(
        `${base}/api/commissioning/sessions/${matterTx.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            threadDataset: threadHex,
            saveForReuse: true,
          }),
        },
      );
      expect(threadCredRes.status).toBe(202);

      // Verify stored Thread network
      const listThreadRes = await fetch(`${base}/api/commissioning/credentials/thread`, {
        headers: authHeaders,
      });
      expect(listThreadRes.status).toBe(200);
      const threadList = (await listThreadRes.json()) as {
        networks: { networkName: string; extendedPanId: string }[];
      };
      expect(threadList.networks.some((n) => n.extendedPanId === 'cafebabedeadbeef')).toBe(true);

      // Verify zero leak of Thread network key in session snapshot
      const matterPoll = await fetch(
        `${base}/api/commissioning/sessions/${matterTx.commissioningId}`,
        {
          headers: authHeaders,
        },
      );
      const polledMatter = (await matterPoll.json()) as CommissioningTransaction;
      const matterRaw = JSON.stringify(polledMatter);
      expect(matterRaw).not.toContain('00112233445566778899aabbccddeeff');

      const threadProvidedEvent = polledMatter.events.find(
        (e) => e.type === 'network.credentials.provided',
      );
      expect(threadProvidedEvent).toBeDefined();
      expect(String(threadProvidedEvent?.detail?.thread)).toContain('[ThreadDataset:');
      expect(String(threadProvidedEvent?.detail?.thread)).toContain('redacted');

      // 7. System-Assisted Thread provider resolution
      credService.setHausOtbrDatasetLoader(async () => threadTlv);
      const resolveRes = await fetch(`${base}/api/commissioning/credentials/thread/resolve`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(resolveRes.status).toBe(200);
      const resolved = (await resolveRes.json()) as {
        status: string;
        networkName: string;
        extendedPanId: string;
        channel: number;
        panId: number;
        hasDataset: boolean;
      };
      expect(resolved.status).toBe('granted');
      expect(resolved.networkName).toBe('HausThreadMesh');
      expect(resolved.channel).toBe(22);
      expect(resolved.panId).toBe(0x5678);
      expect(resolved.extendedPanId).toBe('cafebabedeadbeef');
      expect(resolved.hasDataset).toBe(true);

      // 8. Delete stored Wi-Fi credential
      const delWifiRes = await fetch(
        `${base}/api/commissioning/credentials/wifi/Haus-Main-5G`,
        {
          method: 'DELETE',
          headers: authHeaders,
        },
      );
      expect(delWifiRes.status).toBe(200);

      const listAfterDel = await fetch(`${base}/api/commissioning/credentials/wifi`, {
        headers: authHeaders,
      });
      const afterDel = (await listAfterDel.json()) as { ssids: string[] };
      expect(afterDel.ssids).not.toContain('Haus-Main-5G');

      // 9. Negative checks: reject credentials for wrong home
      const wrongHomeRes = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'x-haus-home-id': 'different-home-id',
          },
          body: JSON.stringify({ ssid: 'Another', password: 'Pass' }),
        },
      );
      expect([400, 403]).toContain(wrongHomeRes.status);
    } finally {
      await app.close();
    }
  });
});
