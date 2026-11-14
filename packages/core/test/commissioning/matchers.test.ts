/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DNS_SD_RULES,
  DiscoveryRegistry,
  type DiscoveryMatcherRule,
  selectBestDiscoveryMatch,
} from '../../src/commissioning/index.js';

describe('Discovery Rule Specificity & HomeKit Model Matchers', () => {
  it('prefers HomeKit model match (hue BSB002) over generic HAP fallback and ignores paired generic HAP', () => {
    const rules: DiscoveryMatcherRule[] = [
      ...BUILTIN_DNS_SD_RULES,
      {
        domain: 'homekit_controller',
        zeroconf: ['_hap._tcp.local.'],
      },
      {
        domain: 'hue',
        zeroconf: ['_hue._tcp.local.'],
        homekit: { models: ['BSB002'] },
      },
      {
        domain: 'yeelight',
        zeroconf: [{ type: '_miio._udp.local.', name: 'yeelink-*' }],
        homekit: { models: ['YL*'] },
      },
    ];

    // Paired Hue Bridge advertising _hap._tcp with sf=0 and md=BSB002 still matches hue
    const hueMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'zeroconf',
      name: 'Philips hue - 123456',
      host: '192.168.5.20',
      port: 80,
      details: { serviceType: '_hap._tcp.local.', sf: '0', md: 'BSB002', id: '00:17:88:11:22:33' },
    });
    expect(hueMatch?.rule.domain).toBe('hue');

    // Paired generic Apple/HomeKit device (sf=0) without vendor model must NOT match homekit
    const pairedGeneric = selectBestDiscoveryMatch(rules, {
      protocol: 'zeroconf',
      name: 'Living Room HomePod',
      host: '192.168.5.30',
      port: 49152,
      details: {
        serviceType: '_hap._tcp.local.',
        sf: '0',
        md: 'AudioAccessory5,1',
        id: 'aa:bb:cc:11:22:33',
      },
    });
    expect(pairedGeneric).toBeUndefined();

    // Unpaired generic HomeKit accessory (sf=1) still matches
    const unpairedGeneric = selectBestDiscoveryMatch(rules, {
      protocol: 'zeroconf',
      name: 'Meross Switch',
      host: '192.168.5.31',
      port: 80,
      details: { serviceType: '_hap._tcp', sf: '1', md: 'MSS210', id: 'aa:bb:cc:44:55:66' },
    });
    expect(unpairedGeneric?.rule.domain).toBe('homekit');
  });

  it('prefers specific SSDP vendor rules and TXT property rules over generic catch-alls', () => {
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'dlna_dmr',
        ssdp: [
          {
            deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1',
            st: 'urn:schemas-upnp-org:device:MediaRenderer:1',
          },
        ],
      },
      {
        domain: 'denonavr',
        ssdp: [
          {
            manufacturer: 'Denon',
            deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1',
          },
        ],
      },
      {
        domain: 'ecobee',
        zeroconf: [{ type: '_sideplay._tcp.local.', properties: { mdl: 'ecobee*' } }],
      },
      {
        domain: 'august',
        dhcp: [{ hostname: 'connect', macaddress: 'D86162*' }],
      },
    ];

    const denonMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'ssdp',
      host: '192.168.5.40',
      details: {
        deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1',
        st: 'urn:schemas-upnp-org:device:MediaRenderer:1',
        manufacturer: 'Denon',
        modelName: 'AVR-X2700H',
      },
    });
    expect(denonMatch?.rule.domain).toBe('denonavr');

    // Case-insensitive TXT property lookup + normalized zeroconf type
    const ecobeeMatch = selectBestDiscoveryMatch(rules, {
      protocol: 'zeroconf',
      name: 'Thermostat',
      details: { serviceType: '_sideplay._tcp', MDL: 'ecobee4' },
    });
    expect(ecobeeMatch?.rule.domain).toBe('ecobee');

    // Combined DHCP rule requires BOTH hostname and macaddress
    expect(
      selectBestDiscoveryMatch(rules, {
        protocol: 'dhcp',
        mac: 'D8:61:62:11:22:33',
        host: 'espressif-plug',
      }),
    ).toBeUndefined();
    expect(
      selectBestDiscoveryMatch(rules, {
        protocol: 'dhcp',
        mac: 'D8:61:62:11:22:33',
        host: 'connect',
      })?.rule.domain,
    ).toBe('august');
  });

  it('upgrades generic/fallback candidate domain when a more specific protocol rule arrives later', () => {
    const registry = new DiscoveryRegistry();
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'dlna_dmr',
        ssdp: [{ deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1' }],
      },
      {
        domain: 'sony_bravia',
        ssdp: [
          {
            manufacturer: 'Sony Corporation',
            st: 'urn:schemas-sony-com:service:ScalarWebAPI:1',
          },
        ],
      },
    ];

    const first = registry.ingest(
      {
        protocol: 'ssdp',
        uuid: 'uuid:22222222-3333-4444-5555-666666666666',
        host: '192.168.5.60',
        port: 52323,
        name: 'BRAVIA XR',
        details: { deviceType: 'urn:schemas-upnp-org:device:MediaRenderer:1' },
      },
      rules,
    );
    expect(first.domain).toBe('dlna_dmr');

    const upgraded = registry.ingest(
      {
        protocol: 'ssdp',
        uuid: 'uuid:22222222-3333-4444-5555-666666666666',
        host: '192.168.5.60',
        port: 52323,
        name: 'BRAVIA XR',
        details: {
          manufacturer: 'Sony Corporation',
          st: 'urn:schemas-sony-com:service:ScalarWebAPI:1',
        },
      },
      rules,
    );
    expect(upgraded.domain).toBe('sony_bravia');
  });

  it('deduplicates repeated portless zeroconf announcements by mdns fqdn and replaces fallback IPs with resolved A records', () => {
    const registry = new DiscoveryRegistry();
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'apple_tv',
        zeroconf: ['_raop._tcp'],
      },
    ];

    const first = registry.ingest(
      {
        protocol: 'zeroconf',
        host: '192.168.5.218',
        name: '02AFED7ACF59@Bedroom Apple TV',
        details: {
          serviceType: '_raop._tcp',
          fqdn: '02AFED7ACF59@Bedroom Apple TV._raop._tcp.local.',
          addressSource: 'fallback',
        },
      },
      rules,
    );

    expect(first.id).toBe('mdns:02afed7acf59@bedroom apple tv._raop._tcp');
    expect(first.addresses).toEqual(['192.168.5.218']);

    const repeated = registry.ingest(
      {
        protocol: 'zeroconf',
        host: '192.168.5.206',
        name: '02AFED7ACF59@Bedroom Apple TV',
        details: {
          serviceType: '_raop._tcp',
          fqdn: '02AFED7ACF59@Bedroom Apple TV._raop._tcp.local.',
          addressSource: 'fallback',
        },
      },
      rules,
    );

    expect(repeated.id).toBe(first.id);

    const resolvedOne = registry.ingest(
      {
        protocol: 'zeroconf',
        host: '192.168.4.90',
        name: '02AFED7ACF59@Bedroom Apple TV',
        details: {
          serviceType: '_raop._tcp',
          fqdn: '02AFED7ACF59@Bedroom Apple TV._raop._tcp.local.',
          addressSource: 'resolved',
        },
      },
      rules,
    );

    expect(resolvedOne.id).toBe(first.id);
    expect(resolvedOne.addresses).toEqual(['192.168.4.90']);

    const resolvedTwo = registry.ingest(
      {
        protocol: 'zeroconf',
        host: '192.168.4.91',
        name: '02AFED7ACF59@Bedroom Apple TV',
        details: {
          serviceType: '_raop._tcp',
          fqdn: '02AFED7ACF59@Bedroom Apple TV._raop._tcp.local.',
          addressSource: 'resolved',
        },
      },
      rules,
    );

    expect(resolvedTwo.id).toBe(first.id);
    expect(resolvedTwo.addresses).toEqual(['192.168.4.90', '192.168.4.91']);
    expect(registry.listCandidates()).toHaveLength(1);
  });
});
