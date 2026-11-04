/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
export type VaultState = 'ready' | 'pending' | 'blocked';

export interface VaultMetadata {
  home: string;
  integration: string;
  hub: string;
  process: string;
  generation: number;
  state: VaultState;
  attempt: string | null;
}

export interface VaultPayload {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export interface VaultRow extends VaultMetadata, VaultPayload {}

/** The provider owns runtime validation and returns an independent decoded credential. */
export interface CredentialCodec<Credential> {
  encode(credential: Credential): Uint8Array;
  decode(bytes: Uint8Array): Credential;
}
