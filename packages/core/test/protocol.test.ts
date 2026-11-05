/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  type HausDevice,
  InMemoryHardwareKeychain,
  InMemoryRadioNvramRepository,
  OtaTransferSession,
  ProtocolDeviceAdapter,
  SerialExclusivityError,
  SerialPortGuard,
  ZeroTrustApprovalManager,
  createNvramBackup,
  decodeBleAdvertisementPayload,
  encodeBleAdvertisementPayload,
  evaluateClockSkew,
  generateBackupCodes,
  isNetworkSerialAddress,
  isPrimaryPhysicalInterface,
  parseClientTimeHeader,
  parseSerialAddress,
  sha256,
  verifyAndConsumeBackupCode,
  verifyNvramChecksum,
} from '../src/index.js';

class MockAdapter extends ProtocolDeviceAdapter<{ port: string }> {
  public readonly protocol = 'zigbee' as const;

  public async start(): Promise<void> {
    this._state = 'running';
  }

  public async stop(): Promise<void> {
    this._state = 'stopped';
  }

  public async discoverDevices(): Promise<HausDevice[]> {
    return this.getKnownDevices();
  }

  public async pairDevice(): Promise<HausDevice> {
    throw new Error('Not implemented');
  }

  public async unpairDevice(deviceId: string): Promise<void> {
    this.emitRemoved(deviceId);
  }

  public async executeCommand(): Promise<boolean> {
    return true;
  }

  public simulateDevice(device: HausDevice): void {
    this.emitDiscovered(device);
  }

  public simulateState(deviceId: string, endpointId: string, state: Record<string, unknown>): void {
    this.emitStateChanged(deviceId, endpointId, state);
  }

  public simulateAvailability(deviceId: string, available: boolean): void {
    this.emitAvailabilityChanged(deviceId, available);
  }
}

describe('ProtocolDeviceAdapter and Hub Native Contracts', () => {
  it('manages adapter lifecycle and device registry events', async () => {
    const adapter = new MockAdapter(
      { homeId: 'home-1', hubId: 'hub-alpha', exclusiveResources: ['dongle-zigbee-1'] },
      { port: '/dev/ttyUSB0' },
    );

    expect(adapter.state).toBe('uninitialized');
    await adapter.start();
    expect(adapter.state).toBe('running');

    // Test exclusive owner check
    expect(() => adapter.assertExclusiveOwner('dongle-zigbee-1')).not.toThrow();
    expect(() => adapter.assertExclusiveOwner('dongle-matter-2')).toThrow(
      /Exclusive ownership violation/,
    );

    const testDevice: HausDevice = {
      id: 'dev-1',
      source: { instanceId: 'zigbee-inst', externalId: '0x00158d0001' },
      name: 'Living Room Switch',
      category: 'power',
      connectivity: { protocol: 'zigbee' },
      availability: 'online',
      endpoints: [],
    };

    let discoveredEvent: unknown;
    adapter.on('discovered', (e) => {
      discoveredEvent = e;
    });

    adapter.simulateDevice(testDevice);
    expect(adapter.getDevice('dev-1')).toEqual(testDevice);
    expect(discoveredEvent).toEqual({ protocol: 'zigbee', device: testDevice });

    let stateEvent: unknown;
    adapter.on('state_changed', (e) => {
      stateEvent = e;
    });
    adapter.simulateState('dev-1', 'ep-1', { on: true });
    expect(stateEvent).toMatchObject({
      protocol: 'zigbee',
      deviceId: 'dev-1',
      endpointId: 'ep-1',
      state: { on: true },
    });

    adapter.simulateAvailability('dev-1', false);
    expect(adapter.getDevice('dev-1')?.availability).toBe('offline');

    await adapter.unpairDevice('dev-1');
    expect(adapter.getDevice('dev-1')).toBeUndefined();

    await adapter.stop();
    expect(adapter.state).toBe('stopped');
  });

  it('enforces serial port exclusivity and parses network serial endpoints', () => {
    SerialPortGuard.clearAll();

    expect(isNetworkSerialAddress('tcp://192.168.1.50:8888')).toBe(true);
    expect(isNetworkSerialAddress('/dev/ttyUSB0')).toBe(false);

    const tcpParsed = parseSerialAddress('tcp://192.168.1.50:8888');
    expect(tcpParsed).toEqual({
      type: 'tcp',
      raw: 'tcp://192.168.1.50:8888',
      host: '192.168.1.50',
      port: 8888,
    });

    const serialParsed = parseSerialAddress('/dev/ttyUSB0');
    expect(serialParsed).toEqual({
      type: 'serial',
      raw: '/dev/ttyUSB0',
      path: '/dev/ttyUSB0',
    });

    SerialPortGuard.acquire('/dev/ttyUSB0', 'coordinator-1');
    expect(SerialPortGuard.isLocked('/dev/ttyUSB0')).toBe(true);
    expect(SerialPortGuard.getLockOwner('/dev/ttyUSB0')).toBe('coordinator-1');

    // Acquiring with the same owner succeeds (idempotent)
    expect(() => SerialPortGuard.acquire('/dev/ttyUSB0', 'coordinator-1')).not.toThrow();

    // Acquiring with a competing owner throws SerialExclusivityError
    expect(() => SerialPortGuard.acquire('/dev/ttyUSB0', 'coordinator-2')).toThrow(
      SerialExclusivityError,
    );

    // Release port
    expect(SerialPortGuard.release('/dev/ttyUSB0', 'coordinator-2')).toBe(false);
    expect(SerialPortGuard.release('/dev/ttyUSB0', 'coordinator-1')).toBe(true);
    expect(SerialPortGuard.isLocked('/dev/ttyUSB0')).toBe(false);
  });

  it('backs up and verifies radio NVRAM network keys and topology', async () => {
    const repo = new InMemoryRadioNvramRepository();

    const backup = createNvramBackup({
      protocol: 'zigbee',
      coordinatorIeee: '00:12:4b:00:1c:aa:bb:cc',
      panId: '0x1a2b',
      extendedPanId: '0xdddddddddddddddd',
      channel: 25,
      networkKey: '01030507090b0d0f00020406080a0c0d',
      networkUpdateId: 1,
      timestamp: Date.now(),
    });

    expect(verifyNvramChecksum(backup)).toBe(true);
    await repo.saveBackup(backup);

    const latest = await repo.getLatestBackup('zigbee');
    expect(latest).toEqual(backup);

    // Tampered backup check
    const tampered = { ...backup, channel: 11 };
    expect(verifyNvramChecksum(tampered)).toBe(false);
    await expect(repo.saveBackup(tampered)).rejects.toThrow(/checksum verification failed/);
  });

  it('handles OTA chunked firmware transfers and checksum verification', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const sha = sha256(payload);

    const session = new OtaTransferSession(
      'dev-zigbee-light',
      {
        manufacturerCode: 0x100b,
        imageType: 0x0100,
        fileVersion: 2,
        totalSize: payload.length,
        sha256: sha,
        data: payload,
      },
      { chunkSize: 4 },
    );

    expect(session.state).toBe('idle');
    session.start();
    expect(session.state).toBe('transferring');

    const chunk1 = session.getNextChunk();
    expect(chunk1).toEqual({ offset: 0, size: 4, data: new Uint8Array([1, 2, 3, 4]) });
    session.acknowledgeChunk(0, 4);
    expect(session.progressPercentage).toBe(40);

    const chunk2 = session.getNextChunk();
    expect(chunk2).toEqual({ offset: 4, size: 4, data: new Uint8Array([5, 6, 7, 8]) });
    session.acknowledgeChunk(4, 4);
    expect(session.progressPercentage).toBe(80);

    const chunk3 = session.getNextChunk();
    expect(chunk3).toEqual({ offset: 8, size: 2, data: new Uint8Array([9, 10]) });
    session.acknowledgeChunk(8, 2);
    expect(session.progressPercentage).toBe(100);

    expect(session.getNextChunk()).toBeNull();
    expect(session.verifyIntegrity()).toBe(true);
    expect(session.state).toBe('completed');
  });

  it('manages hardware-backed keychain port', async () => {
    const keychain = new InMemoryHardwareKeychain();

    await keychain.setSecret('haus:token:hub-1', 'secret-val-123');
    expect(await keychain.hasSecret('haus:token:hub-1')).toBe(true);
    expect(await keychain.getSecret('haus:token:hub-1')).toBe('secret-val-123');
    expect(await keychain.listKeys()).toContain('haus:token:hub-1');

    await keychain.deleteSecret('haus:token:hub-1');
    expect(await keychain.hasSecret('haus:token:hub-1')).toBe(false);
    expect(await keychain.getSecret('haus:token:hub-1')).toBeNull();
  });

  it('handles Zero-Trust local authorization prompts and single-use backup codes', () => {
    const manager = new ZeroTrustApprovalManager({ defaultTtlMs: 60000 });

    const req = manager.createRequest({
      hubId: 'hub-local',
      clientName: 'MacBook Pro',
      clientIp: '192.168.1.120',
      deviceType: 'desktop',
    });

    expect(req.status).toBe('pending');
    expect(req.verificationCode).toMatch(/^\d{4}$/);
    expect(manager.isPending(req.id)).toBe(true);

    // Wrong code rejection
    expect(manager.approveRequest(req.id, '0000')).toBe(false);
    expect(manager.isPending(req.id)).toBe(true);

    // Correct code approval
    expect(manager.approveRequest(req.id, req.verificationCode)).toBe(true);
    expect(manager.getRequest(req.id)?.status).toBe('approved');
    expect(manager.isPending(req.id)).toBe(false);

    // Backup codes test
    const codes = generateBackupCodes(4);
    expect(codes).toHaveLength(4);
    expect(codes[0]).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const hashes = codes.map((c) => sha256(c.replace(/[^A-Za-z0-9]/g, '')));
    const consumption = verifyAndConsumeBackupCode(codes[0], hashes);
    expect(consumption.valid).toBe(true);
    expect(consumption.remainingHashes).toHaveLength(3);

    // Replay of consumed code fails
    const secondTry = verifyAndConsumeBackupCode(codes[0], consumption.remainingHashes);
    expect(secondTry.valid).toBe(false);
  });

  it('pins primary physical network interface and rejects virtual/docker interfaces', () => {
    expect(
      isPrimaryPhysicalInterface({
        name: 'docker0',
        internal: false,
        address: '172.17.0.1',
        family: 'IPv4',
      }),
    ).toBe(false);

    expect(
      isPrimaryPhysicalInterface({
        name: 'br-3e4a2c1f9b0a',
        internal: false,
        address: '172.18.0.1',
        family: 'IPv4',
      }),
    ).toBe(false);

    expect(
      isPrimaryPhysicalInterface({
        name: 'veth1a2b3c',
        internal: false,
        address: '10.0.0.5',
        family: 'IPv4',
      }),
    ).toBe(false);

    expect(
      isPrimaryPhysicalInterface({
        name: 'lo',
        internal: true,
        address: '127.0.0.1',
        family: 'IPv4',
      }),
    ).toBe(false);

    expect(
      isPrimaryPhysicalInterface({
        name: 'eth0',
        internal: false,
        address: '192.168.1.100',
        family: 'IPv4',
      }),
    ).toBe(true);

    expect(
      isPrimaryPhysicalInterface({
        name: 'en0',
        internal: false,
        address: '192.168.4.55',
        family: 'IPv4',
      }),
    ).toBe(true);
  });

  it('encodes and decodes BLE advertisement payloads', () => {
    const payload = encodeBleAdvertisementPayload('hub-living-room', 'home-myhome', 8099);
    const decoded = decodeBleAdvertisementPayload(payload);
    expect(decoded).toEqual({
      hubId: 'hub-living-room',
      homeId: 'home-myhome',
      port: 8099,
    });
  });

  it('detects cold-start 1970 clock and severe clock skew via header', () => {
    // Normal case
    const now = Date.now();
    const normal = evaluateClockSkew(now, now + 100);
    expect(normal.needsSync).toBe(false);
    expect(normal.safeForTls).toBe(true);

    // Host cold start at epoch 1970 (1000000 ms)
    const coldStart = evaluateClockSkew(now, 1000000);
    expect(coldStart.needsSync).toBe(true);
    expect(coldStart.safeForTls).toBe(false);

    // Header parser
    expect(parseClientTimeHeader(now.toString())).toBe(now);
    expect(parseClientTimeHeader('invalid')).toBeNull();
  });
});
