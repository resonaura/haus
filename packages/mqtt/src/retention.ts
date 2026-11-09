/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { MqttQos } from './types.js';
import type { MqttDiscoveryClaim } from './discovery/claims.js';

export interface RetainedPacket {
  readonly topic: string;
  readonly payload: Uint8Array;
  readonly qos: MqttQos;
  /** Current accepted discovery projection, cumulative within a bundled topic only. */
  readonly replayPayload?: Uint8Array;
  readonly replayOrder?: number;
  /** Active identities represented by this topic's accepted projection. */
  readonly discoveryClaims?: readonly MqttDiscoveryClaim[];
}

/** Injected persistence; the broker has no filesystem or database knowledge. */
export interface RetainedStore {
  load(): Promise<readonly RetainedPacket[]>;
  save(packet: RetainedPacket): Promise<void>;
}
