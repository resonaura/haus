/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiscoveryRegistry,
  parseSetupCode,
  type Advertisement,
  type CommissioningContext,
  type CommissioningEvent,
  type RadioAgent,
  type RadioDevice,
} from '@haus/core';
import {
  encodeMatterQrCode,
  type MatterCommissioningParams,
  type MatterTransport,
} from '@haus/matter';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { MatterAdapter } from '../../src/commissioning/adapters.js';
import { RadioAgentRegistry } from '../../src/commissioning/radio.js';
import { IpHandoverCoordinator } from '../../src/commissioning/handover.js';
import type { MatterService } from '../../src/matter/service.js';

class MockMatterTransport implements MatterTransport {
  public commissioned: MatterCommissioningParams[] = [];
  public wifiSet: Array<{ ssid: string; password: string }> = [];
  public threadSet: Array<string | Uint8Array> = [];
  public failWith?: Error;

  async commission(params: MatterCommissioningParams) {
    if (this.failWith) throw this.failWith;
    this.commissioned.push(params);
    return { nodeId: 'matter-node-101', fabricIndex: 1 };
  }
  async setWifiCredentials(ssid: string, password: string) {
    this.wifiSet.push({ ssid, password });
  }
  async setThreadDataset(dataset: string | Uint8Array) {
    this.threadSet.push(dataset);
  }
  async sendCommand() { return null; }
  async readAttribute() { return null; }
  async writeAttribute() {}
  subscribe() { return () => {}; }
}

function createMockMatter(transport: MatterTransport): MatterService {
  return { isConfigured: true, transport, refreshNodes: vi.fn(async () => {}) } as unknown as MatterService;
}

function createMockAgent(id: string): RadioAgent {
  return {
    id,
    platform: 'ios',
    async *scan() {
      yield {
        agentId: id,
        transport: 'ble',
        identifier: 'cand-ble',
        name: 'Cand',
        protocol: 'matter',
      };
    },
    async connect(device: RadioDevice) {
      return {
        device,
        writeCharacteristic: async () => {},
        readCharacteristic: async () => new Uint8Array(),
        subscribeCharacteristic: async () => async () => {},
        close: async () => {},
      };
    },
  };
}

describe('Matter IP, BLE, Wi-Fi & Thread Commissioning (P20.5)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('proves direct IP commissioning with QR code and long discriminator matching', async () => {
    const transport = new MockMatterTransport();
    const adapter = new MatterAdapter(createMockMatter(transport));
    const qr = encodeMatterQrCode({ discriminator: 3840, passcode: 20202021, discoveryCapabilities: 4 });
    const events: CommissioningEvent[] = [];

    const candidate: Advertisement = {
      agentId: 'hub',
      transport: 'lan',
      protocol: 'matter',
      identifier: 'matter-cand-1',
      name: 'Matter Bulb On-Network',
      address: '192.168.1.150',
      port: 5540,
      discriminator: 3840,
      metadata: { commissioningMode: 1, pairingAvailable: true },
    };

    const ctx: CommissioningContext = {
      commissioningId: 'comm-direct-ip',
      parsedCode: parseSetupCode(qr),
      candidate,
      targetAddress: '192.168.1.150',
      targetPort: 5540,
      emit: (type, state, message, detail) => {
        events.push({ seq: events.length + 1, timestamp: Date.now(), type, state, message, detail });
      },
    };

    const result = await adapter.commission(ctx);
    expect(result.status).toBe('completed');
    expect(result.detail).toEqual({ nodeId: 'matter-node-101' });
    expect(transport.commissioned[0]?.ip).toBe('192.168.1.150');
    expect(events.map((e) => e.type)).toEqual([
      'secure_session.started',
      'controller.pairing',
      'controller.verified',
      'commission.completed',
    ]);
  });

  it('matches 11-digit manual pairing code using short discriminator', async () => {
    const transport = new MockMatterTransport();
    const adapter = new MatterAdapter(createMockMatter(transport));
    const manualCode = '3497-011-2332';
    const parsed = parseSetupCode(manualCode);
    expect(parsed.matter?.discriminator?.value).toBe(15);

    const candidate: Advertisement = {
      agentId: 'hub',
      transport: 'lan',
      protocol: 'matter',
      identifier: 'cand-manual',
      name: 'Manual Disc Candidate',
      address: '192.168.1.160',
      discriminator: 3840,
      metadata: { commissioningMode: 1, pairingAvailable: true },
    };

    const res = await adapter.commission({ commissioningId: 'comm-manual', parsedCode: parsed, candidate, emit: () => {} });
    expect(res.status).toBe('completed');
    expect(transport.commissioned).toHaveLength(1);
  });

  it('rejects candidate with discriminator mismatch or expired commissioning window', async () => {
    const transport = new MockMatterTransport();
    const adapter = new MatterAdapter(createMockMatter(transport));
    const parsed = parseSetupCode(encodeMatterQrCode({ discriminator: 3840, passcode: 20202021 }));

    const mismatchRes = await adapter.commission({
      commissioningId: 'comm-mismatch',
      parsedCode: parsed,
      candidate: {
        agentId: 'hub',
        transport: 'lan',
        protocol: 'matter',
        identifier: 'cand-mismatch',
        name: 'Mismatch',
        discriminator: 1234,
        metadata: { commissioningMode: 1, pairingAvailable: true },
      },
      emit: () => {},
    });
    expect(mismatchRes.status).toBe('failed');
    expect(mismatchRes.error).toBe('discriminator_mismatch');

    const expiredRes = await adapter.commission({
      commissioningId: 'comm-expired',
      parsedCode: parsed,
      candidate: {
        agentId: 'hub',
        transport: 'lan',
        protocol: 'matter',
        identifier: 'cand-expired',
        name: 'Expired',
        discriminator: 3840,
        paired: true,
        metadata: { commissioningMode: 0, pairingAvailable: false },
      },
      emit: () => {},
    });
    expect(expiredRes.status).toBe('failed');
    expect(expiredRes.error).toBe('commissioning_window_expired');
  });

  it('proves BLE-to-IP handover with Wi-Fi provisioning without false failure on BLE disconnect', async () => {
    const transport = new MockMatterTransport();
    const radios = new RadioAgentRegistry();
    const discovery = new DiscoveryRegistry();
    const handover = new IpHandoverCoordinator(discovery);
    const adapter = new MatterAdapter(createMockMatter(transport), radios, handover);

    radios.register(createMockAgent('mobile-agent-1'));
    const parsed = parseSetupCode(encodeMatterQrCode({ discriminator: 3840, passcode: 20202021, discoveryCapabilities: 2 }));

    const bleCandidate: Advertisement = {
      agentId: 'mobile-agent-1',
      transport: 'ble',
      protocol: 'matter',
      identifier: 'matter-ble-cand',
      name: 'Matter Plug BLE',
      discriminator: 3840,
      metadata: { commissioningMode: 1 },
    };

    const noCredsRes = await adapter.commission({
      commissioningId: 'comm-ble-handover',
      parsedCode: parsed,
      candidate: bleCandidate,
      emit: () => {},
    });
    expect(noCredsRes.status).toBe('credentials_required');
    expect(noCredsRes.requiresCredentials?.kind).toBe('wifi');

    const events: CommissioningEvent[] = [];
    setTimeout(() => {
      discovery.ingest({
        protocol: 'matter',
        domain: 'matter',
        name: 'Matter Plug IP',
        addresses: ['192.168.1.188'],
        port: 5540,
        details: { discriminator: 3840, commissioningMode: 1 },
      });
    }, 25);

    const handoverRes = await adapter.commission({
      commissioningId: 'comm-ble-handover',
      parsedCode: parsed,
      candidate: bleCandidate,
      wifiCredentials: { ssid: 'HomeIoT', password: 'SecretPassword' },
      emit: (type, state, message, detail) => {
        events.push({ seq: events.length + 1, timestamp: Date.now(), type, state, message, detail });
      },
    });

    expect(handoverRes.status).toBe('completed');
    expect(transport.wifiSet[0]).toEqual({ ssid: 'HomeIoT', password: 'SecretPassword' });
    expect(transport.commissioned[0]?.ip).toBe('192.168.1.188');
    expect(events.some((e) => e.type === 'device.ip.discovered' && e.state === 'WAIT_FOR_IP')).toBe(true);
  });

  it('proves Thread Active Operational Dataset provisioning for Thread candidate', async () => {
    const transport = new MockMatterTransport();
    const discovery = new DiscoveryRegistry();
    const handover = new IpHandoverCoordinator(discovery);
    const adapter = new MatterAdapter(createMockMatter(transport), undefined, handover);
    const parsed = parseSetupCode(encodeMatterQrCode({ discriminator: 3840, passcode: 20202021, discoveryCapabilities: 2 }));

    const threadCandidate: Advertisement = {
      agentId: 'hub',
      transport: 'ble',
      protocol: 'matter',
      identifier: 'cand-thread',
      name: 'Thread Sensor',
      discriminator: 3840,
      metadata: { networkType: 'thread' },
    };

    const reqRes = await adapter.commission({ commissioningId: 'comm-thread', parsedCode: parsed, candidate: threadCandidate, emit: () => {} });
    expect(reqRes.status).toBe('credentials_required');
    expect(reqRes.requiresCredentials?.kind).toBe('thread');

    setTimeout(() => {
      discovery.ingest({
        protocol: 'matter',
        domain: 'matter',
        name: 'Thread IP',
        addresses: ['fe80::1001'],
        port: 5540,
        details: { discriminator: 3840 },
      });
    }, 25);

    const res = await adapter.commission({
      commissioningId: 'comm-thread',
      parsedCode: parsed,
      candidate: threadCandidate,
      threadDataset: new Uint8Array([0x0e, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]),
      emit: () => {},
    });

    expect(res.status).toBe('completed');
    expect(transport.threadSet[0]).toEqual(new Uint8Array([0x0e, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]));
    expect(transport.commissioned[0]?.ip).toBe('fe80::1001');
  });

  it('maps invalid credentials and network timeouts cleanly without corrupting controller identity', async () => {
    const transport = new MockMatterTransport();
    const discovery = new DiscoveryRegistry();
    const handover = new IpHandoverCoordinator(discovery);
    const adapter = new MatterAdapter(createMockMatter(transport), undefined, handover);
    const parsed = parseSetupCode(encodeMatterQrCode({ discriminator: 3840, passcode: 20202021, discoveryCapabilities: 4 }));

    transport.failWith = new Error('matter_error_invalid_credentials: WiFi connect auth failed');
    const credsErrRes = await adapter.commission({ commissioningId: 'comm-err-creds', parsedCode: parsed, emit: () => {} });
    expect(credsErrRes.status).toBe('failed');
    expect(credsErrRes.error).toBe('invalid_network_credentials');

    transport.failWith = undefined;
    vi.spyOn(handover, 'waitForIp').mockRejectedValueOnce(new Error('network_join_timeout'));
    const timeoutRes = await adapter.commission({
      commissioningId: 'comm-timeout',
      parsedCode: parsed,
      candidate: {
        agentId: 'hub',
        transport: 'ble',
        protocol: 'matter',
        identifier: 'cand-to',
        name: 'Timing Out',
        discriminator: 3840,
      },
      wifiCredentials: { ssid: 'FakeSSID', password: 'FakePassword' },
      emit: () => {},
    });
    expect(timeoutRes.status).toBe('failed');
    expect(timeoutRes.error).toBe('network_join_timeout');
  });

  it('verifies end-to-end Matter onboarding through Hub Nest HTTP endpoints', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-comm-matter-'));
    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);

    const mockTransport = new MockMatterTransport();
    commService.adapters.push(new MatterAdapter(createMockMatter(mockTransport), commService.radios, commService.handover));

    try {
      const challengeRes = await fetch(`${base}/api/auth/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: challenge.sessionId, challengeCode, client: { clientId: 'admin-desk', clientName: 'Admin Desk', role: 'admin' } }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: confirmed.grant }) });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const headers = { authorization: `Bearer ${token}`, 'x-haus-home-id': confirmed.grant.homeId, 'content-type': 'application/json' };

      const qrCode = encodeMatterQrCode({ discriminator: 3840, passcode: 20202021, discoveryCapabilities: 4 });
      const sessionRes = await fetch(`${base}/api/commissioning/sessions`, { method: 'POST', headers, body: JSON.stringify({ code: qrCode }) });
      expect(sessionRes.status).toBe(202);
      const session = (await sessionRes.json()) as { commissioningId: string; parsedCode: { protocol: string } };
      expect(session.parsedCode.protocol).toBe('matter');

      const cand = commService.discovery.ingest({
        protocol: 'matter',
        domain: 'matter',
        name: 'Matter Bulb 1',
        addresses: ['192.168.1.199'],
        port: 5540,
        details: { commissioningMode: 1, discriminator: 3840 },
      });

      const selectRes = await fetch(`${base}/api/commissioning/sessions/${session.commissioningId}/select`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ candidateId: cand.id }),
      });
      expect(selectRes.status).toBe(200);

      let finalTx: { state: string; events: CommissioningEvent[] } | undefined;
      for (let i = 0; i < 30; i++) {
        const checkRes = await fetch(`${base}/api/commissioning/sessions/${session.commissioningId}`, { headers });
        finalTx = (await checkRes.json()) as { state: string; events: CommissioningEvent[] };
        if (finalTx.state === 'DONE') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(finalTx?.state).toBe('DONE');

      const eventTypes = finalTx?.events.map((e) => e.type) ?? [];
      expect(eventTypes).toContain('secure_session.started');
      expect(eventTypes).toContain('controller.pairing');
      expect(eventTypes).toContain('controller.verified');
      expect(eventTypes).toContain('commission.completed');
    } finally {
      await app.close();
    }
  });
});
