/*
 * Haus — A thoughtful home.
 * Copyright © 2026 Andrii Vynohradov. All rights reserved.
 * Licensed under the GNU General Public License v3.0 or later; see LICENSE.
 * SPDX-License-Identifier: GPL-3.0-or-later.
 */

import { ClusterCryptoIdentity } from '../crypto/identity.js';
import { sha256Hex } from '../crypto/transport.js';
import type { ClusterStateStore } from './state.js';
import type { SignedFencingProof } from './lease-types.js';

export type FencingProofParams = Pick<
  SignedFencingProof,
  'resourceId' | 'priorOwnerHubId' | 'newOwnerHubId' | 'fencedGeneration' | 'epoch'
> & { readonly proofType?: SignedFencingProof['proofType'] };

export function createSignedFencingProof(
  stateStore: ClusterStateStore | undefined,
  params: FencingProofParams,
): SignedFencingProof {
  if (!stateStore) throw Error('cluster_state_unavailable');
  const state = stateStore.getStateSync();
  const identity = stateStore.getIdentitySync(state.hubId);
  const issuedAt = Date.now();
  const proofType = params.proofType ?? 'signed_revocation';
  const digest = sha256Hex(
    JSON.stringify([
      'haus.fence',
      state.homeId,
      params.resourceId,
      params.priorOwnerHubId,
      params.newOwnerHubId,
      params.fencedGeneration,
      params.epoch,
      proofType,
      identity.hubId,
      issuedAt,
    ]),
  );
  return {
    ...params,
    proofType,
    homeId: state.homeId,
    issuedByHubId: identity.hubId,
    issuedAt,
    signature: identity.signPayload(Buffer.from(digest, 'utf8')),
  };
}

export function verifySignedFencingProof(
  stateStore: ClusterStateStore | undefined,
  proof: SignedFencingProof,
): boolean {
  if (!stateStore) return false;
  const state = stateStore.getStateSync();
  if (proof.homeId !== state.homeId) return false;
  const keyPem =
    proof.issuedByHubId === state.hubId
      ? stateStore.getIdentitySync(state.hubId).signingPublicKey
      : stateStore.getPeerPublic(proof.issuedByHubId)?.signingPublicKey;
  if (!keyPem) return false;
  const digest = sha256Hex(
    JSON.stringify([
      'haus.fence',
      proof.homeId,
      proof.resourceId,
      proof.priorOwnerHubId,
      proof.newOwnerHubId,
      proof.fencedGeneration,
      proof.epoch,
      proof.proofType,
      proof.issuedByHubId,
      proof.issuedAt,
    ]),
  );
  return ClusterCryptoIdentity.verifySignature(
    keyPem,
    Buffer.from(digest, 'utf8'),
    proof.signature,
  );
}
