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

export type { CredentialCodec } from '@haus/core/provider';
