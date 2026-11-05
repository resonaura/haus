/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  HubPairing,
  parseDiscoveredHub,
  parseManualHubAddress,
  sanitizeServiceName,
  timingSafeStringEqual,
  validatePairingGrant,
  verifyDiscoveredCandidate,
} from '../src/index.js';
import type { ClientIdentity, HubIdentity } from '../src/index.js';

describe('Haus Hub discovery and pairing', () => {
  const hub: HubIdentity = {
    hubId: 'hub-main',
    homeId: 'home-sol',
    name: 'Main Hub',
    fingerprint: 'fp-sha256-abc123xyz',
  };

  const client: ClientIdentity = {
    clientId: 'client-phone',
    clientName: 'Alice Phone',
    role: 'admin',
  };

  describe('Discovery candidate parsing and validation', () => {
    it('accepts valid haus-hub and haus services on private IPv4 and unique-local IPv6', () => {
      const parsedIpv4 = parseDiscoveredHub({
        type: 'haus-hub',
        host: 'hub.local.',
        addresses: ['192.168.1.100'],
        name: 'Living Room Hub',
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-main', homeId: 'home-sol', fingerprint: 'fp-1' },
      });
      expect(parsedIpv4).toEqual({
        id: 'haus-hub:hub-main',
        hubId: 'hub-main',
        homeId: 'home-sol',
        name: 'Living Room Hub',
        url: 'http://192.168.1.100:8443',
        host: '192.168.1.100',
        port: 8443,
        protocol: '1',
        fingerprint: 'fp-1',
        source: 'discovery',
      });

      const parsedIpv6 = parseDiscoveredHub({
        type: '_haus._tcp',
        host: 'hub.local',
        addresses: ['fd00::1'],
        port: 80,
        txt: { version: '1', hubId: 'hub-ipv6' },
      });
      expect(parsedIpv6?.url).toBe('http://[fd00::1]:80');
      expect(parsedIpv6?.source).toBe('discovery');
    });

    it('rejects public IPs, non-local domains, wrong types, and invalid ports', () => {
      const base = {
        type: 'haus-hub',
        host: 'hub.local',
        addresses: ['192.168.1.100'],
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-1' },
      };

      // Wrong service type
      expect(parseDiscoveredHub({ ...base, type: '_http._tcp' })).toBeUndefined();
      // Public IPv4
      expect(
        parseDiscoveredHub({ ...base, addresses: ['8.8.8.8'], host: 'public.com' }),
      ).toBeUndefined();
      // Public IPv6
      expect(
        parseDiscoveredHub({ ...base, addresses: ['2001:db8::1'], host: 'public.com' }),
      ).toBeUndefined();
      // Invalid port
      expect(parseDiscoveredHub({ ...base, port: 0 })).toBeUndefined();
      expect(parseDiscoveredHub({ ...base, port: 70000 })).toBeUndefined();
      // Missing protocol
      expect(parseDiscoveredHub({ ...base, txt: { hubId: 'hub-1' } })).toBeUndefined();
      // Wrong protocol version
      expect(
        parseDiscoveredHub({ ...base, txt: { protocol: '2', hubId: 'hub-1' } }),
      ).toBeUndefined();
      // Missing hubId
      expect(parseDiscoveredHub({ ...base, txt: { protocol: '1' } })).toBeUndefined();
    });

    it('rejects services that attempt to advertise credentials in TXT records', () => {
      const base = {
        type: 'haus-hub',
        host: 'hub.local',
        addresses: ['192.168.1.100'],
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-1' },
      };

      expect(
        parseDiscoveredHub({ ...base, txt: { ...base.txt, token: 'secret-token' } }),
      ).toBeUndefined();
      expect(
        parseDiscoveredHub({ ...base, txt: { ...base.txt, password: 'leaked-password' } }),
      ).toBeUndefined();
      expect(
        parseDiscoveredHub({ ...base, txt: { ...base.txt, node_key: 'private-key' } }),
      ).toBeUndefined();
    });

    it('sanitizes human-readable service names', () => {
      expect(sanitizeServiceName('  \u0000\u001FMy Clean Hub\u007F  ')).toBe('My Clean Hub');
      const longName = 'A'.repeat(200);
      expect(sanitizeServiceName(longName).length).toBe(128);
    });
  });

  describe('Manual-address fallback parsing', () => {
    it('accepts and normalizes local IP, localhost, and .local manual targets', () => {
      const manual1 = parseManualHubAddress('192.168.1.50:8080');
      expect(manual1).toMatchObject({
        url: 'http://192.168.1.50:8080',
        host: '192.168.1.50',
        port: 8080,
        source: 'manual',
      });

      const manual2 = parseManualHubAddress('https://hub.local:8443', {
        hubId: 'manual-hub-1',
        name: 'Custom Server',
      });
      expect(manual2).toMatchObject({
        hubId: 'manual-hub-1',
        name: 'Custom Server',
        url: 'https://hub.local:8443',
        host: 'hub.local',
        port: 8443,
        source: 'manual',
      });

      const manualIpv6 = parseManualHubAddress('[fd00::1]:8443');
      expect(manualIpv6.url).toBe('http://[fd00::1]:8443');
    });

    it('rejects public internet targets and malformed manual inputs', () => {
      expect(() => parseManualHubAddress('')).toThrow('invalid_manual_address');
      expect(() => parseManualHubAddress('8.8.8.8:80')).toThrow('invalid_manual_address');
      expect(() => parseManualHubAddress('example.com:443')).toThrow('invalid_manual_address');
      expect(() => parseManualHubAddress('192.168.1.50:99999')).toThrow('invalid_manual_address');
      expect(() => parseManualHubAddress('http://192.168.1.50/path/is/not/allowed')).toThrow(
        'invalid_manual_address',
      );
    });
  });

  describe('Authenticated pairing lifecycle and invariants', () => {
    it('successfully initiates and confirms pairing with trusted grant', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '849201',
        now: 1000,
        ttlMs: 60_000,
      });

      expect(offer.state).toBe('initiated');
      expect(offer.expiresAt).toBe(61_000);
      expect(offer.hub.hubId).toBe('hub-main');

      const grant = pairing.confirmClient({
        sessionId: offer.sessionId,
        client,
        challengeCode: '849201',
        expectedHomeId: 'home-sol',
        now: 5000,
      });

      expect(grant.hubId).toBe('hub-main');
      expect(grant.homeId).toBe('home-sol');
      expect(grant.clientId).toBe('client-phone');
      expect(grant.clientRole).toBe('admin');
      expect(grant.revoked).toBe(false);

      // Assert grant succeeds
      const verified = pairing.assertGrant(grant.grantId, {
        expectedHubId: 'hub-main',
        expectedHomeId: 'home-sol',
        now: 6000,
      });
      expect(verified.grantId).toBe(grant.grantId);
    });

    it('rejects spoofed Hub identities and mismatched candidate fingerprints', () => {
      const candidate = parseDiscoveredHub({
        type: 'haus-hub',
        host: 'hub.local',
        addresses: ['192.168.1.100'],
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-imposter', fingerprint: 'fp-wrong' },
      })!;

      // Candidate hubId does not match authenticated Hub
      expect(() => verifyDiscoveredCandidate(candidate, hub)).toThrow('spoofed_hub');

      // Candidate fingerprint does not match authenticated Hub
      const matchingIdCandidate = { ...candidate, hubId: 'hub-main' };
      expect(() => verifyDiscoveredCandidate(matchingIdCandidate, hub)).toThrow('spoofed_hub');

      // Grant validated against wrong expected hubId
      const grant = {
        grantId: 'grant-1',
        hubId: 'hub-other',
        homeId: 'home-sol',
        clientId: 'client-1',
        clientRole: 'admin' as const,
        clientName: 'Alice',
        issuedAt: 1000,
        revoked: false,
      };
      expect(() => validatePairingGrant(grant, { expectedHubId: 'hub-main' })).toThrow(
        'spoofed_hub',
      );
    });

    it('rejects wrong-home pairings and mismatched candidate home references', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '123456',
        now: 1000,
      });

      // Client expects home-other instead of home-sol
      expect(() =>
        pairing.confirmClient({
          sessionId: offer.sessionId,
          client,
          challengeCode: '123456',
          expectedHomeId: 'home-other',
          now: 2000,
        }),
      ).toThrow('wrong_home');

      // Candidate advertising wrong homeId
      const wrongHomeCandidate = parseDiscoveredHub({
        type: 'haus-hub',
        host: 'hub.local',
        addresses: ['192.168.1.100'],
        port: 8443,
        txt: { protocol: '1', hubId: 'hub-main', homeId: 'home-mars' },
      })!;
      expect(() => verifyDiscoveredCandidate(wrongHomeCandidate, hub)).toThrow('wrong_home');
    });

    it('rejects expired pairing sessions and expired grants', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '654321',
        now: 1000,
        ttlMs: 30_000, // expires at 31_000
      });

      // Attempt after expiration
      expect(() =>
        pairing.confirmClient({
          sessionId: offer.sessionId,
          client,
          challengeCode: '654321',
          now: 31_001,
        }),
      ).toThrow('pairing_expired');

      // Re-attempting also fails as expired
      expect(() =>
        pairing.confirmClient({
          sessionId: offer.sessionId,
          client,
          challengeCode: '654321',
          now: 32_000,
        }),
      ).toThrow('pairing_expired');

      // Valid grant with expiration
      const grant = {
        grantId: 'grant-expiring',
        hubId: 'hub-main',
        homeId: 'home-sol',
        clientId: 'client-1',
        clientRole: 'admin' as const,
        clientName: 'Alice',
        issuedAt: 1000,
        expiresAt: 5000,
        revoked: false,
      };
      expect(() => validatePairingGrant(grant, { expectedHubId: 'hub-main', now: 5001 })).toThrow(
        'grant_expired',
      );
    });

    it('rejects cancelled pairing attempts and prevents delayed completion', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '112233',
        now: 1000,
      });

      // Explicit cancellation by user/client
      pairing.cancelSession(offer.sessionId);

      // Delayed completion fails
      expect(() =>
        pairing.confirmClient({
          sessionId: offer.sessionId,
          client,
          challengeCode: '112233',
          now: 2000,
        }),
      ).toThrow('pairing_cancelled');
    });

    it('rejects incorrect pairing codes', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '778899',
        now: 1000,
      });

      expect(() =>
        pairing.confirmClient({
          sessionId: offer.sessionId,
          client,
          challengeCode: '000000',
          now: 2000,
        }),
      ).toThrow('invalid_pairing_code');
    });

    it('enforces grant revocation and rejects revoked grants', () => {
      const pairing = new HubPairing();
      const offer = pairing.createSession({
        hub,
        challengeCode: '998877',
        now: 1000,
      });

      const grant = pairing.confirmClient({
        sessionId: offer.sessionId,
        client,
        challengeCode: '998877',
        now: 2000,
      });

      // Active assertion succeeds
      expect(pairing.assertGrant(grant.grantId).grantId).toBe(grant.grantId);

      // Revoke grant
      pairing.revokeGrant(grant.grantId);

      // Assertion fails
      expect(() => pairing.assertGrant(grant.grantId)).toThrow('grant_revoked');
    });

    it('constant-time string comparison behaves correctly', () => {
      expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
      expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
      expect(timingSafeStringEqual('abc', 'ab')).toBe(false);
      expect(timingSafeStringEqual('', '')).toBe(true);
    });
  });
});
