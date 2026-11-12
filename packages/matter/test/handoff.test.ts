/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  MatterHandoffManager,
  validateHandoffRequest,
  type MatterHandoffRequest,
  type MatterTransport,
  type MatterCommissioningParams,
  MatterClusterId,
} from '../src/index.js';

class MockHandoffTransport implements MatterTransport {
  public failCommissionWith?: Error;
  public failAttributeWith?: Error;
  public failCommandWith?: Error;
  public commissionedParams: MatterCommissioningParams[] = [];
  public commandsSent: Array<{
    nodeId: string;
    endpointId: number;
    clusterId: number;
    commandId: number;
    payload?: unknown;
  }> = [];

  async commission(params: MatterCommissioningParams) {
    if (this.failCommissionWith) throw this.failCommissionWith;
    this.commissionedParams.push(params);
    return { nodeId: 'matter-node-permanent-1', fabricIndex: 2 };
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
    return { nodeId, endpointId, clusterId, attributeId, value: 'Haus-Verified-Device' };
  }

  async writeAttribute() {}
  subscribe() {
    return () => {};
  }
}

describe('Matter Remote Handoff & Permanent Ownership (P20.10)', () => {
  const sampleRequest: MatterHandoffRequest = {
    handoffId: 'handoff-001',
    commissioningId: 'comm-sess-001',
    homeId: 'home-alpha',
    temporaryCommissionerId: 'client-mobile-01',
    targetIp: '192.168.1.150',
    targetPort: 5540,
    discriminator: 3840,
    passcode: 20202021,
    temporaryFabricIndex: 1,
    windowExpiresAt: Date.now() + 600_000,
  };

  it('strictly rejects transfer of private keys, NOCs, or fabric databases', () => {
    expect(() =>
      validateHandoffRequest({
        ...sampleRequest,
        privateKey: 'SECRET_KEY_DUMP',
      }),
    ).toThrow(/forbidden_credential_transfer/);

    expect(() =>
      validateHandoffRequest({
        ...sampleRequest,
        noc: 'NOC_CERTIFICATE_DATA',
      }),
    ).toThrow(/forbidden_credential_transfer/);

    expect(() =>
      validateHandoffRequest({
        ...sampleRequest,
        fabricDatabase: { fabrics: [{ id: 1 }] },
      }),
    ).toThrow(/forbidden_credential_transfer/);
  });

  it('creates handoff session with valid manual and QR pairing codes', () => {
    const manager = new MatterHandoffManager();
    const session = manager.createSession(sampleRequest);

    expect(session.handoffId).toBe('handoff-001');
    expect(session.temporaryFabricIndex).toBe(1);
    expect(session.manualPairingCode).toMatch(/^\d{5}-\d{6}$/);
    expect(session.qrPairingCode.startsWith('MT:')).toBe(true);
    expect(session.status).toBe('WINDOW_OPENED');
    expect(session.permanentFabricVerified).toBe(false);
  });

  it('executes Hub permanent commissioning, verifies CASE and real device control', async () => {
    const manager = new MatterHandoffManager();
    const session = manager.createSession(sampleRequest);
    const transport = new MockHandoffTransport();

    const updated = await manager.executeHubCommissioning(session.handoffId, transport);

    expect(updated.status).toBe('PERMANENT_VERIFIED');
    expect(updated.permanentNodeId).toBe('matter-node-permanent-1');
    expect(updated.permanentFabricIndex).toBe(2);
    expect(updated.permanentFabricVerified).toBe(true);
    expect(updated.realDeviceControlVerified).toBe(true);

    expect(transport.commissionedParams).toHaveLength(1);
    expect(transport.commissionedParams[0].ip).toBe('192.168.1.150');
    expect(transport.commissionedParams[0].port).toBe(5540);
  });

  it('enforces verify-before-remove: rejects temporary fabric removal before permanent verification', async () => {
    const manager = new MatterHandoffManager();
    const session = manager.createSession(sampleRequest);
    const transport = new MockHandoffTransport();

    await expect(
      manager.removeTemporaryFabric(session.handoffId, transport),
    ).rejects.toThrow(/permanent_fabric_not_verified/);

    expect(transport.commandsSent).toHaveLength(0);
    expect(session.temporaryFabricRemoved).toBe(false);
  });

  it('removes temporary fabric cleanly after permanent controller verification', async () => {
    const manager = new MatterHandoffManager();
    manager.createSession(sampleRequest);
    const transport = new MockHandoffTransport();

    await manager.executeHubCommissioning('handoff-001', transport);
    const res = await manager.removeTemporaryFabric('handoff-001', transport);

    expect(res.removed).toBe(true);
    expect(res.uncertain).toBe(false);

    const session = manager.getSession('handoff-001');
    expect(session?.status).toBe('TEMPORARY_FABRIC_REMOVED');
    expect(session?.temporaryFabricRemoved).toBe(true);
    expect(session?.uncertainAck).toBe(false);

    expect(transport.commandsSent).toContainEqual({
      nodeId: 'matter-node-permanent-1',
      endpointId: 0,
      clusterId: MatterClusterId.OperationalCredentials,
      commandId: 0x0a, // RemoveFabric
      payload: { fabric_index: 1 },
    });
  });

  it('never removes temporary fabric on uncertain acknowledgement or command failure', async () => {
    const manager = new MatterHandoffManager();
    manager.createSession(sampleRequest);
    const transport = new MockHandoffTransport();

    await manager.executeHubCommissioning('handoff-001', transport);

    // Simulate network drop / timeout / uncertain ACK
    transport.failCommandWith = new Error('matter_request_timeout: device_command');

    const res = await manager.removeTemporaryFabric('handoff-001', transport);

    expect(res.removed).toBe(false);
    expect(res.uncertain).toBe(true);

    const session = manager.getSession('handoff-001');
    expect(session?.status).toBe('UNCERTAIN_REMOVAL');
    expect(session?.temporaryFabricRemoved).toBe(false);
    expect(session?.uncertainAck).toBe(true);
    // Crucial invariant: The device remains under permanent Hub control; temporary fabric is preserved rather than corrupted
    expect(session?.permanentFabricVerified).toBe(true);
  });

  it('detects expired commissioning window and supports reopening', async () => {
    const manager = new MatterHandoffManager();
    const expiredRequest: MatterHandoffRequest = {
      ...sampleRequest,
      handoffId: 'handoff-expired',
      windowExpiresAt: Date.now() + 50,
    };
    manager.createSession(expiredRequest);

    // Wait 60ms to let window expire
    await new Promise((r) => setTimeout(r, 60));

    const transport = new MockHandoffTransport();
    await expect(
      manager.executeHubCommissioning('handoff-expired', transport),
    ).rejects.toThrow(/commissioning_window_expired/);

    const session = manager.getSession('handoff-expired');
    expect(session?.status).toBe('WINDOW_EXPIRED');

    // Reopen window
    const newExpiresAt = Date.now() + 600_000;
    const reopened = manager.reopenWindow('handoff-expired', newExpiresAt, 20202022);
    expect(reopened.status).toBe('WINDOW_OPENED');
    expect(reopened.passcode).toBe(20202022);
    expect(reopened.windowExpiresAt).toBe(newExpiresAt);

    // Now Hub commissioning succeeds
    const finalSession = await manager.executeHubCommissioning('handoff-expired', transport);
    expect(finalSession.status).toBe('PERMANENT_VERIFIED');
  });

  it('handles lost client gracefully: Hub completes commissioning without requiring live client', async () => {
    const manager = new MatterHandoffManager();
    manager.createSession(sampleRequest);
    const transport = new MockHandoffTransport();

    // Client goes offline (no calls from client-mobile-01)
    // Hub proceeds with pairing independently
    const session = await manager.executeHubCommissioning(sampleRequest.handoffId, transport);

    expect(session.permanentFabricVerified).toBe(true);
    expect(session.status).toBe('PERMANENT_VERIFIED');
  });
});
