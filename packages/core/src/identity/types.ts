/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { SourceRef } from '../types.js';

export type IdentityKind = 'home' | 'room' | 'device' | 'endpoint' | 'camera' | 'recording' | 'app';

/** A provider key is scoped to a home and record kind, never a label or network address. */
export interface IdentityRef {
  readonly homeId: string;
  readonly kind: IdentityKind;
  readonly source: Readonly<SourceRef>;
}

export interface IdentityTransaction {
  get(reference: IdentityRef): Promise<string | undefined>;
  owner(id: string): Promise<IdentityRef | undefined>;
  bind(reference: IdentityRef, id: string): Promise<void>;
}

/** The host implements an atomic, durable transaction, including reverse-ID uniqueness. */
export interface IdentityRepository {
  transaction<T>(operation: (transaction: IdentityTransaction) => Promise<T>): Promise<T>;
}

/** Exclusive ownership is mutable metadata; it must never be part of the resource's identity. */
export interface ResourceRef {
  readonly homeId: string;
  readonly kind: 'integration' | 'automation' | 'radio' | 'homekit' | 'media';
  readonly id: string;
}
