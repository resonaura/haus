/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { Availability, HomeSnapshot } from '../types.js';
import type { SessionOwner } from '../session/types.js';

/** Supplied by an authenticated owner handshake, never inferred from an incoming event. */
export interface ProviderSession {
  readonly epoch: string;
  readonly owner: SessionOwner;
  readonly generation: number;
}

export type HomeEvent = {
  schema: 'haus.event';
  sourceId: string;
  epoch: string;
  sequence: number;
} & (
  { version: 1 } | { version: 2; homeId: string; owner: SessionOwner; ownerGeneration: number }
) &
  (
    | { kind: 'snapshot'; snapshot: HomeSnapshot }
    | { kind: 'availability'; availability: Availability }
  );
