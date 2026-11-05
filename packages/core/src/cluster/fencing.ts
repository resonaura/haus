/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */

export type PartitionActionKind =
  'token_refresh' | 'automation_execute' | 'radio_command' | 'physical_dispatch';

export interface FencingProof {
  readonly resourceId: string;
  readonly priorOwnerHubId: string;
  readonly fencedGeneration: number;
  readonly proofType: 'signed_revocation' | 'witness_quorum' | 'pdu_power_cut';
  readonly token: string;
  readonly issuedAt: string;
}

export interface ResourceOwnershipRecord {
  readonly resourceId: string;
  readonly ownerHubId: string;
  readonly generation: number;
  readonly assignedAt: string;
  readonly fenced: boolean;
}

export interface PartitionDecision {
  readonly allowed: boolean;
  readonly resourceId: string;
  readonly ownerHubId: string;
  readonly generation: number;
  readonly action: PartitionActionKind;
  readonly error?: 'PROMOTION_BLOCKED_UNFENCED' | 'RESOURCE_FENCED' | 'STALE_OWNER';
  readonly reason: string;
}

export class PartitionFencingGuard {
  private readonly ownership = new Map<string, ResourceOwnershipRecord>();
  private readonly validRevocationTokens = new Set<string>();

  registerOwnership(
    resourceId: string,
    ownerHubId: string,
    generation: number = 1,
  ): ResourceOwnershipRecord {
    const record: ResourceOwnershipRecord = {
      resourceId,
      ownerHubId,
      generation,
      assignedAt: new Date().toISOString(),
      fenced: false,
    };
    this.ownership.set(resourceId, record);
    return record;
  }

  registerValidRevocationToken(token: string): void {
    this.validRevocationTokens.add(token);
  }

  getOwnership(resourceId: string): ResourceOwnershipRecord | undefined {
    return this.ownership.get(resourceId);
  }

  evaluateAction(
    resourceId: string,
    requestingHubId: string,
    action: PartitionActionKind,
  ): PartitionDecision {
    const existing = this.ownership.get(resourceId);

    // If resource not tracked, reject safe by default
    if (!existing) {
      return {
        allowed: false,
        resourceId,
        ownerHubId: 'unknown',
        generation: 0,
        action,
        error: 'PROMOTION_BLOCKED_UNFENCED',
        reason: `Resource "${resourceId}" has no recorded ownership. Cannot dispatch during unconfirmed state.`,
      };
    }

    if (existing.fenced) {
      return {
        allowed: false,
        resourceId,
        ownerHubId: existing.ownerHubId,
        generation: existing.generation,
        action,
        error: 'RESOURCE_FENCED',
        reason: `Resource "${resourceId}" is cryptographically fenced. Action blocked.`,
      };
    }

    // Owner check: existing owner retains full authority while partitioned
    if (existing.ownerHubId === requestingHubId) {
      return {
        allowed: true,
        resourceId,
        ownerHubId: existing.ownerHubId,
        generation: existing.generation,
        action,
        reason: `Requesting hub "${requestingHubId}" is the legitimate authoritative owner of "${resourceId}".`,
      };
    }

    // Requesting hub is NOT the owner: partition promotion is strictly blocked without fencing proof!
    return {
      allowed: false,
      resourceId,
      ownerHubId: existing.ownerHubId,
      generation: existing.generation,
      action,
      error: 'PROMOTION_BLOCKED_UNFENCED',
      reason: `Requesting hub "${requestingHubId}" is NOT the owner of "${resourceId}" (held by "${existing.ownerHubId}"). Automatic promotion blocked during partition to prevent split-brain duplicates.`,
    };
  }

  applyVerifiedFencingProof(
    proof: FencingProof,
    newOwnerHubId: string,
  ): { success: boolean; newGeneration: number; reason: string } {
    const existing = this.ownership.get(proof.resourceId);
    if (!existing) {
      return { success: false, newGeneration: 0, reason: 'Resource not found.' };
    }

    if (existing.ownerHubId !== proof.priorOwnerHubId) {
      return {
        success: false,
        newGeneration: existing.generation,
        reason: `Proof target "${proof.priorOwnerHubId}" does not match current owner "${existing.ownerHubId}".`,
      };
    }

    if (proof.fencedGeneration < existing.generation) {
      return {
        success: false,
        newGeneration: existing.generation,
        reason: `Stale proof generation ${proof.fencedGeneration} is below active generation ${existing.generation}.`,
      };
    }

    // Verify token validity
    if (!this.validRevocationTokens.has(proof.token)) {
      return {
        success: false,
        newGeneration: existing.generation,
        reason: 'Revocation proof token failed cryptographic validation.',
      };
    }

    // Promote new owner and increment generation token
    const newGeneration = existing.generation + 1;
    this.ownership.set(proof.resourceId, {
      resourceId: proof.resourceId,
      ownerHubId: newOwnerHubId,
      generation: newGeneration,
      assignedAt: new Date().toISOString(),
      fenced: false,
    });

    return {
      success: true,
      newGeneration,
      reason: `Verified proof accepted (${proof.proofType}). "${newOwnerHubId}" promoted to generation ${newGeneration}.`,
    };
  }
}
