/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  computeVerhoeff,
  parseSetupCode,
  redactSetupCode,
  validateHomeKitPin,
  validateVerhoeff,
} from '../src/commissioning/index.js';

describe('parseSetupCode', () => {
  it('parses a Matter QR payload', () => {
    const parsed = parseSetupCode('MT:Y.K9042C00KA0648G00');
    expect(parsed.kind).toBe('matter-qr');
    expect(parsed.protocol).toBe('matter');
    expect(parsed.matter?.passcode).toBe(20202021);
    expect(parsed.matter?.discriminator).toEqual({ value: 3840, type: 'long' });
    expect(parsed.matter?.discoveryCapabilities?.ble).toBe(true);
  });

  it('validates Verhoeff check digits for Matter codes', () => {
    expect(validateVerhoeff('34970112332')).toBe(true);
    expect(validateVerhoeff('34970112339')).toBe(false);
    expect(computeVerhoeff('3497011233')).toBe(2);
  });

  it('parses an 11-digit Matter manual code and rejects corrupt check digits', () => {
    const parsed = parseSetupCode('3497-011-2332');
    expect(parsed.kind).toBe('matter-manual');
    expect(parsed.protocol).toBe('matter');
    expect(parsed.matter?.passcode).toBe(20202021);
    expect(parsed.matter?.discriminator).toEqual({ value: 15, type: 'short' });

    // Corrupt check digit must throw
    expect(() => parseSetupCode('3497-011-2339')).toThrow(/check digit verification failed/);
  });

  it('parses a 21-digit Matter manual code with VID and PID', () => {
    const parsed = parseSetupCode('62909-31232-9-04447-24578');
    expect(parsed.kind).toBe('matter-manual');
    expect(parsed.protocol).toBe('matter');
    expect(parsed.matter?.passcode).toBe(20197797);
    expect(parsed.matter?.discriminator).toEqual({ value: 9, type: 'short' });
    expect(parsed.matter?.vendorId).toBe(4447);
    expect(parsed.matter?.productId).toBe(24578);

    // Missing VID/PID flag bit (chunk1 without bit 2 set) must throw
    expect(() => parseSetupCode('22909-31232-9-04447-24578')).toThrow(
      /missing VID\/PID flag bit|check digit/,
    );
  });

  it('parses HomeKit PINs in any grouping and rejects banned weak PINs', () => {
    for (const raw of ['8169 1935', '816-91-935', '81691935']) {
      const parsed = parseSetupCode(raw);
      expect(parsed.kind).toBe('homekit-pin');
      expect(parsed.protocol).toBe('homekit');
      expect(parsed.homekit?.pin).toBe('816-91-935');
    }

    // Banned weak patterns
    expect(() => parseSetupCode('000-00-000')).toThrow(/banned weak PIN pattern/);
    expect(() => parseSetupCode('111-11-111')).toThrow(/banned weak PIN pattern/);
    expect(() => parseSetupCode('123-45-678')).toThrow(/banned weak PIN pattern/);
    expect(() => parseSetupCode('876-54-321')).toThrow(/banned weak PIN pattern/);
    expect(() => validateHomeKitPin('999-99-999')).toThrow(/banned weak PIN pattern/);
  });

  it('parses HomeKit setup URI', () => {
    const parsed = parseSetupCode('X-HM://0054F7G0S1234');
    expect(parsed.kind).toBe('homekit-uri');
    expect(parsed.protocol).toBe('homekit');
    expect(parsed.homekit?.setupId).toBe('1234');
    expect(parsed.homekit?.pin).toBeDefined();
    expect(parsed.homekit?.category).toBeDefined();
  });

  it('handles ambiguous bare numeric passcodes with and without context', () => {
    // 6 digits without context is ambiguous
    expect(() => parseSetupCode('123456')).toThrow(/Ambiguous setup code/);

    // 6 digits with Improv context resolves cleanly
    const improv = parseSetupCode('123456', { contextProtocol: 'improv' });
    expect(improv.kind).toBe('improv');
    expect(improv.protocol).toBe('improv');
    expect(improv.improv?.deviceNameHint).toBe('123456');

    // Mismatched context throws
    expect(() => parseSetupCode('816-91-935', { contextProtocol: 'matter' })).toThrow(
      /Mismatched protocol context/,
    );
  });

  it('routes vendor prefixes to vendor onboarding flow', () => {
    const esphome = parseSetupCode('esphome:kitchen-light');
    expect(esphome.kind).toBe('vendor');
    expect(esphome.protocol).toBe('vendor');
    expect(esphome.vendor?.vendor).toBe('esphome');
    expect(esphome.vendor?.identifier).toBe('kitchen-light');

    const shelly = parseSetupCode('shelly:192.168.1.55');
    expect(shelly.kind).toBe('vendor');
    expect(shelly.vendor?.vendor).toBe('shelly');
    expect(shelly.vendor?.identifier).toBe('192.168.1.55');
  });

  it('redacts sensitive secrets from parsed setup codes', () => {
    const matter = parseSetupCode('MT:Y.K9042C00KA0648G00');
    const redactedMatter = redactSetupCode(matter);
    expect(redactedMatter.raw).toBe('');
    expect(redactedMatter.matter?.raw).toBe('');
    expect(redactedMatter.matter?.passcode).toBe(0);
    expect(redactedMatter.matter?.discriminator).toEqual({ value: 3840, type: 'long' });

    const hk = parseSetupCode('816-91-935');
    const redactedHk = redactSetupCode(hk);
    expect(redactedHk.raw).toBe('');
    expect(redactedHk.homekit?.raw).toBe('');
    expect(redactedHk.homekit?.pin).toBe('***-**-***');
  });

  it('parses improv and rejects garbage', () => {
    expect(parseSetupCode('improv:Lamp').improv?.deviceNameHint).toBe('Lamp');
    expect(() => parseSetupCode('abc')).toThrow();
    expect(() => parseSetupCode('')).toThrow();
  });
});

import {
  BoundedRpcQueue,
  RemoteRadioAgentProxy,
  IMPROV_CHARACTERISTICS,
  IMPROV_SERVICE_DATA_UUID,
  IMPROV_SERVICE_UUID,
  ImprovBlePacketReassembler,
  ImprovCapability,
  ImprovCommand,
  ImprovError,
  ImprovSerialFrameParser,
  ImprovSerialType,
  ImprovState,
  chunkImprovPacket,
  decodeImprovRpcResult,
  decodeImprovSerialPacket,
  encodeImprovDeviceInfoCommand,
  encodeImprovIdentifyCommand,
  encodeImprovSerialPacket,
  encodeImprovWifiCommand,
  encodeImprovWifiScanCommand,
  improvChecksum,
  isLeaseValid,
  parseImprovDeviceInfo,
  parseImprovServiceData,
  parseImprovWifiScan,
  sanitizeRadioRpcError,
  type Advertisement,
  type RadioAgentDescriptor,
  type RadioAgentSessionLease,
  type RadioRpcMessage,
} from '../src/commissioning/index.js';

describe('improv codec & framing', () => {
  it('parses Improv setup codes with serial and BLE transports', () => {
    const ble = parseSetupCode('improv:ble:ESP32-Device');
    expect(ble.protocol).toBe('improv');
    expect(ble.improv?.transport).toBe('ble');
    expect(ble.improv?.deviceNameHint).toBe('ESP32-Device');

    const serial = parseSetupCode('improv:serial:/dev/ttyUSB0');
    expect(serial.protocol).toBe('improv');
    expect(serial.improv?.transport).toBe('serial');
    expect(serial.improv?.serialPort).toBe('/dev/ttyUSB0');
  });

  it('parses Improv service data advertisement and capabilities', () => {
    expect(IMPROV_SERVICE_DATA_UUID).toBe(0x4677);
    expect(IMPROV_SERVICE_UUID).toBe('00467768-6228-2272-4663-277478268000');
    expect(IMPROV_CHARACTERISTICS.currentState).toBe('00467768-6228-2272-4663-277478268001');

    const rawCaps =
      ImprovCapability.identify | ImprovCapability.deviceInfo | ImprovCapability.wifiScan;
    const data = new Uint8Array([ImprovState.authorized, rawCaps, 0x00, 0x00, 0x00, 0x00]);
    const parsed = parseImprovServiceData(data);
    expect(parsed?.state).toBe(ImprovState.authorized);
    expect(parsed?.capabilities.identify).toBe(true);
    expect(parsed?.capabilities.deviceInfo).toBe(true);
    expect(parsed?.capabilities.wifiScan).toBe(true);
    expect(parsed?.capabilities.hostname).toBe(false);
    expect(parseImprovServiceData(new Uint8Array([1]))).toBeUndefined();
  });

  it('encodes Wi-Fi settings with checksum and chunks to 20 bytes', () => {
    const packet = encodeImprovWifiCommand('Home', 'secret-pass-123');
    expect(packet[0]).toBe(ImprovCommand.wifiSettings);
    expect(packet[1]).toBe(2 + 4 + 15);
    const sum = improvChecksum(packet.slice(0, -1));
    expect(packet[packet.length - 1]).toBe(sum);
    const chunks = chunkImprovPacket(packet);
    expect(chunks.every((c) => c.length <= 20)).toBe(true);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(packet.length);

    // Open network (empty password)
    const openPacket = encodeImprovWifiCommand('OpenGuest', '');
    expect(openPacket[1]).toBe(2 + 9 + 0);
  });

  it('encodes identify, device info, and Wi-Fi scan RPC commands', () => {
    const identify = encodeImprovIdentifyCommand();
    expect(identify[0]).toBe(ImprovCommand.identify);
    expect(identify[1]).toBe(0);
    expect(identify[2]).toBe(improvChecksum(identify.slice(0, 2)));

    const devInfo = encodeImprovDeviceInfoCommand();
    expect(devInfo[0]).toBe(ImprovCommand.deviceInfo);

    const scan = encodeImprovWifiScanCommand();
    expect(scan[0]).toBe(ImprovCommand.wifiScan);
  });

  it('decodes RPC results and parses device info and Wi-Fi scan entries', () => {
    const url = new TextEncoder().encode('http://192.168.1.50/');
    const body = new Uint8Array([ImprovCommand.wifiSettings, url.length + 1, url.length, ...url]);
    const packet = new Uint8Array([...body, improvChecksum(body)]);
    const res = decodeImprovRpcResult(packet);
    expect(res?.command).toBe(ImprovCommand.wifiSettings);
    expect(res?.strings).toEqual(['http://192.168.1.50/']);

    // Device info
    const devInfo = parseImprovDeviceInfo([
      'ESPHome',
      '2024.11.0',
      'ESP32-S3',
      'Living Room Sensor',
    ]);
    expect(devInfo?.firmwareName).toBe('ESPHome');
    expect(devInfo?.firmwareVersion).toBe('2024.11.0');
    expect(devInfo?.hardwareVariant).toBe('ESP32-S3');
    expect(devInfo?.deviceName).toBe('Living Room Sensor');

    // Wi-Fi scan results
    const scanEntries = parseImprovWifiScan(['Home-AP', '-45', 'YES', 'Guest-AP', '-80', 'NO']);
    expect(scanEntries).toHaveLength(2);
    expect(scanEntries[0]).toEqual({ ssid: 'Home-AP', rssi: -45, authRequired: true });
    expect(scanEntries[1]).toEqual({ ssid: 'Guest-AP', rssi: -80, authRequired: false });
  });

  it('reassembles chunked Improv BLE packets across frames', () => {
    const reassembler = new ImprovBlePacketReassembler();
    const url = new TextEncoder().encode('http://esphome.local/');
    const body = new Uint8Array([1, url.length + 1, url.length, ...url]);
    const packet = new Uint8Array([...body, improvChecksum(body)]);

    const chunk1 = packet.slice(0, 10);
    const chunk2 = packet.slice(10);

    expect(reassembler.append(chunk1)).toBeUndefined();
    expect(reassembler.bufferedBytes).toBe(10);
    const result = reassembler.append(chunk2);
    expect(result?.strings).toEqual(['http://esphome.local/']);
    expect(reassembler.bufferedBytes).toBe(0);
  });

  it('encodes and decodes Improv Serial framing with noise rejection', () => {
    const payload = new Uint8Array([ImprovError.unableToConnect]);
    const frame = encodeImprovSerialPacket(ImprovSerialType.errorState, payload);
    expect(frame.slice(0, 6)).toEqual(new Uint8Array([0x49, 0x4d, 0x50, 0x52, 0x4f, 0x56])); // IMPROV
    expect(frame[6]).toBe(1); // Version
    expect(frame[7]).toBe(ImprovSerialType.errorState);
    expect(frame[8]).toBe(1); // Data len
    expect(frame[9]).toBe(ImprovError.unableToConnect);

    const decoded = decodeImprovSerialPacket(frame);
    expect(decoded?.type).toBe(ImprovSerialType.errorState);
    expect(decoded?.data).toEqual(payload);

    // Frame parser with garbage noise and back-to-back packets
    const parser = new ImprovSerialFrameParser();
    const frame2 = encodeImprovSerialPacket(
      ImprovSerialType.currentState,
      new Uint8Array([ImprovState.provisioned]),
    );

    const noise = new Uint8Array([0xff, 0x00, 0xaa, 0xbb]);
    const combined = new Uint8Array([...noise, ...frame, ...frame2]);

    const packets = parser.append(combined);
    expect(packets).toHaveLength(2);
    expect(packets[0]?.type).toBe(ImprovSerialType.errorState);
    expect(packets[1]?.type).toBe(ImprovSerialType.currentState);
    expect(packets[1]?.data[0]).toBe(ImprovState.provisioned);
  });
});

describe('radio transport & bounded RPC', () => {
  const lease: RadioAgentSessionLease = {
    leaseId: 'lease-1',
    leaseToken: 'tok-abc-123',
    agentId: 'agent-desktop',
    commissioningId: 'comm-1',
    homeId: 'home-1',
    grantedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    revoked: false,
    permittedTransports: ['ble'],
  };

  const desc: RadioAgentDescriptor = {
    id: 'agent-desktop',
    name: 'Desktop Radio',
    platform: 'macos',
    capabilities: { bleScan: true, bleConnect: true },
    homeId: 'home-1',
    registeredAt: 1000,
    lastSeenAt: 1000,
    status: 'online',
  };

  it('validates transaction-scoped radio agent leases', () => {
    expect(isLeaseValid(lease, 'comm-1', 'home-1', lease.grantedAt + 1000)).toBe(true);
    expect(isLeaseValid(lease, 'comm-wrong', 'home-1', lease.grantedAt + 1000)).toBe(false);
    expect(isLeaseValid(lease, 'comm-1', 'home-wrong', lease.grantedAt + 1000)).toBe(false);
    expect(isLeaseValid(lease, 'comm-1', 'home-1', lease.expiresAt + 1000)).toBe(false); // expired
    expect(
      isLeaseValid({ ...lease, revoked: true }, 'comm-1', 'home-1', lease.grantedAt + 1000),
    ).toBe(false);
  });

  it('sanitizes sensitive data and error codes from RPC errors', () => {
    const errWithPin = new Error('Pairing failed for PIN 816-91-935 and code 12345678');
    const sanitized = sanitizeRadioRpcError(errWithPin);
    expect(sanitized.message).not.toContain('816-91-935');
    expect(sanitized.message).not.toContain('12345678');
    expect(sanitized.message).toContain('[REDACTED_PIN]');

    const errWithSecret = new Error('Authentication rejected: password=SuperSecretPassword123');
    expect(sanitizeRadioRpcError(errWithSecret).message).not.toContain('SuperSecretPassword123');
  });

  it('enforces queue overflow and timeout in BoundedRpcQueue', async () => {
    const queue = new BoundedRpcQueue(2, 50);
    const msg1: RadioRpcMessage = { id: 'm1', type: 'scan.start', timestamp: Date.now() };
    const msg2: RadioRpcMessage = { id: 'm2', type: 'scan.start', timestamp: Date.now() };
    const msg3: RadioRpcMessage = { id: 'm3', type: 'scan.start', timestamp: Date.now() };

    const p1 = queue.request(msg1, () => {}).catch((e: Error) => e);
    const p2 = queue.request(msg2, () => {}).catch((e: Error) => e);
    await expect(queue.request(msg3, () => {})).rejects.toThrow(/queue_overflow/);

    const [err1, err2] = await Promise.all([p1, p2]);
    expect(err1).toBeInstanceOf(Error);
    expect((err1 as Error).message).toBe('rpc_timeout');
    expect(err2).toBeInstanceOf(Error);
  });

  it('RemoteRadioAgentProxy executes scan, closes scan on loop exit, and connects GATT', async () => {
    const sent: RadioRpcMessage[] = [];
    let proxy: RemoteRadioAgentProxy;

    proxy = new RemoteRadioAgentProxy(
      desc,
      (msg) => {
        sent.push(msg);
        if (msg.type === 'scan.start') {
          setTimeout(() => {
            proxy.handleIncomingRpc({
              id: 'resp-1',
              corrId: msg.id,
              type: 'scan.start',
              timestamp: Date.now(),
            });
            const adv: Advertisement = {
              agentId: 'agent-desktop',
              transport: 'ble',
              protocol: 'improv',
              identifier: 'AA:BB:CC:DD',
              name: 'Living Room Sensor',
            };
            proxy.handleIncomingRpc({
              id: 'adv-1',
              type: 'scan.adv',
              timestamp: Date.now(),
              payload: adv,
            });
          }, 10);
        } else if (msg.type === 'conn.open') {
          setTimeout(() => {
            proxy.handleIncomingRpc({
              id: 'ack-conn',
              corrId: msg.id,
              type: 'conn.ack',
              timestamp: Date.now(),
            });
          }, 10);
        } else if (msg.type === 'gatt.write') {
          setTimeout(() => {
            proxy.handleIncomingRpc({
              id: 'ack-write',
              corrId: msg.id,
              type: 'gatt.write.ack',
              timestamp: Date.now(),
            });
          }, 10);
        }
      },
      { lease },
    );

    // Scan
    const advs: Advertisement[] = [];
    for await (const adv of proxy.scan({
      commissioningId: 'comm-1',
      kind: 'improv',
      timeoutMs: 500,
    })) {
      advs.push(adv);
      break; // break early to verify scan.stop is sent
    }
    expect(advs).toHaveLength(1);
    expect(advs[0]?.name).toBe('Living Room Sensor');
    expect(sent.some((m) => m.type === 'scan.stop')).toBe(true);

    // Connect & write GATT
    const conn = await proxy.connect({
      agentId: 'agent-desktop',
      identifier: 'AA:BB:CC:DD',
      transport: 'ble',
    });
    await conn.writeCharacteristic('00467768', '00467768-1', new Uint8Array([1, 2, 3]));
    expect(sent.some((m) => m.type === 'gatt.write')).toBe(true);
    await conn.close();
    expect(sent.some((m) => m.type === 'conn.close')).toBe(true);
  });

  it('rejects expired or revoked agents', async () => {
    const expiredLease: RadioAgentSessionLease = { ...lease, expiresAt: Date.now() - 1000 };
    const proxy = new RemoteRadioAgentProxy(desc, () => {}, { lease: expiredLease });
    await expect(async () => {
      for await (const _ of proxy.scan({
        commissioningId: 'comm-1',
        kind: 'improv',
        timeoutMs: 100,
      })) {
      }
    }).rejects.toThrow(/agent_lease_expired/);
  });
});
