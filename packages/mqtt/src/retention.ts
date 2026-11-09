/* SPDX-License-Identifier: GPL-3.0-or-later. Copyright © 2026 Andrii Vynohradov. */
import type { MqttQos } from './types.js';

export interface RetainedPacket {
  readonly topic: string;
  readonly payload: Uint8Array;
  readonly qos: MqttQos;
  /** Optional cumulative discovery projection for restoring the local consumer. */
  readonly replayPayload?: Uint8Array;
  readonly replayOrder?: number;
}

/** Injected persistence; the broker has no filesystem or database knowledge. */
export interface RetainedStore {
  load(): Promise<readonly RetainedPacket[]>;
  save(packet: RetainedPacket): Promise<void>;
}
