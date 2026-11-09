/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import { parseSetupCode } from '../src/commissioning/index.js';

describe('parseSetupCode', () => {
  it('parses a Matter QR payload', () => {
    const parsed = parseSetupCode('MT:Y.K9042C00KA0648G00');
    expect(parsed.kind).toBe('matter-qr');
    expect(parsed.matter?.passcode).toBe(20202021);
    expect(parsed.matter?.discriminator).toEqual({ value: 3840, type: 'long' });
  });

  it('parses an 11-digit Matter manual code', () => {
    const parsed = parseSetupCode('3497-011-2332');
    expect(parsed.kind).toBe('matter-manual');
    expect(parsed.matter?.passcode).toBe(20202021);
    expect(parsed.matter?.discriminator).toEqual({ value: 15, type: 'short' });
  });

  it('parses HomeKit PINs in any grouping', () => {
    for (const raw of ['8169 1935', '816-91-935', '81691935']) {
      const parsed = parseSetupCode(raw);
      expect(parsed.kind).toBe('homekit-pin');
      expect(parsed.homekit?.pin).toBe('816-91-935');
    }
  });

  it('parses improv and rejects garbage', () => {
    expect(parseSetupCode('improv:Lamp').improv?.deviceNameHint).toBe('Lamp');
    expect(() => parseSetupCode('abc')).toThrow();
    expect(() => parseSetupCode('')).toThrow();
  });
});

import {
  chunkImprovPacket,
  decodeImprovRpcResult,
  encodeImprovWifiCommand,
} from '../src/commissioning/index.js';

describe('improv codec', () => {
  it('encodes Wi-Fi settings with checksum and chunks to 20 bytes', () => {
    const packet = encodeImprovWifiCommand('Home', 'secret-pass-123');
    expect(packet[0]).toBe(1);
    expect(packet[1]).toBe(2 + 4 + 15);
    const sum = packet.slice(0, -1).reduce((a, b) => (a + b) & 0xff, 0);
    expect(packet[packet.length - 1]).toBe(sum);
    const chunks = chunkImprovPacket(packet);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(packet.length);
  });

  it('decodes RPC result and rejects bad checksum', () => {
    const url = new TextEncoder().encode('http://x');
    const body = new Uint8Array([1, url.length + 1, url.length, ...url]);
    const sum = body.reduce((a, b) => (a + b) & 0xff, 0);
    const packet = new Uint8Array([...body, sum]);
    expect(decodeImprovRpcResult(packet)?.strings).toEqual(['http://x']);
    packet[packet.length - 1] = (sum + 1) & 0xff;
    expect(decodeImprovRpcResult(packet)).toBeUndefined();
  });
});
