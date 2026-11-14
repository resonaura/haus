/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactoryProvider } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import type { StandaloneHomeService } from '../../src/home/home.service.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { ManagementController } from '../../src/commissioning/management.controller.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { encodeDnsName, MdnsDiscoveryAssembler } from '../../src/commissioning/lan/dns.js';
import {
  buildDhcpNeighborAdvertisement,
  parseMacArpOutput,
  parseProcNetArp,
  parseWindowsArpOutput,
} from '../../src/commissioning/lan/neighbors.js';
import {
  LanDiscoveryService,
  parseProcNetRouteDefaultGateway,
} from '../../src/commissioning/lan/scanner.js';
import {
  buildSsdpAdvertisement,
  isPrivateLanHttpUrl,
  parseSsdpHeaders,
  parseUpnpDeviceXml,
} from '../../src/commissioning/lan/ssdp.js';
import type { HubIntegrationEntryService } from '../../src/commissioning/entries.js';

function createMemoryPersistence() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    async save<T>(kind: string, entryId: string, value: T): Promise<void> {
      let bucket = store.get(kind);
      if (!bucket) {
        bucket = new Map();
        store.set(kind, bucket);
      }
      bucket.set(entryId, value);
    },
    async remove(kind: string, entryId: string): Promise<void> {
      store.get(kind)?.delete(entryId);
    },
    async listByKind<T>(kind: string): Promise<Array<{ entryId: string; value: T }>> {
      const bucket = store.get(kind);
      if (!bucket) return [];
      return Array.from(bucket.entries()).map(([entryId, value]) => ({
        entryId,
        value: value as T,
      }));
    },
  };
}

function buildDnsResponsePacket(opts: {
  serviceType: string;
  instanceName: string;
  hostTarget: string;
  port: number;
  ip: string;
  txt: Record<string, string>;
}): Buffer {
  const fqdn = `${opts.instanceName}.${opts.serviceType.replace(/\.$/, '')}`;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // Response + AA
  header.writeUInt16BE(4, 6); // ANCOUNT = 4 (PTR, SRV, TXT, A)

  const rr = (name: string, type: number, rdata: Buffer): Buffer => {
    const tail = Buffer.alloc(10);
    tail.writeUInt16BE(type, 0);
    tail.writeUInt16BE(1, 2); // IN
    tail.writeUInt32BE(120, 4);
    tail.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([encodeDnsName(name), tail, rdata]);
  };

  const ptrRdata = encodeDnsName(fqdn);
  const srvHead = Buffer.alloc(6);
  srvHead.writeUInt16BE(0, 0);
  srvHead.writeUInt16BE(0, 2);
  srvHead.writeUInt16BE(opts.port, 4);
  const srvRdata = Buffer.concat([srvHead, encodeDnsName(opts.hostTarget)]);

  const txtParts = Object.entries(opts.txt).map(([k, v]) => {
    const raw = Buffer.from(`${k}=${v}`, 'utf8');
    return Buffer.concat([Buffer.from([raw.length]), raw]);
  });
  const txtRdata = Buffer.concat(txtParts);

  const aRdata = Buffer.from(opts.ip.split('.').map((n) => Number.parseInt(n, 10)));

  return Buffer.concat([
    header,
    rr(opts.serviceType, 12, ptrRdata),
    rr(fqdn, 33, srvRdata),
    rr(fqdn, 16, txtRdata),
    rr(opts.hostTarget, 1, aRdata),
  ]);
}

describe('Hub Auto-Discovery Engine (mDNS, SSDP, MQTT, ARP & Persistence)', () => {
  it('assembles real mDNS packets and matches HA catalog rules while filtering non-smart-home noise', () => {
    const mockHomekit = {
      discoverAccessories: async () => [],
      listPairings: () => [],
    } as unknown as HomeKitControllerService;
    const commissioning = new CommissioningService(mockHomekit);
    const scanner = new LanDiscoveryService(commissioning);

    const esphomePkt = buildDnsResponsePacket({
      serviceType: '_esphomelib._tcp.local.',
      instanceName: 'kitchen-sensor',
      hostTarget: 'kitchen-sensor.local',
      port: 6053,
      ip: '192.168.5.77',
      txt: { mac: 'aabbcc112233', platform: 'esp32', version: '2026.1.0' },
    });
    const esphomeHits = scanner.handleMdnsDatagram(esphomePkt, '192.168.5.77');
    expect(esphomeHits).toHaveLength(1);
    expect(esphomeHits[0].domain).toBe('esphome');
    expect(esphomeHits[0].addresses).toContain('192.168.5.77');

    // Paired Hue Bridge via HAP md=BSB002 must classify as hue (not homekit fallback!)
    const hueHapPkt = buildDnsResponsePacket({
      serviceType: '_hap._tcp.local.',
      instanceName: 'Philips hue - ABC123',
      hostTarget: 'philips-hue.local',
      port: 80,
      ip: '192.168.5.88',
      txt: { sf: '0', md: 'BSB002', id: '00:17:88:aa:bb:cc' },
    });
    const hueHits = scanner.handleMdnsDatagram(hueHapPkt, '192.168.5.88');
    expect(hueHits).toHaveLength(1);
    expect(hueHits[0].domain).toBe('hue');

    // Unrelated SSH workstation advertisement must NOT pollute discovery candidates
    const sshPkt = buildDnsResponsePacket({
      serviceType: '_ssh._tcp.local.',
      instanceName: 'dev-laptop',
      hostTarget: 'dev-laptop.local',
      port: 22,
      ip: '192.168.5.10',
      txt: {},
    });
    expect(scanner.handleMdnsDatagram(sshPkt, '192.168.5.10')).toHaveLength(0);
    expect(commissioning.listDiscoveries({ status: 'discovered' })).toHaveLength(2);
  });

  it('guards SSDP LOCATION fetches against SSRF and prefers specific vendor matches over generic DLNA', () => {
    expect(isPrivateLanHttpUrl('http://127.0.0.1:8080/desc.xml')).toBeNull();
    expect(isPrivateLanHttpUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
    expect(isPrivateLanHttpUrl('https://192.168.5.10/desc.xml')).toBeNull();
    expect(isPrivateLanHttpUrl('http://8.8.8.8/desc.xml')).toBeNull();
    expect(isPrivateLanHttpUrl('http://192.168.5.40:1400/xml/device_description.xml')?.host).toBe(
      '192.168.5.40',
    );

    const rawSsdp = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'LOCATION: http://192.168.5.42:8080/description.xml',
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1',
      'USN: uuid:550e8400-e29b-41d4-a716-446655440000::urn:schemas-upnp-org:device:MediaRenderer:1',
      '',
      '',
    ].join('\r\n');
    const headers = parseSsdpHeaders(rawSsdp);
    expect(headers).not.toBeNull();

    const xml = `
      <root>
        <device>
          <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
          <friendlyName>Living Room AVR</friendlyName>
          <manufacturer>Denon</manufacturer>
          <modelName>AVR-X3800H</modelName>
          <UDN>uuid:550e8400-e29b-41d4-a716-446655440000</UDN>
        </device>
      </root>
    `;
    const desc = parseUpnpDeviceXml(xml);
    expect(desc.manufacturer).toBe('Denon');

    const adv = buildSsdpAdvertisement(headers!, '192.168.5.42', desc);
    expect(adv).not.toBeNull();

    const mockHomekit = {
      discoverAccessories: async () => [],
      listPairings: () => [],
    } as unknown as HomeKitControllerService;
    const commissioning = new CommissioningService(mockHomekit);
    const scanner = new LanDiscoveryService(commissioning);
    const candidate = scanner.ingestIfMatched(adv!);
    expect(candidate?.domain).toBe('denonavr');
    expect(candidate?.name).toBe('Living Room AVR');
  });

  it('ingests MQTT discovery topics, ARP neighbor hints, and tracks persisted ignores/configured entries', async () => {
    const persistence = createMemoryPersistence();
    let entries: Array<{
      entry_id: string;
      domain: string;
      state: 'loaded';
      disabled_by: null;
      data: Record<string, unknown>;
    }> = [];

    const mockHomekit = {
      discoverAccessories: async () => [],
      listPairings: () => [],
    } as unknown as HomeKitControllerService;
    const mockEntries = {
      listEntries: async () => entries,
      registerDynamicDomains: () => undefined,
    } as unknown as HubIntegrationEntryService;
    const mockHome = {
      getPersistence: () => persistence,
    } as unknown as StandaloneHomeService;

    const commissioning = new CommissioningService(
      mockHomekit,
      undefined,
      undefined,
      mockEntries,
      mockHome,
    );
    const scanner = new LanDiscoveryService(commissioning);

    // 1. MQTT discovery for Tasmota
    const tasmota = scanner.handleMqttMessage(
      'tasmota/discovery/AABBCC112244/config',
      JSON.stringify({ ip: '192.168.5.90', dn: 'Hallway Plug', mac: 'AA:BB:CC:11:22:44' }),
    );
    expect(tasmota?.domain).toBe('tasmota');
    expect(tasmota?.name).toBe('Hallway Plug');

    // 2. ARP neighbor parsing skips 0x0 and locally-administered randomized MACs
    const arpRaw = [
      'IP address       HW type     Flags       HW address            Mask     Device',
      '192.168.5.120    0x1         0x2         00:40:8c:11:22:33     *        eth0',
      '192.168.5.121    0x1         0x2         02:42:ac:11:00:02     *        docker0',
      '192.168.5.122    0x1         0x0         00:00:00:00:00:00     *        eth0',
    ].join('\n');
    const arpEntries = parseProcNetArp(arpRaw);
    expect(arpEntries).toEqual([
      { ip: '192.168.5.120', mac: '00:40:8c:11:22:33', interfaceName: 'eth0' },
    ]);
    const assembler = new MdnsDiscoveryAssembler();
    expect(assembler.getHostAddresses('unknown.local')).toEqual([]);

    const dhcpAdv = buildDhcpNeighborAdvertisement(arpEntries[0], 'axis-00408c112233.local');
    const axisCandidate = scanner.ingestIfMatched(dhcpAdv);
    expect(axisCandidate?.domain).toBe('axis');

    // 3. Reconcile configured entries marks candidate configured, and restores unconfigured when entry removed
    entries = [
      {
        entry_id: 'entry_axis_1',
        domain: 'axis',
        state: 'loaded',
        disabled_by: null,
        data: { host: '192.168.5.120' },
      },
    ];
    await commissioning.reconcileConfigured();
    expect(commissioning.getDiscovery(axisCandidate!.id)?.status).toBe('configured');

    entries = [];
    await commissioning.reconcileConfigured();
    expect(commissioning.getDiscovery(axisCandidate!.id)?.status).toBe('discovered');

    // 4. Ignore persists across CommissioningService restart
    expect(commissioning.ignoreDiscovery(tasmota!.id)).toBe(true);
    const commissioning2 = new CommissioningService(
      mockHomekit,
      undefined,
      undefined,
      mockEntries,
      mockHome,
    );
    await commissioning2.restorePersistedDiscoveryState();
    const reDiscovered = new LanDiscoveryService(commissioning2).handleMqttMessage(
      'tasmota/discovery/AABBCC112244/config',
      JSON.stringify({ ip: '192.168.5.90', dn: 'Hallway Plug', mac: 'AA:BB:CC:11:22:44' }),
    );
    expect(reDiscovered?.status).toBe('ignored');
  });

  it('parses Windows/macOS ARP tables and WSL /proc/net/route default gateway accurately', () => {
    const winRaw = [
      '',
      'Interface: 192.168.5.115 --- 0x6',
      '  Internet Address      Physical Address      Type',
      '  192.168.5.1           a4-2b-8c-11-22-33     dynamic',
      '  192.168.5.44          00-17-88-aa-bb-cc     dynamic',
      '  192.168.5.255         ff-ff-ff-ff-ff-ff     static',
      '  224.0.0.251           01-00-5e-00-00-fb     static',
      '',
      'Interface: 172.23.64.1 --- 0x1e',
      '  172.23.68.150         00-15-5d-01-02-03     dynamic',
    ].join('\r\n');
    expect(parseWindowsArpOutput(winRaw)).toEqual([
      { ip: '192.168.5.1', mac: 'a4:2b:8c:11:22:33', interfaceName: 'eth-192.168.5.115' },
      { ip: '192.168.5.44', mac: '00:17:88:aa:bb:cc', interfaceName: 'eth-192.168.5.115' },
      { ip: '172.23.68.150', mac: '00:15:5d:01:02:03', interfaceName: 'eth-172.23.64.1' },
    ]);

    const macRaw = [
      '? (192.168.5.50) at 0:17:88:a:b:c on en0 ifscope [ethernet]',
      '? (192.168.5.99) at (incomplete) on en0 ifscope [ethernet]',
      '? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]',
    ].join('\n');
    expect(parseMacArpOutput(macRaw)).toEqual([
      { ip: '192.168.5.50', mac: '00:17:88:0a:0b:0c', interfaceName: 'en0' },
    ]);

    const wslRoute = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      'eth0\t00000000\t014017AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
      'eth0\t004017AC\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0',
    ].join('\n');
    expect(parseProcNetRouteDefaultGateway(wslRoute)).toBe('172.23.64.1');
  });

  it('merges authenticated host relay /scan advertisements and ingests controller batches + HAUS_API_TOKEN_FILE', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'haus-relay-test-'));
    const tokenPath = join(tempDir, 'relay.token');
    writeFileSync(tokenPath, 'super-secret-relay-token\n', 'utf8');

    let seenAuthHeader: string | undefined;
    let seenServiceTypes: unknown;
    const relayServer = createServer((req, res) => {
      seenAuthHeader = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          serviceTypes?: unknown;
        };
        seenServiceTypes = parsed.serviceTypes;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            advertisements: [
              {
                protocol: 'zeroconf',
                name: 'Hue Bridge Office',
                host: '192.168.5.44',
                addresses: ['192.168.5.44'],
                port: 80,
                mac: '00:17:88:aa:bb:cc',
                details: {
                  serviceType: '_hap._tcp.local.',
                  md: 'BSB002',
                  sf: '0',
                  id: '00:17:88:aa:bb:cc',
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => relayServer.listen(0, '127.0.0.1', () => resolve()));
    const address = relayServer.address();
    const relayPort = typeof address === 'object' && address ? address.port : 0;

    const prevRelayUrl = process.env.HAUS_LAN_RELAY_URL;
    const prevRelayTokenFile = process.env.HAUS_LAN_RELAY_TOKEN_FILE;
    const prevApiTokenFile = process.env.HAUS_API_TOKEN_FILE;
    const prevDisableLan = process.env.HAUS_DISABLE_LAN_DISCOVERY;
    process.env.HAUS_LAN_RELAY_URL = `http://127.0.0.1:${relayPort}`;
    process.env.HAUS_LAN_RELAY_TOKEN_FILE = tokenPath;
    process.env.HAUS_API_TOKEN_FILE = tokenPath;
    process.env.HAUS_DISABLE_LAN_DISCOVERY = 'true';

    try {
      const mockHomekit = {
        discoverAccessories: async () => [],
        listPairings: () => [],
      } as unknown as HomeKitControllerService;
      const commissioning = new CommissioningService(mockHomekit);
      const scanner = new LanDiscoveryService(commissioning);
      try {
        const results = await scanner.scan({ timeoutMs: 350 });
        expect(seenAuthHeader).toBe('Bearer super-secret-relay-token');
        expect(Array.isArray(seenServiceTypes)).toBe(true);
        expect(results.some((c) => c.domain === 'hue' && c.addresses.includes('192.168.5.44'))).toBe(
          true,
        );
      } finally {
        await scanner.onApplicationShutdown();
      }

      const controller = new ManagementController(
        commissioning,
        null as never,
        null as never,
        null as never,
        scanner,
      );
      const st = controller.listDiscoveryServiceTypes();
      expect(st.serviceTypes).toContain('_esphomelib._tcp.local.');

      const batchRes = await controller.ingestAnnouncementBatch({
        advertisements: [
          {
            protocol: 'zeroconf',
            name: 'Living Room ESP',
            host: '192.168.5.79',
            addresses: ['192.168.5.79'],
            port: 6053,
            details: { serviceType: '_esphomelib._tcp.local.', mac: '112233445566' },
          },
          {
            protocol: 'zeroconf',
            name: 'dev-workstation',
            host: '192.168.5.95',
            port: 22,
            details: { serviceType: '_ssh._tcp.local.' },
          },
        ],
      });
      expect(batchRes.received).toBe(2);
      expect(batchRes.matched).toBe(1);
      expect(batchRes.candidates).toHaveLength(1);
      expect(batchRes.candidates[0]?.domain).toBe('esphome');

      const authMod = AuthModule.forRoot();
      const authProvider = authMod.providers?.find(
        (p): p is FactoryProvider<HubAuthService> =>
          typeof p === 'object' &&
          p !== null &&
          'provide' in p &&
          p.provide === HUB_AUTH_SERVICE &&
          'useFactory' in p,
      );
      const authService = await authProvider?.useFactory();
      const verifiedSession = authService?.verifyToken('super-secret-relay-token');
      expect(verifiedSession?.clientId).toBe('configured-api-client');
      expect(authService?.hasAdminSessions()).toBe(false);

      // Sleep proxy / mDNS reflector senderAddress must not pollute real A-record IP,
      // and repeated mDNS announcements without port must deduplicate deterministically.
      const sleepProxyPacket = buildDnsResponsePacket({
        serviceType: '_hap._tcp.local.',
        instanceName: 'Homebridge Bridge',
        hostTarget: 'homebridge.local',
        port: 51217,
        ip: '192.168.4.44',
        txt: { sf: '1', id: '0E:45:BC:77:E6:27', md: 'Homebridge' },
      });
      const proxyIngested = scanner.handleMdnsDatagram(sleepProxyPacket, '192.168.5.218');
      expect(proxyIngested).toHaveLength(1);
      expect(proxyIngested[0]?.addresses).toEqual(['192.168.4.44']);
    } finally {
      if (prevRelayUrl === undefined) delete process.env.HAUS_LAN_RELAY_URL;
      else process.env.HAUS_LAN_RELAY_URL = prevRelayUrl;
      if (prevRelayTokenFile === undefined) delete process.env.HAUS_LAN_RELAY_TOKEN_FILE;
      else process.env.HAUS_LAN_RELAY_TOKEN_FILE = prevRelayTokenFile;
      if (prevApiTokenFile === undefined) delete process.env.HAUS_API_TOKEN_FILE;
      else process.env.HAUS_API_TOKEN_FILE = prevApiTokenFile;
      if (prevDisableLan === undefined) delete process.env.HAUS_DISABLE_LAN_DISCOVERY;
      else process.env.HAUS_DISABLE_LAN_DISCOVERY = prevDisableLan;
      await new Promise<void>((resolve) => relayServer.close(() => resolve()));
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
