/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/nest.js';
import { HUB_AUTH_SERVICE } from '../../src/auth/tokens.js';
import type { HubAuthService } from '../../src/auth/service.js';
import { CommissioningService } from '../../src/commissioning/service.js';
import type { CommissioningTransaction, DiscoveredCandidate } from '@haus/core';

describe('LAN Discovery, Candidate Matching & IP Handover (P20.3)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('verifies on-network discovery, deduplication, TTL expiration, candidate matching, and manual IP handover fallback', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-comm-handover-'));

    delete process.env.SUPERVISOR_TOKEN;
    delete process.env.HAUS_HA_TOKEN;
    delete process.env.HAUS_API_TOKEN;

    const app = await createNestApp({ dataDirectory: dir });
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const authService = app.get<HubAuthService>(HUB_AUTH_SERVICE);
    const commService = app.get<CommissioningService>(CommissioningService);

    try {
      // 1. Establish authenticated admin session
      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-1', clientName: 'Admin Desk', role: 'admin' },
        }),
      });
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const token = paired.credentials.sessionToken;
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };

      // 2. Ingest DNS-SD announcements
      // 2.1 HAP-IP unpaired accessory
      const hapAdvRes = await fetch(`${base}/api/commissioning/discoveries/announcements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'zeroconf',
          name: 'Living Room Plug',
          host: '192.168.1.101',
          port: 51827,
          details: {
            serviceType: '_hap._tcp',
            id: '11:22:33:44:55:66',
            sf: '1',
            sh: '7ngv1w==',
            md: 'Socket-Pro',
          },
        }),
      });
      expect(hapAdvRes.status).toBe(202);
      const hapCandidate = (await hapAdvRes.json()) as DiscoveredCandidate;
      expect(hapCandidate.domain).toBe('homekit');
      expect(hapCandidate.addresses).toContain('192.168.1.101');
      expect(hapCandidate.durableIdentities.some((i) => i.kind === 'hap')).toBe(true);

      // 2.2 Ingest DHCP announcement for the exact same physical device -> deduplication check
      const dhcpAdvRes = await fetch(`${base}/api/commissioning/discoveries/announcements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'dhcp',
          mac: '11:22:33:44:55:66',
          host: '192.168.1.101',
          name: 'dhcp-plug',
        }),
      });
      expect(dhcpAdvRes.status).toBe(202);
      const dedupCandidate = (await dhcpAdvRes.json()) as DiscoveredCandidate;
      expect(dedupCandidate.id).toBe(hapCandidate.id);
      expect(dedupCandidate.secondaryProtocols).toContain('zeroconf');
      expect(dedupCandidate.secondaryProtocols).toContain('dhcp');

      // 2.3 Ingest already-paired accessory (sf: 0)
      const pairedAdvRes = await fetch(`${base}/api/commissioning/discoveries/announcements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'zeroconf',
          name: 'Paired Bedroom Switch',
          host: '192.168.1.102',
          port: 51827,
          details: {
            serviceType: '_hap._tcp',
            id: 'aa:bb:cc:dd:ee:ff',
            sf: '0',
          },
        }),
      });
      expect(pairedAdvRes.status).toBe(202);
      const pairedCandidate = (await pairedAdvRes.json()) as DiscoveredCandidate;
      expect(pairedCandidate.details.pairingAvailable).toBe(false);

      // 3. Stale advertisement TTL pruning
      const expiringRes = await fetch(`${base}/api/commissioning/discoveries/announcements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          protocol: 'zeroconf',
          name: 'Expiring Light',
          ttlMs: 40,
          details: { id: 'expiring-node-1' },
        }),
      });
      expect(expiringRes.status).toBe(202);
      const expiring = (await expiringRes.json()) as DiscoveredCandidate;
      expect(commService.getDiscovery(expiring.id)).toBeDefined();

      // Calling pruneExpired after expiry purges it
      await new Promise((r) => setTimeout(r, 60));
      const pruned = commService.pruneExpiredDiscoveries();
      expect(pruned).toBeGreaterThanOrEqual(1);
      expect(commService.getDiscovery(expiring.id)).toBeUndefined();

      // 4. Candidate selection & manual address fallback
      // Start session with HomeKit setup code
      const sessionRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: 'X-HM://0054F7G0S1234' }),
      });
      expect(sessionRes.status).toBe(202);
      const tx = (await sessionRes.json()) as CommissioningTransaction;
      expect(tx.commissioningId).toBeDefined();

      // Proves manual IP fallback when mDNS is filtered/unavailable across VLANs
      const manualRes = await fetch(
        `${base}/api/commissioning/sessions/${tx.commissioningId}/manual-address`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ address: '192.168.1.205', port: 51827 }),
        },
      );
      expect(manualRes.status).toBe(200);
      const manualTx = (await manualRes.json()) as CommissioningTransaction;
      expect(manualTx.selectedCandidate?.address).toBe('192.168.1.205');
      expect(manualTx.selectedCandidate?.port).toBe(51827);
      expect(manualTx.events.some((e) => e.message.includes('Manual IP configured'))).toBe(true);

      // 5. Wrong-home access control rejection on manual-address
      expect(() =>
        commService.provideManualAddress(
          tx.commissioningId,
          { address: '192.168.1.206' },
          { homeId: 'wrong-home-id' },
        ),
      ).toThrow(/wrong_home/);

      // 6. Proves BLE-to-IP handover coordinator detects device IP appearance
      const handoverPromise = commService.handover.waitForIp('handover-test-1', {
        protocol: 'vendor',
        mac: '44:55:66:77:88:99',
        timeoutMs: 3000,
        initialAddress: '192.168.1.50',
      });

      // Device reboots radio and re-announces with new DHCP IP address
      commService.ingestDiscovery({
        protocol: 'zeroconf',
        name: 'esphome-device',
        host: '192.168.1.188',
        port: 6053,
        details: {
          serviceType: '_esphomelib._tcp',
          mac: '445566778899',
          platform: 'esp32',
        },
      });

      const handoverResult = await handoverPromise;
      expect(handoverResult.address).toBe('192.168.1.188');
      expect(handoverResult.port).toBe(6053);
      expect(handoverResult.addressChanged).toBe(true);

      // 7. Proves cancellation during handover cleans up cleanly
      const cancelController = new AbortController();
      const cancelledHandover = commService.handover.waitForIp(
        'handover-cancel-1',
        { protocol: 'matter', discriminator: 3840, timeoutMs: 5000 },
        { signal: cancelController.signal },
      );
      cancelController.abort();
      await expect(cancelledHandover).rejects.toThrow('handover_cancelled');
    } finally {
      await app.close();
    }
  });
});
