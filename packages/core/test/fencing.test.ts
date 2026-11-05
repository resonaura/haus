/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

import { describe, expect, it } from 'vitest';
import {
  PartitionFencingGuard,
  type FencingProof,
} from '../src/index.js';

describe('PartitionFencingGuard & Two-Hub Split-Brain Prevention', () => {
  it('prevents duplicate token refreshes, automations, and physical commands during partition', () => {
    const guard = new PartitionFencingGuard();

    // Setup initial resource ownership on Hub A
    guard.registerOwnership('token:spotify', 'hub_A', 1);
    guard.registerOwnership('radio:zigbee_living_room', 'hub_A', 1);
    guard.registerOwnership('automation:porch_evening', 'hub_A', 1);
    guard.registerOwnership('physical:relay_front_gate', 'hub_A', 1);

    // During network partition, Hub A (legitimate owner) continues executing normally
    const aToken = guard.evaluateAction('token:spotify', 'hub_A', 'token_refresh');
    expect(aToken.allowed).toBe(true);

    const aRadio = guard.evaluateAction('radio:zigbee_living_room', 'hub_A', 'radio_command');
    expect(aRadio.allowed).toBe(true);

    const aAuto = guard.evaluateAction('automation:porch_evening', 'hub_A', 'automation_execute');
    expect(aAuto.allowed).toBe(true);

    const aRelay = guard.evaluateAction('physical:relay_front_gate', 'hub_A', 'physical_dispatch');
    expect(aRelay.allowed).toBe(true);

    // Meanwhile, Hub B (partitioned peer) attempts to execute any of these resources:
    // MUST BE STRICTLY BLOCKED!
    const bToken = guard.evaluateAction('token:spotify', 'hub_B', 'token_refresh');
    expect(bToken.allowed).toBe(false);
    expect(bToken.error).toBe('PROMOTION_BLOCKED_UNFENCED');
    expect(bToken.ownerHubId).toBe('hub_A');

    const bRadio = guard.evaluateAction('radio:zigbee_living_room', 'hub_B', 'radio_command');
    expect(bRadio.allowed).toBe(false);
    expect(bRadio.error).toBe('PROMOTION_BLOCKED_UNFENCED');

    const bAuto = guard.evaluateAction('automation:porch_evening', 'hub_B', 'automation_execute');
    expect(bAuto.allowed).toBe(false);
    expect(bAuto.error).toBe('PROMOTION_BLOCKED_UNFENCED');

    const bRelay = guard.evaluateAction('physical:relay_front_gate', 'hub_B', 'physical_dispatch');
    expect(bRelay.allowed).toBe(false);
    expect(bRelay.error).toBe('PROMOTION_BLOCKED_UNFENCED');
  });

  it('permits clean promotion only after verified cryptographic fencing proof', () => {
    const guard = new PartitionFencingGuard();
    guard.registerOwnership('token:spotify', 'hub_A', 1);

    const validSecretToken = 'sig_revocation_hub_A_valid_12345';
    guard.registerValidRevocationToken(validSecretToken);

    const proof: FencingProof = {
      resourceId: 'token:spotify',
      priorOwnerHubId: 'hub_A',
      fencedGeneration: 1,
      proofType: 'signed_revocation',
      token: validSecretToken,
      issuedAt: new Date().toISOString(),
    };

    // Before proof: Hub B is blocked
    const preCheck = guard.evaluateAction('token:spotify', 'hub_B', 'token_refresh');
    expect(preCheck.allowed).toBe(false);

    // Apply verified proof
    const result = guard.applyVerifiedFencingProof(proof, 'hub_B');
    expect(result.success).toBe(true);
    expect(result.newGeneration).toBe(2);

    // After verified promotion: Hub B is now the authoritative owner at generation 2
    const postCheckB = guard.evaluateAction('token:spotify', 'hub_B', 'token_refresh');
    expect(postCheckB.allowed).toBe(true);
    expect(postCheckB.generation).toBe(2);

    // Old Hub A is now rejected
    const postCheckA = guard.evaluateAction('token:spotify', 'hub_A', 'token_refresh');
    expect(postCheckA.allowed).toBe(false);
    expect(postCheckA.error).toBe('PROMOTION_BLOCKED_UNFENCED');
  });

  it('strictly rejects forged or stale fencing proofs', () => {
    const guard = new PartitionFencingGuard();
    guard.registerOwnership('token:spotify', 'hub_A', 3);

    // Stale generation proof (fencedGeneration 2 < current 3)
    const staleProof: FencingProof = {
      resourceId: 'token:spotify',
      priorOwnerHubId: 'hub_A',
      fencedGeneration: 2,
      proofType: 'signed_revocation',
      token: 'some_token',
      issuedAt: new Date().toISOString(),
    };

    const staleResult = guard.applyVerifiedFencingProof(staleProof, 'hub_B');
    expect(staleResult.success).toBe(false);
    expect(staleResult.reason).toContain('Stale proof generation');

    // Forged token proof
    const forgedProof: FencingProof = {
      resourceId: 'token:spotify',
      priorOwnerHubId: 'hub_A',
      fencedGeneration: 3,
      proofType: 'signed_revocation',
      token: 'forged_fake_signature_999',
      issuedAt: new Date().toISOString(),
    };

    const forgedResult = guard.applyVerifiedFencingProof(forgedProof, 'hub_B');
    expect(forgedResult.success).toBe(false);
    expect(forgedResult.reason).toContain('failed cryptographic validation');
  });
});
