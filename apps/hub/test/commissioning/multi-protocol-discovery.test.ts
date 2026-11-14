/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HomeKitControllerService } from '../../src/homekit/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import { ManagementController } from '../../src/commissioning/management.controller.js';
import { HubIntegrationEntryService } from '../../src/commissioning/entries.js';
import { HubRepairsService } from '../../src/commissioning/repairs.js';
import { HubUpdatesService } from '../../src/commissioning/updates.js';
import { LanDiscoveryService } from '../../src/commissioning/lan/scanner.js';
import { LanProtocolProbe, resolveReverseDnsHostname } from '../../src/commissioning/lan/probe.js';
import {
  buildSsdpAdvertisement,
  parseSsdpHeaders,
  parseUpnpDeviceXml,
} from '../../src/commissioning/lan/ssdp.js';
import {
  buildUsbAdvertisement,
  parseLinuxSysfsUsbDevice,
  parseMacIoregUsbOutput,
  scanLinuxSysfsUsb,
} from '../../src/commissioning/lan/usb.js';

const mockHomekit = {
  discoverAccessories: async () => [],
} as unknown as HomeKitControllerService;

describe('Hub Multi-Protocol Discovery (USB, SSDP, DHCP, BLE)', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('parses Linux sysfs and macOS ioreg USB descriptors into HA catalog-compatible advertisements', async () => {
    // Linux sysfs parsing: normalizes hex, extracts tty path, skips Linux root hub
    expect(
      parseLinuxSysfsUsbDevice({
        idVendor: '1d6b',
        idProduct: '0002',
        manufacturer: 'Linux 6.1.0 xhci-hcd',
        product: 'xHCI Host Controller',
      }),
    ).toBeNull();

    const parsed = parseLinuxSysfsUsbDevice({
      idVendor: '10c4',
      idProduct: 'ea60',
      serial: 'ABC123456',
      manufacturer: 'Nabu Casa',
      product: 'SkyConnect v1.0',
      devicePath: '/dev/ttyUSB0',
    });
    expect(parsed).toEqual({
      device: '/dev/ttyUSB0',
      vid: '10C4',
      pid: 'EA60',
      serialNumber: 'ABC123456',
      manufacturer: 'Nabu Casa',
      description: 'SkyConnect v1.0',
    });

    // Directory scan on synthetic sysfs tree
    tempDir = mkdtempSync(join(tmpdir(), 'haus-usb-sysfs-'));
    const devDir = join(tempDir, '1-1');
    mkdirSync(join(devDir, '1-1:1.0', 'tty', 'ttyACM0'), { recursive: true });
    writeFileSync(join(devDir, 'idVendor'), '10c4\n');
    writeFileSync(join(devDir, 'idProduct'), 'ea60\n');
    writeFileSync(join(devDir, 'serial'), 'SKY-001\n');
    writeFileSync(join(devDir, 'manufacturer'), 'Nabu Casa\n');
    writeFileSync(join(devDir, 'product'), 'Home Assistant Connect ZBT-1\n');

    const rootDir = join(tempDir, 'usb1');
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(join(rootDir, 'idVendor'), '1d6b\n');
    writeFileSync(join(rootDir, 'idProduct'), '0002\n');

    const scanned = await scanLinuxSysfsUsb(tempDir);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toMatchObject({
      device: '/dev/ttyACM0',
      vid: '10C4',
      pid: 'EA60',
      serialNumber: 'SKY-001',
    });

    // macOS ioreg output with both hex and decimal IDs
    const ioregSample = [
      '  +-o IOUSBHostDevice@01100000  <class IOUSBHostDevice>',
      '    "idVendor" = 0x10cf',
      '    "idProduct" = 2843',
      '    "USB Vendor Name" = "Velleman"',
      '    "USB Product Name" = "Velbus Signum"',
      '    "USB Serial Number" = "VMB-99"',
      '    "IODialinDevice" = "/dev/cu.usbmodem1101"',
    ].join('\n');
    const macDevs = parseMacIoregUsbOutput(ioregSample);
    expect(macDevs).toEqual([
      {
        device: '/dev/cu.usbmodem1101',
        vid: '10CF',
        pid: '0B1B',
        serialNumber: 'VMB-99',
        manufacturer: 'Velleman',
        description: 'Velbus Signum',
      },
    ]);

    const commissioning = new CommissioningService(mockHomekit, undefined);
    const skyAdv = buildUsbAdvertisement(scanned[0]!);
    expect(commissioning.matchesAdvertisement(skyAdv)).toBe(true);
    const velbusAdv = buildUsbAdvertisement(macDevs[0]!);
    expect(commissioning.matchesAdvertisement(velbusAdv)).toBe(true);
    const candidate = commissioning.ingestDiscovery(skyAdv);
    expect(candidate.domain).toBe('homeassistant_sky_connect');
  });

  it('captures raw SSDP headers, UPnP extra tags, and <deviceList> sub-devices', () => {
    const rawResponse = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      'LOCATION: http://192.168.1.55:8060/',
      'SERVER: Roku/12.5.0 UPnP/1.0 Roku/12.5.0',
      'ST: roku:ecp',
      'USN: uuid:roku:ecp:YR0012345678',
      'X-User-Agent: Roku-ECP/12.5',
      '',
    ].join('\r\n');

    const headers = parseSsdpHeaders(rawResponse);
    expect(headers).not.toBeNull();
    expect(headers?.rawHeaders).toMatchObject({
      'X-User-Agent': 'Roku-ECP/12.5',
      ST: 'roku:ecp',
      SERVER: 'Roku/12.5.0 UPnP/1.0 Roku/12.5.0',
    });

    const xml = `
      <root xmlns="urn:schemas-upnp-org:device-1-0">
        <device>
          <deviceType>urn:roku-com:device:player:1-0</deviceType>
          <friendlyName>Living Room Roku</friendlyName>
          <manufacturer>Roku</manufacturer>
          <manufacturerURL>https://www.roku.com</manufacturerURL>
          <modelName>Roku Ultra</modelName>
          <modelNumber>4800X</modelNumber>
          <modelURL>https://www.roku.com/ultra</modelURL>
          <presentationURL>http://192.168.1.55:8060/</presentationURL>
          <serialNumber>YR0012345678</serialNumber>
          <UPC>829610004624</UPC>
          <UDN>uuid:roku:ecp:YR0012345678</UDN>
          <softwareVersion>12.5.5</softwareVersion>
          <deviceList>
            <device>
              <deviceType>urn:schemas-upnp-org:device:Remote:1</deviceType>
              <friendlyName>Roku Voice Remote</friendlyName>
            </device>
          </deviceList>
        </device>
      </root>
    `;

    const desc = parseUpnpDeviceXml(xml);
    expect(desc.modelURL).toBe('https://www.roku.com/ultra');
    expect(desc.presentationURL).toBe('http://192.168.1.55:8060/');
    expect(desc.upc).toBe('829610004624');
    expect(desc.extraTags?.softwareVersion).toBe('12.5.5');
    expect(desc.subDevices).toHaveLength(1);
    expect(desc.subDevices?.[0]?.friendlyName).toBe('Roku Voice Remote');

    const adv = buildSsdpAdvertisement(headers!, '192.168.1.55', desc);
    expect(adv).not.toBeNull();
    expect(adv?.details?.ssdpHeaders).toMatchObject({ 'X-User-Agent': 'Roku-ECP/12.5' });
    expect(adv?.details?.upnp).toMatchObject({
      modelURL: 'https://www.roku.com/ultra',
      UPC: '829610004624',
      softwareVersion: '12.5.5',
    });

    const commissioning = new CommissioningService(mockHomekit, undefined);
    expect(commissioning.matchesAdvertisement(adv!)).toBe(true);
    const candidate = commissioning.ingestDiscovery(adv!);
    expect(candidate.domain).toBe('roku');
  });

  it('resolves reverse DNS hostnames for DHCP neighbors and collects catalog SSDP targets', async () => {
    const resolved = await resolveReverseDnsHostname(
      '192.168.1.77',
      250,
      async () => ['Axis-M1065.local.'],
    );
    expect(resolved).toBe('Axis-M1065.local');

    const slowTimedOut = await resolveReverseDnsHostname(
      '192.168.1.78',
      15,
      () => new Promise(() => undefined),
    );
    expect(slowTimedOut).toBeUndefined();

    // Probe exposes injectable reverseLookup option without socket binding errors
    const probe = new LanProtocolProbe({
      reverseLookup: async () => 'shelly1pm-AABBCC',
    });
    expect(probe).toBeDefined();

    const commissioning = new CommissioningService(mockHomekit, undefined);
    const entries = new HubIntegrationEntryService(undefined, undefined, undefined);
    const repairs = new HubRepairsService(commissioning, entries);
    const updates = new HubUpdatesService(commissioning, entries);
    const scanner = new LanDiscoveryService(commissioning, undefined, mockHomekit);
    const controller = new ManagementController(commissioning, entries, repairs, updates, scanner);

    const targets = controller.listDiscoveryServiceTypes();
    expect(targets.serviceTypes).toContain('_services._dns-sd._udp.local.');
    expect(targets.ssdpTargets).toContain('ssdp:all');
    expect(targets.ssdpTargets).toContain('upnp:rootdevice');
    expect(targets.ssdpTargets).toContain('roku:ecp');
    expect(targets.ssdpTargets).toContain('c4:director');

    const batch = await controller.ingestAnnouncementBatch({
      matchedOnly: true,
      advertisements: [
        {
          protocol: 'usb',
          usb: { vid: '10C4', pid: 'EA60', description: 'SkyConnect v1.0' },
          details: { vid: '10C4', pid: 'EA60', device: '/dev/ttyUSB0' },
        },
        {
          protocol: 'bluetooth',
          mac: 'AA:BB:CC:DD:EE:FF',
          name: 'ATC_123456',
          details: {
            address: 'AA:BB:CC:DD:EE:FF',
            localName: 'ATC_123456',
            serviceUuids: ['0000181a-0000-1000-8000-00805f9b34fb'],
          },
        },
      ],
    });
    expect(batch.received).toBe(2);
    expect(batch.matched).toBeGreaterThanOrEqual(1);
    expect(batch.candidates.some((c) => c.protocol === 'usb')).toBe(true);
  });
});
