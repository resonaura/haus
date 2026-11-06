/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  MatterMultiAdminService,
  decodeMatterQrCode,
  encodeMatterQrCode,
  generateManualPairingCode,
} from '../src/index.js';

describe('Matter Commissioning & Multi-Admin Sharing', () => {
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
});
