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
import type { CommissioningTransaction } from '@haus/core';

describe('Resumable Code-First Commissioning Transactions (P20.1 & P20.2)', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('proves resumable transaction, candidate selection, credentials prompt, cancellation, wrong-home isolation, and deadline enforcement', async () => {
    dir = await mkdtemp(join(tmpdir(), 'haus-comm-tx-'));

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
      // Register a local radio agent so radio-backed flows (Improv) can operate
      commService.radios.register({
        id: 'radio-hub-ble',
        platform: 'hub',
        async *scan() {},
        async connect() {
          throw new Error('radio_connect_unsupported');
        },
      });

      const challengeRes = await fetch(`${base}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(challengeRes.status).toBe(201);
      const challenge = (await challengeRes.json()) as { sessionId: string };
      const challengeCode = authService.pairing.getSession(challenge.sessionId)!.challengeCode;

      const confirmRes = await fetch(`${base}/api/auth/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: challenge.sessionId,
          challengeCode,
          client: { clientId: 'admin-client', clientName: 'Admin Desktop', role: 'admin' },
        }),
      });
      expect(confirmRes.status).toBe(201);
      const confirmed = (await confirmRes.json()) as { grant: { homeId: string } };
      const primaryHomeId = confirmed.grant.homeId;

      const pairRes = await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant: confirmed.grant }),
      });
      expect(pairRes.status).toBe(201);
      const paired = (await pairRes.json()) as { credentials: { sessionToken: string } };
      const primaryToken = paired.credentials.sessionToken;

      const authHeaders = {
        authorization: `Bearer ${primaryToken}`,
        'content-type': 'application/json',
      };

      // 2. Start code-first onboarding transaction (HomeKit PIN)
      const startRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: '816-91-935' }),
      });
      expect(startRes.status).toBe(202);
      const tx1 = (await startRes.json()) as CommissioningTransaction;
      expect(tx1.commissioningId).toBeDefined();
      expect(tx1.homeId).toBe(primaryHomeId);
      expect(tx1.parsedCode.kind).toBe('homekit-pin');
      expect(tx1.parsedCode.protocol).toBe('homekit');
      // Invariant: raw setup code and secret PIN are redacted
      expect(tx1.parsedCode.raw).toBe('');
      expect(tx1.parsedCode.homekit?.pin).toBe('***-**-***');
      expect(tx1.events.length).toBeGreaterThan(0);

      // 3. Duplicate attempt check: submitting identical code returns existing active session
      const dupRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: '816-91-935' }),
      });
      expect(dupRes.status).toBe(202);
      const dupTx = (await dupRes.json()) as CommissioningTransaction;
      expect(dupTx.commissioningId).toBe(tx1.commissioningId);

      // 4. Client reconnection & resume: screen reopening does NOT restart pairing
      const resumeRes = await fetch(`${base}/api/commissioning/sessions/${tx1.commissioningId}/resume`, {
        method: 'POST',
        headers: authHeaders,
      });
      expect(resumeRes.status).toBe(200);
      const resumedTx = (await resumeRes.json()) as CommissioningTransaction;
      expect(resumedTx.commissioningId).toBe(tx1.commissioningId);
      expect(resumedTx.events.some((e) => e.type === 'commission.resumed')).toBe(true);

      // 5. Stale event filtering: client queries sinceSeq to receive only incremental updates
      const initialEventCount = resumedTx.events.length;
      expect(initialEventCount).toBeGreaterThan(1);
      const sinceRes = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}?sinceSeq=${initialEventCount - 1}`,
        { headers: authHeaders },
      );
      expect(sinceRes.status).toBe(200);
      const sinceTx = (await sinceRes.json()) as CommissioningTransaction;
      expect(sinceTx.events.length).toBe(1);
      expect(sinceTx.events[0]?.seq).toBe(initialEventCount);

      // 6. Candidate selection: ingest candidate and select via API
      const candidate = commService.ingestDiscovery({
        protocol: 'zeroconf',
        name: 'Smart Socket',
        addresses: ['192.168.1.150'],
        port: 51827,
        details: { serviceType: '_hap._tcp', md: 'Socket-Pro', id: '11:22:33:44:55:66' },
      });
      expect(candidate).toBeDefined();

      const selectRes = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}/select`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ candidateId: candidate.id }),
        },
      );
      expect(selectRes.status).toBe(200);
      const selectedTx = (await selectRes.json()) as CommissioningTransaction;
      expect(selectedTx.selectedCandidate?.identifier).toBe(candidate.id);
      expect(selectedTx.events.some((e) => e.type === 'commission.candidate.selected')).toBe(true);

      // 7. Cancellation: client aborts active transaction cleanly
      const cancelRes = await fetch(
        `${base}/api/commissioning/sessions/${tx1.commissioningId}/cancel`,
        {
          method: 'POST',
          headers: authHeaders,
        },
      );
      expect(cancelRes.status).toBe(200);
      expect(await cancelRes.json()).toEqual({
        status: 'cancelled',
        commissioningId: tx1.commissioningId,
      });

      const cancelledTx = (await (
        await fetch(`${base}/api/commissioning/sessions/${tx1.commissioningId}`, {
          headers: authHeaders,
        })
      ).json()) as CommissioningTransaction;
      expect(cancelledTx.state).toBe('CANCELLED');
      expect(cancelledTx.error).toBe('cancelled_by_user');
      expect(cancelledTx.events.some((e) => e.type === 'commission.cancelled')).toBe(true);

      // 8. Credentials flow: Improv code requires Wi-Fi settings
      const improvRes = await fetch(`${base}/api/commissioning/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ code: 'improv:OfficeLamp' }),
      });
      expect(improvRes.status).toBe(202);
      const improvTx = (await improvRes.json()) as CommissioningTransaction;

      // Providing credentials without password rejects with 400
      const badCredRes = await fetch(
        `${base}/api/commissioning/sessions/${improvTx.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ ssid: 'MyHome' }),
        },
      );
      expect(badCredRes.status).toBe(400);

      // Providing valid credentials applies them and wipes secrets from memory
      const credRes = await fetch(
        `${base}/api/commissioning/sessions/${improvTx.commissioningId}/credentials`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ ssid: 'MyHome', password: 'SuperSecretPassword' }),
        },
      );
      expect(credRes.status).toBe(202);
      const postCredTx = (await credRes.json()) as CommissioningTransaction;
      // Invariant: password is NEVER returned in transaction state or events
      expect(JSON.stringify(postCredTx)).not.toContain('SuperSecretPassword');

      // 9. Wrong-Home Access Protection: service fail-closed check
      expect(() => commService.get(tx1.commissioningId, { homeId: 'wrong-home-id' })).toThrow(
        /wrong_home/,
      );
      expect(() =>
        commService.resume(tx1.commissioningId, { homeId: 'wrong-home-id' }),
      ).toThrow(/wrong_home/);
      expect(() => commService.cancel(tx1.commissioningId, { homeId: 'wrong-home-id' })).toThrow(
        /wrong_home/,
      );
      expect(() =>
        commService.selectCandidate(tx1.commissioningId, 'candidate-1', {
          homeId: 'wrong-home-id',
        }),
      ).toThrow(/wrong_home/);

      // 10. Deadline enforcement: transaction expires when deadline timestamp is passed
      const shortTx = commService.create({
        code: 'improv:QuickDevice',
        homeId: primaryHomeId,
        deadlineMs: 15,
      });
      expect(shortTx.deadlineTimestamp).toBeDefined();

      await new Promise((r) => setTimeout(r, 25));
      const expiredTx = commService.get(shortTx.commissioningId, { homeId: primaryHomeId });
      expect(expiredTx).toBeDefined();
      expect(expiredTx?.state).toBe('FAILED');
      expect(expiredTx?.error).toBe('deadline_exceeded');
      expect(expiredTx?.events.some((e) => e.type === 'commission.failed')).toBe(true);
    } finally {
      await app.close();
    }
  });
});
