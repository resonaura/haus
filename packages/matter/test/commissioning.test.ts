/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MatterController,
  MatterMultiAdminService,
  MatterWsTransport,
  decodeMatterQrCode,
  encodeMatterQrCode,
  generateManualPairingCode,
} from '../src/index.js';

describe('Matter Commissioning & Multi-Admin Sharing', () => {
  async function withMockServer(
    handler: (ws: WebSocket, reqMsg: Record<string, unknown>) => void,
    fn: (url: string) => Promise<void>,
  ): Promise<void> {
    const server = createServer();
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ sdk_version: 'matter.js/0.18.0' }));
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        handler(ws, msg);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    try {
      await fn(url);
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  it('encodes and decodes standard Matter QR codes (MT:...)', () => {
    const original = {
      discriminator: 3840,
      passcode: 20202021,
      vendorId: 0xfff1,
      productId: 0x8001,
      commissioningFlow: 0,
      discoveryCapabilities: 4,
    };

    const qr = encodeMatterQrCode(original);
    expect(qr.startsWith('MT:')).toBe(true);

    const decoded = decodeMatterQrCode(qr);
    expect(decoded.discriminator).toBe(original.discriminator);
    expect(decoded.passcode).toBe(original.passcode);
    expect(decoded.vendorId).toBe(original.vendorId);
    expect(decoded.productId).toBe(original.productId);
  });

  it('generates formatted 11-digit manual pairing code (XXXXX-XXXXXX)', () => {
    const code = generateManualPairingCode(3840, 20202021);
    expect(code).toMatch(/^\d{5}-\d{6}$/);
    const digitsOnly = code.replace('-', '');
    expect(digitsOnly).toHaveLength(11);
  });

  it('opens and manages Multi-Admin commissioning window for external ecosystems', async () => {
    const multiAdmin = new MatterMultiAdminService();

    const window = await multiAdmin.openCommissioningWindow({
      nodeId: 'node-bulb-01',
      durationSeconds: 300,
      discriminator: 1234,
      passcode: 34567890,
    });

    expect(window.nodeId).toBe('node-bulb-01');
    expect(window.passcode).toBe(34567890);
    expect(window.discriminator).toBe(1234);
    expect(window.qrPairingCode.startsWith('MT:')).toBe(true);
    expect(window.manualPairingCode).toMatch(/^\d{5}-\d{6}$/);
    expect(window.expiresAt).toBeGreaterThan(Date.now());

    expect(multiAdmin.getActiveWindow('node-bulb-01')).toEqual(window);
    expect(multiAdmin.closeCommissioningWindow('node-bulb-01')).toBe(true);
    expect(multiAdmin.getActiveWindow('node-bulb-01')).toBeUndefined();

    // Enhanced Commissioning Method share window
    const sharePayload = await multiAdmin.openShareWindow({
      nodeId: 'node-vacuum-01',
      expiresSeconds: 600,
      targetEcosystem: 'apple',
    });
    expect(sharePayload.qrPayload.startsWith('MT:')).toBe(true);
    expect(sharePayload.manualPairingCode).toMatch(/^\d{5}-\d{6}$/);
    expect(sharePayload.discriminator).toBeGreaterThanOrEqual(0);
    expect(sharePayload.expiresAt).toBeDefined();
  });

  it('provisions Wi-Fi credentials and Thread dataset during commissioning', async () => {
    const receivedCommands: Array<Record<string, unknown>> = [];

    await withMockServer(
      (ws, msg) => {
        receivedCommands.push(msg);
        if (msg.command === 'set_wifi_credentials') {
          ws.send(JSON.stringify({ message_id: msg.message_id, result: null }));
        } else if (msg.command === 'set_thread_dataset') {
          ws.send(JSON.stringify({ message_id: msg.message_id, result: null }));
        } else if (msg.command === 'commission_with_code') {
          ws.send(
            JSON.stringify({
              message_id: msg.message_id,
              result: { node_id: 42, fabric_index: 2 },
            }),
          );
        }
      },
      async (url) => {
        const transport = new MatterWsTransport({ url });
        await transport.connect();

        const controller = new MatterController(transport);
        await controller.setWifiCredentials('HausGuest', 'secretWifiPass');
        await controller.setThreadDataset(new Uint8Array([0x0e, 0x08, 0x00, 0x11, 0x22, 0x33]));

        const res = await transport.commission({
          code: 'MT:Y.K9042C00KA0648G00',
          ip: '192.168.1.120',
          port: 5540,
          wifiSsid: 'HausNetwork',
          wifiPassword: 'securePassword123',
          threadDataset: '0e080000000000010000',
          failSafeTimeoutSeconds: 90,
        });

        expect(res.nodeId).toBe('42');
        expect(res.fabricIndex).toBe(2);

        const wifiCalls = receivedCommands.filter((c) => c.command === 'set_wifi_credentials');
        expect(wifiCalls).toHaveLength(2);
        expect(wifiCalls[1]?.args).toEqual({
          ssid: 'HausNetwork',
          credentials: 'securePassword123',
        });

        const threadCalls = receivedCommands.filter((c) => c.command === 'set_thread_dataset');
        expect(threadCalls).toHaveLength(2);
        expect(threadCalls[0]?.args).toEqual({ dataset: '0e0800112233' });
        expect(threadCalls[1]?.args).toEqual({ dataset: '0e080000000000010000' });

        const commCalls = receivedCommands.filter((c) => c.command === 'commission_with_code');
        expect(commCalls).toHaveLength(1);
        expect(commCalls[0]?.args).toEqual({
          code: 'MT:Y.K9042C00KA0648G00',
          network_only: true,
          ip_addr: '192.168.1.120',
          port: 5540,
          failsafe_timeout: 90,
        });

        transport.close();
      },
    );
  });

  it('propagates server commissioning errors with code and details', async () => {
    await withMockServer(
      (ws, msg) => {
        if (msg.command === 'commission_with_code') {
          ws.send(
            JSON.stringify({
              message_id: msg.message_id,
              error_code: 'window_expired',
              details: 'Device commissioning window closed',
            }),
          );
        }
      },
      async (url) => {
        const transport = new MatterWsTransport({ url });
        await transport.connect();

        await expect(
          transport.commission({
            code: 'MT:Y.K9042C00KA0648G00',
          }),
        ).rejects.toThrow('matter_error_window_expired: Device commissioning window closed');

        transport.close();
      },
    );
  });
});
