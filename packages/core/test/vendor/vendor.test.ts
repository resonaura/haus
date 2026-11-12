/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  classifyVendorDevice,
  provisionVendorDevice,
  type VendorCandidate,
} from '../../src/commissioning/vendor.js';

describe('Vendor Provisioning & Classification (P20.11)', () => {
  it('classifies Shelly Gen2/Gen3 RPC devices correctly', () => {
    const candidate = classifyVendorDevice({
      host: '192.168.33.1',
      name: 'ShellyPlus1PM-C049EF012345',
      serviceType: '_shelly._tcp.local',
      txt: {
        gen: '2',
        model: 'SNSW-001P16EU',
        mac: 'C049EF012345',
      },
    });

    assert.equal(candidate.vendor, 'shelly');
    assert.equal(candidate.protocol, 'shelly-rpc');
    assert.equal(candidate.generation, 2);
    assert.equal(candidate.port, 80);
    assert.equal(candidate.mac, 'C049EF012345');
    assert.equal(candidate.authRequired, false);
  });

  it('classifies Shelly Gen1 legacy devices correctly', () => {
    const candidate = classifyVendorDevice({
      host: '192.168.33.1',
      name: 'shelly1-A1B2C3',
      serviceType: '_http._tcp.local',
      txt: {
        model: 'SHSW-1',
        mac: 'A1B2C3D4E5F6',
        auth: '1',
      },
    });

    assert.equal(candidate.vendor, 'shelly');
    assert.equal(candidate.protocol, 'shelly-gen1');
    assert.equal(candidate.generation, 1);
    assert.equal(candidate.authRequired, true);
  });

  it('classifies ESPHome web captive portal devices', () => {
    const candidate = classifyVendorDevice({
      host: '192.168.4.1',
      name: 'esphome-air-sensor',
      serviceType: '_esphomelib._tcp.local',
      txt: {
        project_name: 'esphome.air-sensor',
        mac: '485519ABCDEF',
      },
    });

    assert.equal(candidate.vendor, 'esphome');
    assert.equal(candidate.protocol, 'esphome-web');
    assert.equal(candidate.model, 'esphome.air-sensor');
  });

  it('classifies Tasmota devices correctly', () => {
    const candidate = classifyVendorDevice({
      host: '192.168.4.1',
      name: 'tasmota-relay',
      serviceType: '_http._tcp.local',
      txt: {
        friendly_name: 'Living Room Light',
      },
    });

    assert.equal(candidate.vendor, 'tasmota');
    assert.equal(candidate.protocol, 'tasmota-web');
    assert.equal(candidate.model, 'Living Room Light');
  });

  it('classifies Aqara device with Matter or HomeKit referral', () => {
    const matterCandidate = classifyVendorDevice({
      host: '192.168.1.150',
      name: 'Aqara-Hub-M2-Matter',
      serviceType: '_matterc._udp.local',
      txt: {
        md: '3840',
      },
    });

    assert.equal(matterCandidate.vendor, 'aqara');
    assert.equal(matterCandidate.protocol, 'aqara-matter-referral');
    assert.equal(matterCandidate.matterDiscriminator, 3840);

    const homekitCandidate = classifyVendorDevice({
      host: '192.168.1.151',
      name: 'Aqara-G2H-Pro',
      serviceType: '_hap._tcp.local',
      txt: {
        sf: '1',
        setup_id: 'AQ02',
      },
    });

    assert.equal(homekitCandidate.vendor, 'aqara');
    assert.equal(homekitCandidate.protocol, 'aqara-matter-referral');
    assert.equal(homekitCandidate.homekitSetupId, 'AQ02');
  });

  it('classifies Aqara proprietary device honestly without fabricating fake protocol', () => {
    const candidate = classifyVendorDevice({
      host: '192.168.1.152',
      name: 'Aqara-Doorbell-Proprietary',
      serviceType: '_aqara._tcp.local',
      txt: {},
    });

    assert.equal(candidate.vendor, 'aqara');
    assert.equal(candidate.protocol, 'aqara-proprietary');
  });

  it('provisions Shelly RPC device via WiFi.SetConfig and Shelly.Reboot', async () => {
    const candidate: VendorCandidate = {
      vendor: 'shelly',
      protocol: 'shelly-rpc',
      host: '192.168.33.1',
      port: 80,
      mac: 'C049EF012345',
    };

    const requestedUrls: string[] = [];
    const requestedBodies: string[] = [];

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      if (init?.body) requestedBodies.push(String(init.body));

      if (url.includes('/rpc/WiFi.SetConfig')) {
        return new Response(JSON.stringify({ result: { restart_required: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/rpc/Shelly.Reboot')) {
        return new Response(JSON.stringify({ result: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    }) as typeof fetch;

    const res = await provisionVendorDevice(
      candidate,
      { ssid: 'HausNet_5G', password: 'SecretPassword123' },
      { fetchFn: mockFetch },
    );

    assert.equal(res.status, 'provisioned');
    assert.equal(res.vendor, 'shelly');
    assert.equal(res.protocol, 'shelly-rpc');
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls[0]?.includes('/rpc/WiFi.SetConfig'));
    assert.ok(requestedUrls[1]?.includes('/rpc/Shelly.Reboot'));

    const setConfigPayload = JSON.parse(requestedBodies[0] ?? '{}') as {
      method: string;
      params: { config: { sta: { ssid: string; pass: string } } };
    };
    assert.equal(setConfigPayload.method, 'WiFi.SetConfig');
    assert.equal(setConfigPayload.params.config.sta.ssid, 'HausNet_5G');
    assert.equal(setConfigPayload.params.config.sta.pass, 'SecretPassword123');
  });

  it('reports authentication required for password-protected Shelly devices', async () => {
    const candidate: VendorCandidate = {
      vendor: 'shelly',
      protocol: 'shelly-rpc',
      host: '192.168.33.1',
      port: 80,
    };

    const mockFetch = (async () => {
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    const res = await provisionVendorDevice(
      candidate,
      { ssid: 'HausNet_5G', password: 'Pass' },
      { fetchFn: mockFetch },
    );

    assert.equal(res.status, 'failed');
    assert.ok(res.error?.includes('Authentication required'));
  });

  it('provisions Shelly Gen1 legacy device via /settings/sta', async () => {
    const candidate: VendorCandidate = {
      vendor: 'shelly',
      protocol: 'shelly-gen1',
      host: '192.168.33.1',
      port: 80,
    };

    let requestedQuery = '';
    const mockFetch = (async (input: RequestInfo | URL) => {
      requestedQuery = String(input);
      return new Response(JSON.stringify({ has_update: false }), { status: 200 });
    }) as typeof fetch;

    const res = await provisionVendorDevice(
      candidate,
      { ssid: 'MyHomeWiFi', password: 'Password@99' },
      { fetchFn: mockFetch },
    );

    assert.equal(res.status, 'provisioned');
    assert.ok(requestedQuery.includes('/settings/sta?'));
    assert.ok(requestedQuery.includes('ssid=MyHomeWiFi'));
    assert.ok(requestedQuery.includes('key=Password%4099'));
  });

  it('provisions ESPHome web captive portal via /wifisave', async () => {
    const candidate: VendorCandidate = {
      vendor: 'esphome',
      protocol: 'esphome-web',
      host: '192.168.4.1',
      port: 80,
    };

    let sentBody = '';
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response('Saved', { status: 200 });
    }) as typeof fetch;

    const res = await provisionVendorDevice(
      candidate,
      { ssid: 'IoT_Network', password: 'PresharedKey' },
      { fetchFn: mockFetch },
    );

    assert.equal(res.status, 'provisioned');
    assert.equal(res.protocol, 'esphome-web');
    assert.ok(sentBody.includes('ssid=IoT_Network'));
    assert.ok(sentBody.includes('psk=PresharedKey'));
  });

  it('provisions Tasmota web portal via /wi', async () => {
    const candidate: VendorCandidate = {
      vendor: 'tasmota',
      protocol: 'tasmota-web',
      host: '192.168.4.1',
      port: 80,
    };

    let sentBody = '';
    const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response('Restarting', { status: 200 });
    }) as typeof fetch;

    const res = await provisionVendorDevice(
      candidate,
      { ssid: 'TasmotaWiFi', password: 'TasmotaSecret' },
      { fetchFn: mockFetch },
    );

    assert.equal(res.status, 'provisioned');
    assert.equal(res.protocol, 'tasmota-web');
    assert.ok(sentBody.includes('s1=TasmotaWiFi'));
    assert.ok(sentBody.includes('p1=TasmotaSecret'));
  });

  it('routes Aqara Matter devices to open standard without cloud lock-in', async () => {
    const candidate: VendorCandidate = {
      vendor: 'aqara',
      protocol: 'aqara-matter-referral',
      host: '192.168.1.150',
      port: 80,
      matterDiscriminator: 3840,
    };

    const res = await provisionVendorDevice(candidate, { ssid: 'W', password: 'P' });
    assert.equal(res.status, 'referral_required');
    assert.equal(res.referralProtocol, 'matter');
    assert.ok(res.guidance?.includes('Matter'));
  });

  it('rejects proprietary Aqara devices with truthful boundary guidance', async () => {
    const candidate: VendorCandidate = {
      vendor: 'aqara',
      protocol: 'aqara-proprietary',
      host: '192.168.1.152',
      port: 80,
    };

    const res = await provisionVendorDevice(candidate, { ssid: 'W', password: 'P' });
    assert.equal(res.status, 'unsupported_proprietary');
    assert.ok(res.error?.includes('Aqara proprietary provisioning requires vendor cloud app'));
  });
});
