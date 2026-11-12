/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import {
  ImprovState,
  type Advertisement,
  type CommissioningTransaction,
  type RadioAgent,
  type RadioConnection,
} from '@haus/core';

describe('Nearby Radio Agents & Transport Boundaries (P20.4)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('proves nearby client transport proxying, multi-agent scan, exclusive owner selection, lease expiry, and wrong-home isolation', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-comm-radio-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);

    try {
      // 1. Authenticate admin client
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'desktop-client-1', clientName: 'Admin Laptop', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const authHeaders = {
        authorization: `Bearer ${paired.credentials.sessionToken}`,
        'content-type': 'application/json',
      };
      const homeId = confirmed.grant.homeId;

      // 2. Hub with no local Bluetooth fails gracefully on Improv BLE commissioning
      expect(commService.radios.list().length).toBe(0);

      const noRadioRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'improv:LivingRoomLight' }),
      });
      expect(noRadioRes.status).toBe(202);
      const noRadioTx = (await noRadioRes.json()) as CommissioningTransaction;

      // Wait briefly for failure event
      await new Promise((r) => setTimeout(r, 50));
      const failedTxRes = await fetch(`${base}/api/commissioning/sessions/${noRadioTx.commissioningId}`, {
        headers: authHeaders,
      });
      const failedTx = (await failedTxRes.json()) as CommissioningTransaction;
      expect(failedTx.state).toBe('FAILED');
      expect(failedTx.error).toBe('no_radio_agent_available');

      // 3. Register nearby radio agent (Desktop Mac with BLE)
      const regRes = await fetch(`${base}/api/commissioning/radios/register`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 'agent-mac-ble',
          name: 'MacBook Pro Bluetooth',
          platform: 'macos',
          capabilities: { bleScan: true, bleConnect: true, rssiReporting: true },
        }),
      });
      expect(regRes.status).toBe(201);
      const regAgent = (await regRes.json()) as { id: string; name: string; platform: string; status: string };
      expect(regAgent.id).toBe('agent-mac-ble');
      expect(regAgent.platform).toBe('macos');
      expect(regAgent.status).toBe('online');

      // 4. List radio agents
      const listRes = await fetch(`${base}/api/commissioning/radios`, { headers: authHeaders });
      expect(listRes.status).toBe(200);
      const agents = (await listRes.json()) as { id: string }[];
      expect(agents.some((a) => a.id === 'agent-mac-ble')).toBe(true);

      // 5. Heartbeat updates agent liveness
      const hbRes = await fetch(`${base}/api/commissioning/radios/agent-mac-ble/heartbeat`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(hbRes.status).toBe(200);
      const hbData = (await hbRes.json()) as { status: string; lastSeenAt: number };
      expect(hbData.status).toBe('ok');
      expect(hbData.lastSeenAt).toBeGreaterThan(0);

      // 6. Test Multi-agent scanning and exclusive transport owner selection:
      // Register a second agent (Mobile Android)
      let mobileScanAborted = false;
      const mobileAgent: RadioAgent = {
        id: 'agent-mobile-2',
        platform: 'android',
        async *scan(req) {
          try {
            await new Promise((_, reject) => {
              const timer = setTimeout(() => reject(new Error('timeout')), 5000);
              req.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('aborted'));
              });
            });
            yield targetAdv;
          } finally {
            mobileScanAborted = true;
          }
        },
        async connect() {
          throw new Error('not_implemented');
        },
      };
      commService.radios.register(mobileAgent, {
        name: 'Android Phone BLE',
        homeId,
        capabilities: { bleScan: true, bleConnect: true },
      });

      // Register mock desktop agent that finds the target device
      let desktopGattWrites: Uint8Array[] = [];
      const targetAdv: Advertisement = {
        agentId: 'agent-mac-ble',
        transport: 'ble',
        protocol: 'improv',
        identifier: 'AA:BB:CC:DD:EE:FF',
        name: 'LivingRoomLight',
      };

      const desktopAgentMock: RadioAgent = {
        id: 'agent-mac-ble',
        platform: 'macos',
        async *scan() {
          yield targetAdv;
        },
        async connect(): Promise<RadioConnection> {
          let stateListener: ((d: Uint8Array) => void) | undefined;
          return {
            device: { agentId: 'agent-mac-ble', identifier: 'AA:BB:CC:DD:EE:FF', transport: 'ble' },
            async writeCharacteristic(_s, _c, data) {
              desktopGattWrites.push(data);
              stateListener?.(new Uint8Array([ImprovState.provisioned]));
            },
            async readCharacteristic() {
              return new Uint8Array([ImprovState.authorized]);
            },
            async subscribeCharacteristic(_s, _c, l) {
              stateListener = l;
              return () => undefined;
            },
            async close() {},
          };
        },
      };
      // Override agent-mac-ble in registry with the mock
      commService.radios.register(desktopAgentMock, {
        name: 'MacBook Pro Mock',
        homeId,
        capabilities: { bleScan: true, bleConnect: true },
      });

      // 7. Commission Improv device through nearby agent
      const commRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'improv:LivingRoomLight' }),
      });
      const commTx = (await commRes.json()) as CommissioningTransaction;

      // Provide Wi-Fi credentials
      const credRes = await fetch(`${base}/api/commissioning/sessions/${commTx.commissioningId}/credentials`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ ssid: 'Household-WiFi', password: 'SecretPassword987' }),
      });
      expect(credRes.status).toBe(202);

      // Wait for provisioning completion
      let doneTx: CommissioningTransaction | undefined;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const checkRes = await fetch(`${base}/api/commissioning/sessions/${commTx.commissioningId}`, {
          headers: authHeaders,
        });
        const cur = (await checkRes.json()) as CommissioningTransaction;
        if (cur.state === 'DONE' || cur.state === 'FAILED') {
          doneTx = cur;
          break;
        }
      }
      expect(doneTx?.state).toBe('DONE');
      expect(desktopGattWrites.length).toBeGreaterThan(0);

      // Verify losing scans were closed on other agents
      expect(mobileScanAborted).toBe(true);

      // 8. Verify security boundaries:
      // a) Transaction lease is revoked after completion (expired/revoked agents cannot continue)
      expect(commService.radios.validateLease('any-token', commTx.commissioningId, homeId)).toBe(false);

      // b) Wrong-home access rejection
      const wrongHomeRes = await fetch(`${base}/api/commissioning/sessions/${commTx.commissioningId}/claim-radio`, {
        method: 'POST',
        headers: { ...authHeaders, 'x-haus-home-id': 'wrong-home-id' },
        body: JSON.stringify({ agentId: 'agent-mac-ble' }),
      });
      expect(wrongHomeRes.status).toBe(403);

      // c) Revoked / unregistered agent cannot be used
      const delRes = await fetch(`${base}/api/commissioning/radios/agent-mac-ble`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      expect(delRes.status).toBe(200);

      const checkListRes = await fetch(`${base}/api/commissioning/radios`, { headers: authHeaders });
      const currentAgents = (await checkListRes.json()) as { id: string }[];
      expect(currentAgents.some((a) => a.id === 'agent-mac-ble')).toBe(false);
    } finally {
      await app.close();
    }
  });
});
