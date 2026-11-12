/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatterCommissioningParams, MatterTransport } from '@haus/matter';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { MatterHandoffService } from '../../src/commissioning/matter-handoff.service.js';
import type { MatterService } from '../../src/matter/service.js';

class MockStandaloneMatterTransport implements MatterTransport {
  public failCommissionWith?: Error;
  public failCommandWith?: Error;
  public failAttributeWith?: Error;
  public commissioned: MatterCommissioningParams[] = [];
  public commandsSent: Array<{
    nodeId: string;
    endpointId: number;
    clusterId: number;
    commandId: number;
    payload?: unknown;
  }> = [];

  async commission(params: MatterCommissioningParams) {
    if (this.failCommissionWith) throw this.failCommissionWith;
    this.commissioned.push(params);
    return { nodeId: 'matter-node-permanent-101', fabricIndex: 2 };
  }

  async sendCommand(
    nodeId: string,
    endpointId: number,
    clusterId: number,
    commandId: number,
    payload?: unknown,
  ) {
    if (this.failCommandWith) throw this.failCommandWith;
    this.commandsSent.push({ nodeId, endpointId, clusterId, commandId, payload });
    return { status: 0 };
  }

  async readAttribute(nodeId: string, endpointId: number, clusterId: number, attributeId: number) {
    if (this.failAttributeWith) throw this.failAttributeWith;
    return { nodeId, endpointId, clusterId, attributeId, value: 'Haus-Permanent-Device' };
  }

  async writeAttribute() {}
  subscribe() {
    return () => {};
  }
}

describe('Remote Matter Handoff & Permanent Ownership (P20.10)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('proves no-local-BLE Hub flow, zero key/NOC leak, verify-before-remove, uncertain ACK preservation, expired window reopening, and lost client resilience', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-matter-handoff-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const handoffService = app.get<MatterHandoffService>(MatterHandoffService);

    // Mock Matter transport on handoffService
    const mockTransport = new MockStandaloneMatterTransport();
    const mockMatter = {
      isConfigured: true,
      transport: mockTransport,
      refreshNodes: vi.fn(async () => {}),
    } as unknown as MatterService;
    (handoffService as unknown as { matterService: MatterService }).matterService = mockMatter;

    try {
      // 1. Authenticate session
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
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };

      // 2. Invariant: strictly reject transfer of private keys, NOCs, or fabric databases
      const forbiddenLeakRes = await fetch(`${base}/api/commissioning/matter-handoff/initiate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          handoffId: 'leak-test-1',
          commissioningId: 'comm-leak-1',
          targetIp: '192.168.1.180',
          discriminator: 3840,
          passcode: 20202021,
          temporaryFabricIndex: 1,
          windowExpiresAt: Date.now() + 600_000,
          privateKey: 'FORBIDDEN_DEVICE_PRIVATE_KEY_DUMP',
        }),
      });
      expect(forbiddenLeakRes.status).toBe(400);
      const leakErr = (await forbiddenLeakRes.json()) as { error: string };
      expect(leakErr.error).toBe('forbidden_credential_transfer');

      // 3. Invariant: fail-closed wrong-home rejection
      const wrongHomeRes = await fetch(`${base}/api/commissioning/matter-handoff/initiate`, {
        method: 'POST',
        headers: { ...headers, 'x-haus-home-id': 'unauthorized-other-home' },
        body: JSON.stringify({
          handoffId: 'wrong-home-1',
          commissioningId: 'comm-1',
          targetIp: '192.168.1.180',
          discriminator: 3840,
          passcode: 20202021,
          temporaryFabricIndex: 1,
          windowExpiresAt: Date.now() + 600_000,
        }),
      });
      expect(wrongHomeRes.status).toBe(403);

      // 4. Initiate valid handoff from temporary commissioner
      const initRes = await fetch(`${base}/api/commissioning/matter-handoff/initiate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          handoffId: 'handoff-primary-001',
          commissioningId: 'comm-trans-001',
          temporaryCommissionerId: 'client-mobile-01',
          targetIp: '192.168.1.180',
          targetPort: 5540,
          discriminator: 3840,
          passcode: 20202021,
          temporaryFabricIndex: 1,
          windowExpiresAt: Date.now() + 600_000,
        }),
      });
      expect(initRes.status).toBe(201);
      const initData = (await initRes.json()) as {
        status: string;
        session: {
          handoffId: string;
          status: string;
          manualPairingCode: string;
          qrPairingCode: string;
          permanentFabricVerified: boolean;
        };
      };
      expect(initData.status).toBe('created');
      expect(initData.session.status).toBe('WINDOW_OPENED');
      expect(initData.session.manualPairingCode).toMatch(/^\d{5}-\d{6}$/);
      expect(initData.session.qrPairingCode.startsWith('MT:')).toBe(true);
      expect(initData.session.permanentFabricVerified).toBe(false);

      // 5. Invariant: Verify-before-remove. Attempting removal before Hub verification fails!
      const prematureRemovalRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-primary-001/remove-temporary-fabric`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(prematureRemovalRes.status).toBe(400);
      const prematureErr = (await prematureRemovalRes.json()) as { error: string };
      expect(prematureErr.error).toBe('permanent_fabric_not_verified');

      // 6. Hub permanent commissioning over IP
      const commRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-primary-001/commission`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(commRes.status).toBe(200);
      const commData = (await commRes.json()) as {
        status: string;
        session: {
          status: string;
          permanentNodeId: string;
          permanentFabricIndex: number;
          permanentFabricVerified: boolean;
          realDeviceControlVerified: boolean;
        };
      };
      expect(commData.status).toBe('commissioned');
      expect(commData.session.status).toBe('PERMANENT_VERIFIED');
      expect(commData.session.permanentNodeId).toBe('matter-node-permanent-101');
      expect(commData.session.permanentFabricIndex).toBe(2);
      expect(commData.session.permanentFabricVerified).toBe(true);
      expect(commData.session.realDeviceControlVerified).toBe(true);

      expect(mockTransport.commissioned).toHaveLength(1);
      expect(mockTransport.commissioned[0].ip).toBe('192.168.1.180');
      expect(mockMatter.refreshNodes).toHaveBeenCalled();

      // 7. Invariant: Never remove controller after uncertain acknowledgement
      // First, simulate command timeout / network jitter
      mockTransport.failCommandWith = new Error('matter_request_timeout: device_command');

      const uncertainRemovalRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-primary-001/remove-temporary-fabric`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(uncertainRemovalRes.status).toBe(200);
      const uncertainData = (await uncertainRemovalRes.json()) as {
        status: string;
        removed: boolean;
        uncertain: boolean;
      };
      expect(uncertainData.status).toBe('uncertain_preserved');
      expect(uncertainData.removed).toBe(false);
      expect(uncertainData.uncertain).toBe(true);

      // Verify the session preserved the temporary fabric instead of corrupting state
      const sessionAfterUncertain = handoffService.getSession('handoff-primary-001')!;
      expect(sessionAfterUncertain.status).toBe('UNCERTAIN_REMOVAL');
      expect(sessionAfterUncertain.temporaryFabricRemoved).toBe(false);
      expect(sessionAfterUncertain.uncertainAck).toBe(true);
      expect(sessionAfterUncertain.permanentFabricVerified).toBe(true);

      // Now restore transport and execute clean temporary fabric removal
      mockTransport.failCommandWith = undefined;
      const cleanRemovalRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-primary-001/remove-temporary-fabric`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(cleanRemovalRes.status).toBe(200);
      const cleanData = (await cleanRemovalRes.json()) as {
        status: string;
        removed: boolean;
        uncertain: boolean;
      };
      expect(cleanData.status).toBe('removed');
      expect(cleanData.removed).toBe(true);
      expect(cleanData.uncertain).toBe(false);

      const sessionAfterClean = handoffService.getSession('handoff-primary-001')!;
      expect(sessionAfterClean.status).toBe('TEMPORARY_FABRIC_REMOVED');
      expect(sessionAfterClean.temporaryFabricRemoved).toBe(true);
      expect(sessionAfterClean.uncertainAck).toBe(false);

      // 8. Expired window and reopen handling
      await fetch(`${base}/api/commissioning/matter-handoff/initiate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          handoffId: 'handoff-expired-002',
          commissioningId: 'comm-exp-002',
          targetIp: '192.168.1.185',
          discriminator: 1234,
          passcode: 34567890,
          temporaryFabricIndex: 1,
          windowExpiresAt: Date.now() + 50, // expires in 50ms
        }),
      });

      // Wait 70ms for expiration
      await new Promise((r) => setTimeout(r, 70));

      const expiredCommRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-expired-002/commission`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(expiredCommRes.status).toBe(400);
      const expErr = (await expiredCommRes.json()) as { error: string };
      expect(expErr.error).toBe('commissioning_window_expired');

      // Reopen window
      const reopenRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-expired-002/reopen`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            newExpiresAt: Date.now() + 600_000,
            newPasscode: 34567891,
          }),
        },
      );
      expect(reopenRes.status).toBe(200);
      const reopenData = (await reopenRes.json()) as {
        status: string;
        session: { status: string; passcode: number };
      };
      expect(reopenData.status).toBe('reopened');
      expect(reopenData.session.status).toBe('WINDOW_OPENED');
      expect(reopenData.session.passcode).toBe(34567891);

      // Commissioning now succeeds
      const retryCommRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-expired-002/commission`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(retryCommRes.status).toBe(200);

      // 9. Lost client resilience: temporary commissioner client drops off
      // Hub completes commissioning independently and maintains persistent control
      await fetch(`${base}/api/commissioning/matter-handoff/initiate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          handoffId: 'handoff-lost-client-003',
          commissioningId: 'comm-lost-003',
          temporaryCommissionerId: 'client-desktop-offline',
          targetIp: '192.168.1.190',
          discriminator: 2048,
          passcode: 11223344,
          temporaryFabricIndex: 1,
          windowExpiresAt: Date.now() + 600_000,
        }),
      });

      // Hub pairs without client involvement
      const lostClientRes = await fetch(
        `${base}/api/commissioning/matter-handoff/handoff-lost-client-003/commission`,
        {
          method: 'POST',
          headers,
        },
      );
      expect(lostClientRes.status).toBe(200);
      const lostClientSession = handoffService.getSession('handoff-lost-client-003')!;
      expect(lostClientSession.permanentFabricVerified).toBe(true);
      expect(lostClientSession.status).toBe('PERMANENT_VERIFIED');
    } finally {
      await app.close();
    }
  });
});
