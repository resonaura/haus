/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DNS_SD_RULES,
  DiscoveryRegistry,
  IntegrationFlowEngine,
  computeDurableIdentities,
  globMatches,
  isCandidatePairingAvailable,
  matchCandidateToSetupCode,
  matchesDiscoveryRule,
  normalizeMac,
  normalizeUuid,
  parseDnsSdTxt,
  parseSetupCode,
  type DiscoveryMatcherRule,
} from '../src/commissioning/index.js';

describe('Discovery Deduplication & Matchers (P18.8.1)', () => {
  it('normalizes MAC and UUID durable identifiers cleanly', () => {
    expect(normalizeMac('E8:4F:25:AA:BB:CC')).toBe('e84f25aabbcc');
    expect(normalizeMac('e8-4f-25-aa-bb-cc')).toBe('e84f25aabbcc');
    expect(normalizeMac('invalid')).toBeUndefined();

    expect(normalizeUuid('uuid:2fac1234-abcd-4ef0-9123-0123456789ab')).toBe(
      '2fac1234-abcd-4ef0-9123-0123456789ab',
    );
    expect(normalizeUuid('URN:UUID:2FAC1234-ABCD-4EF0-9123-0123456789AB')).toBe(
      '2fac1234-abcd-4ef0-9123-0123456789ab',
    );

    const ids = computeDurableIdentities({
      protocol: 'dhcp',
      mac: 'E8:4F:25:AA:BB:CC',
      host: '192.168.1.50',
      port: 80,
    });
    expect(ids.some((i) => i.kind === 'mac' && i.value === 'mac:e84f25aabbcc')).toBe(true);
    expect(ids.some((i) => i.kind === 'net' && i.value === 'net:192.168.1.50:80')).toBe(true);
  });

  it('evaluates glob pattern matching correctly', () => {
    expect(globMatches('E84F25*', 'e84f25aabbcc')).toBe(true);
    expect(globMatches('E84F25*', '001122334455')).toBe(false);
    expect(globMatches('*skyconnect*', 'Home Assistant SkyConnect v1.0')).toBe(true);
    expect(globMatches('ACAIA*', 'ACAIA-LUNAR-12')).toBe(true);
    expect(globMatches('_axis-video._tcp.local.', '_axis-video._tcp.local.')).toBe(true);
  });

  it('matches discovery rules against Zeroconf, SSDP, DHCP, Bluetooth, and USB sources', () => {
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'axis',
        zeroconf: [{ type: '_axis-video._tcp.local.' }],
        ssdp: [{ manufacturer: 'AXIS' }],
      },
      {
        domain: 'airzone',
        dhcp: [{ macaddress: 'E84F25*' }],
      },
      {
        domain: 'acaia',
        bluetooth: [{ local_name: 'ACAIA*' }],
      },
      {
        domain: 'homeassistant_sky_connect',
        usb: [{ vid: '10C4', pid: 'EA60', description: '*skyconnect*' }],
      },
    ];

    expect(
      matchesDiscoveryRule(rules[0], {
        protocol: 'zeroconf',
        details: { serviceType: '_axis-video._tcp.local.' },
      }),
    ).toBe(true);

    expect(
      matchesDiscoveryRule(rules[0], {
        protocol: 'ssdp',
        details: { manufacturer: 'AXIS Communications' },
      }),
    ).toBe(true);

    expect(
      matchesDiscoveryRule(rules[1], {
        protocol: 'dhcp',
        mac: 'E8:4F:25:01:02:03',
      }),
    ).toBe(true);

    expect(
      matchesDiscoveryRule(rules[2], {
        protocol: 'bluetooth',
        name: 'ACAIA-SCALE-10',
      }),
    ).toBe(true);

    expect(
      matchesDiscoveryRule(rules[3], {
        protocol: 'usb',
        usb: { vid: '10c4', pid: 'ea60', description: 'Silicon Labs SkyConnect v1.0' },
      }),
    ).toBe(true);
  });

  it('deduplicates multi-protocol discoveries (DHCP + Zeroconf) into one unified candidate', () => {
    const registry = new DiscoveryRegistry();
    const rules: DiscoveryMatcherRule[] = [
      {
        domain: 'axis',
        zeroconf: [{ type: '_axis-video._tcp.local.' }],
        dhcp: [{ macaddress: 'ACCC8E*' }],
      },
    ];

    // Step 1: Initial discovery via DHCP
    const dhcpCandidate = registry.ingest(
      {
        protocol: 'dhcp',
        mac: 'AC:CC:8E:11:22:33',
        host: '192.168.1.120',
        name: 'axis-camera-hallway',
      },
      rules,
    );

    expect(dhcpCandidate.id).toBe('mac:accc8e112233');
    expect(dhcpCandidate.domain).toBe('axis');
    expect(dhcpCandidate.status).toBe('discovered');
    expect(dhcpCandidate.authenticated).toBe(false); // Invariant!
    expect(dhcpCandidate.addresses).toContain('192.168.1.120');

    // Step 2: Later announcement via Zeroconf for the same physical device
    const zcCandidate = registry.ingest(
      {
        protocol: 'zeroconf',
        mac: 'accc8e112233',
        host: '192.168.1.120',
        port: 80,
        name: 'Axis M1065-LW',
        details: { serviceType: '_axis-video._tcp.local.', macaddress: 'accc8e112233' },
      },
      rules,
    );

    // Assert: Deduped to the exact same candidate
    expect(zcCandidate.id).toBe('mac:accc8e112233');
    expect(zcCandidate.name).toBe('Axis M1065-LW');
    expect(zcCandidate.port).toBe(80);
    expect(zcCandidate.secondaryProtocols).toContain('dhcp');
    expect(zcCandidate.secondaryProtocols).toContain('zeroconf');

    const all = registry.listCandidates();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('mac:accc8e112233');
  });

  it('supports ignoring, unignoring, and suppressing already configured devices', () => {
    const registry = new DiscoveryRegistry();
    const candidate = registry.ingest({
      protocol: 'zeroconf',
      mac: '001122334455',
      name: 'Smart Plug',
      domain: 'meross_lan',
    });

    expect(candidate.status).toBe('discovered');

    // Ignore
    registry.ignore(candidate.id);
    expect(registry.getCandidate(candidate.id)?.status).toBe('ignored');
    expect(registry.listCandidates({ status: 'discovered' })).toHaveLength(0);
    expect(registry.listCandidates({ status: 'ignored' })).toHaveLength(1);

    // Unignore
    registry.unignore(candidate.id);
    expect(registry.getCandidate(candidate.id)?.status).toBe('discovered');

    // Mark Configured
    registry.markConfigured(candidate.id);
    expect(registry.getCandidate(candidate.id)?.status).toBe('configured');
    expect(registry.listCandidates({ status: 'discovered' })).toHaveLength(0);

    // Re-announcement of configured device retains configured status
    const refreshed = registry.ingest({
      protocol: 'zeroconf',
      mac: '001122334455',
      name: 'Smart Plug Renamed',
      domain: 'meross_lan',
    });
    expect(refreshed.status).toBe('configured');
  });

  it('cleans up stale unconfigured discoveries', () => {
    const registry = new DiscoveryRegistry();
    registry.ingest({
      protocol: 'zeroconf',
      mac: '001122334401',
      name: 'Ephemeral Device',
      domain: 'wled',
    });

    // Stale check with 0 ms TTL removes unconfigured discovery
    const removed = registry.clearStale(-1);
    expect(removed).toBe(1);
    expect(registry.listCandidates()).toHaveLength(0);
  });
});

describe('Integration Flow Engine (P18.8.2 & P18.8.3)', () => {
  it('executes a credential-based setup flow with validation and entry creation', async () => {
    const registry = new DiscoveryRegistry();
    const candidate = registry.ingest({
      protocol: 'zeroconf',
      mac: 'aa1122334455',
      name: 'Living Room Meross Plug',
      domain: 'meross_lan',
      addresses: ['192.168.1.155'],
    });

    const engine = new IntegrationFlowEngine(registry);

    // Step 1: Start flow from discovery
    const step1 = await engine.startFlow({
      domain: 'meross_lan',
      source: 'discovery',
      candidateId: candidate.id,
      homeId: 'home_main',
      userId: 'user_admin',
    });

    expect(step1.type).toBe('form');
    expect(step1.stepId).toBe('user');
    expect(step1.title).toBe('Add Meross LAN Device');
    expect(step1.dataSchema?.find((f) => f.name === 'host')?.defaultValue).toBe('192.168.1.155');

    // Candidate should now be in_progress
    expect(registry.getCandidate(candidate.id)?.status).toBe('in_progress');

    // Step 2: Submit with missing required field
    const invalidSub = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home_main',
      userId: 'user_admin',
      values: { host: '' },
    });
    expect(invalidSub.errors?.host).toBe('required');

    // Step 3: Submit valid values
    const done = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home_main',
      userId: 'user_admin',
      values: { host: '192.168.1.155', key: 'secret_key' },
    });

    expect(done.type).toBe('create_entry');
    expect(done.result?.entryId).toBeDefined();
    expect(done.result?.deviceId).toBe(candidate.id);

    // Candidate is now marked configured
    expect(registry.getCandidate(candidate.id)?.status).toBe('configured');
  });

  it('handles multi-step 2FA flow (e.g. Eero) with phone verification', async () => {
    const engine = new IntegrationFlowEngine();

    // Step 1: Enter phone number
    const step1 = await engine.startFlow({
      domain: 'eero',
      source: 'user',
      homeId: 'home_main',
      userId: 'user_admin',
    });

    expect(step1.type).toBe('form');
    expect(step1.stepId).toBe('user');

    // Step 2: Submit phone number, transitions to 2FA verification code
    const step2 = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home_main',
      userId: 'user_admin',
      values: { user_token: '+15551234567' },
    });

    expect(step2.type).toBe('form');
    expect(step2.stepId).toBe('2fa');
    expect(step2.title).toBe('Enter Verification Code');
    expect(step2.dataSchema?.[0].name).toBe('verification_code');

    // Step 3: Submit 2FA code -> completes entry
    const done = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home_main',
      userId: 'user_admin',
      values: { verification_code: '123456' },
    });

    expect(done.type).toBe('create_entry');
    expect(done.result?.title).toBe('Sign in to Eero');
  });

  it('handles OAuth external authorization flows (e.g. Nest)', async () => {
    const engine = new IntegrationFlowEngine();

    const step1 = await engine.startFlow({
      domain: 'nest',
      source: 'user',
      homeId: 'home_main',
      userId: 'user_admin',
    });

    expect(step1.type).toBe('external');
    expect(step1.stepId).toBe('oauth');
    expect(step1.url).toContain('partnerconnections');

    const done = await engine.submitStep({
      flowId: step1.flowId,
      homeId: 'home_main',
      userId: 'user_admin',
      values: { code: 'auth_callback_token_123' },
    });

    expect(done.type).toBe('create_entry');
  });

  it('truthfully aborts unsupported integrations with concrete missing capabilities', async () => {
    const engine = new IntegrationFlowEngine();

    const step = await engine.startFlow({
      domain: 'some_arbitrary_python_addon',
      source: 'user',
      homeId: 'home_main',
      userId: 'user_admin',
    });

    expect(step.type).toBe('abort');
    expect(step.unsupportedRequirements).toBeDefined();
    expect(step.unsupportedRequirements?.[0].category).toBe('runtime');
  });

  it('enforces multi-home isolation and client reconnection', async () => {
    const engine = new IntegrationFlowEngine();

    const flow = await engine.startFlow({
      domain: 'meross_lan',
      source: 'user',
      homeId: 'home_alpha',
      userId: 'user_alpha',
    });

    // Reconnecting with correct homeId succeeds
    const retrieved = engine.getFlow(flow.flowId, { homeId: 'home_alpha' });
    expect(retrieved?.flowId).toBe(flow.flowId);

    // Reconnecting with different homeId returns undefined (tenant isolation)
    const unauthorized = engine.getFlow(flow.flowId, { homeId: 'home_beta' });
    expect(unauthorized).toBeUndefined();

    // Submitting with wrong homeId rejects
    await expect(
      engine.submitStep({
        flowId: flow.flowId,
        homeId: 'home_beta',
        userId: 'user_beta',
        values: { host: '192.168.1.1' },
      }),
    ).rejects.toThrow('flow_not_found');

    // Cancelling with correct homeId succeeds
    const cancelled = engine.cancelFlow(flow.flowId, { homeId: 'home_alpha' });
    expect(cancelled).toBe(true);
    expect(engine.getFlow(flow.flowId, { homeId: 'home_alpha' })).toBeUndefined();
  });

  it('validates protocol-specific DNS-SD matchers and pairing availability (P20.3)', () => {
    const hapDetails = parseDnsSdTxt('_hap._tcp', {
      sf: '1',
      id: '11:22:33:44:55:66',
      md: 'Socket-Pro',
      sh: '7ngv1w==',
      ci: '2',
    });
    expect(hapDetails.pairingAvailable).toBe(true);
    expect(hapDetails.paired).toBe(false);
    expect(hapDetails.accessoryId).toBe('11:22:33:44:55:66');
    expect(hapDetails.categoryId).toBe(2);

    const matterDetails = parseDnsSdTxt('_matterc._udp', {
      CM: '1',
      D: '3840',
      VP: '1234+5678',
      DN: 'Living Room Light',
    });
    expect(matterDetails.pairingAvailable).toBe(true);
    expect(matterDetails.discriminator).toBe(3840);
    expect(matterDetails.shortDiscriminator).toBe(15);
    expect(matterDetails.vendorId).toBe(1234);
    expect(matterDetails.productId).toBe(5678);

    const esphomeDetails = parseDnsSdTxt('_esphomelib._tcp', {
      mac: 'aabbccddeeff',
      platform: 'esp32',
      board: 'nodemcu-32s',
    });
    expect(esphomeDetails.mac).toBe('aabbccddeeff');
    expect(esphomeDetails.platform).toBe('esp32');

    expect(BUILTIN_DNS_SD_RULES.some((r) => r.domain === 'homekit')).toBe(true);
    expect(BUILTIN_DNS_SD_RULES.some((r) => r.domain === 'matter')).toBe(true);
  });

  it('matches discovered candidates to setup codes with discriminator/hash validation (P20.3)', () => {
    const registry = new DiscoveryRegistry();
    const hapCandidate = registry.ingest({
      protocol: 'zeroconf',
      name: 'Smart Socket',
      details: { serviceType: '_hap._tcp', id: '11:22:33:44:55:66', sf: '1', sh: '7ngv1w==' },
    });

    const parsedHap = parseSetupCode('X-HM://0054F7G0S3034', { contextProtocol: 'homekit' });
    const mockHashFn = (setupId: string, accId: string) =>
      setupId === '3034' && accId === '11:22:33:44:55:66' ? '7ngv1w==' : 'different';

    const matchSuccess = matchCandidateToSetupCode(hapCandidate, parsedHap, {
      computeSetupHash: mockHashFn,
    });
    expect(matchSuccess.matched).toBe(true);
    expect(matchSuccess.score).toBe(100);

    const matchMismatch = matchCandidateToSetupCode(hapCandidate, parsedHap, {
      computeSetupHash: () => 'wrong_hash',
    });
    expect(matchMismatch.matched).toBe(false);
    expect(matchMismatch.reason).toBe('setup_hash_mismatch');

    const pairedHap = registry.ingest({
      protocol: 'zeroconf',
      name: 'Paired Socket',
      details: { serviceType: '_hap._tcp', id: 'aa:bb:cc:dd:ee:ff', sf: '0' },
    });
    expect(isCandidatePairingAvailable(pairedHap)).toBe(false);
    const pairedMatch = matchCandidateToSetupCode(pairedHap, parsedHap);
    expect(pairedMatch.matched).toBe(false);
    expect(pairedMatch.reason).toBe('accessory_already_paired');

    const matterCandidate = registry.ingest({
      protocol: 'zeroconf',
      name: 'Matter Bulb',
      details: { serviceType: '_matterc._udp', CM: '1', D: 3840, vendorId: 1234, productId: 5678 },
    });
    const parsedMatter = parseSetupCode('MT:Y.K9042C00KA0648G00');
    expect(matchCandidateToSetupCode(matterCandidate, parsedMatter).matched).toBe(true);

    const wrongDisc = registry.ingest({
      protocol: 'zeroconf',
      name: 'Other Bulb',
      details: { serviceType: '_matterc._udp', CM: '1', D: 100 },
    });
    const discMismatch = matchCandidateToSetupCode(wrongDisc, parsedMatter);
    expect(discMismatch.matched).toBe(false);
    expect(discMismatch.reason).toBe('discriminator_mismatch');
  });

  it('manages candidate TTL expiration, pruning, and async waitForCandidate (P20.3)', async () => {
    const registry = new DiscoveryRegistry();
    const candidate = registry.ingest({
      protocol: 'zeroconf',
      name: 'Expiring Sensor',
      ttlMs: 50,
      details: { id: 'temp-1', serviceType: '_hap._tcp', sf: '1' },
    });
    expect(registry.getCandidate(candidate.id)).toBeDefined();
    expect(registry.pruneExpired(Date.now())).toBe(0);
    expect(registry.pruneExpired(Date.now() + 100)).toBe(1);
    expect(registry.getCandidate(candidate.id)).toBeUndefined();

    const waitPromise = registry.waitForCandidate((c) => c.name === 'Late Device', {
      timeoutMs: 2000,
    });
    registry.ingest({
      protocol: 'zeroconf',
      name: 'Late Device',
      details: { id: 'late-1', mac: '11:22:33:44:55:77' },
    });
    const arrived = await waitPromise;
    expect(arrived?.name).toBe('Late Device');
  });
});
